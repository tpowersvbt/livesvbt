import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { createApp } from '../server/index.js';
import { openDatabase, verifyPassword, hashPassword } from '../server/db.js';
import { digest } from '../server/services.js';

const origin = 'http://localhost:3000';

test('project and biography publishing keeps drafts private and requires moderator authority', async () => {
  const f = await fixture();
  try {
    const anon=f.client(), customer=f.client(), admin=f.client();
    assert.deepEqual((await anon.request('/projects')).data, []);
    assert.equal((await anon.request('/admin/projects')).status,401);
    assert.equal((await anon.request('/admin/leadership')).status,401);
    await customer.login('sales@bakhtiariautogroup.com','FounderClient!2026');
    for (const path of ['/admin/projects','/admin/leadership']) assert.equal((await customer.request(path)).status,403);
    assert.equal((await customer.request('/admin/projects','POST',{title:'forbidden'})).status,403);
    await admin.login('tpower@siliconvalleybankandtrust.com','ModeratorGod!2026');
    const values={title:'Data project',summary:'Public overview',description:'First paragraph.\nSecond paragraph.',privateNotes:'SECRET-NOTES',published:'malicious-auto-publish'};
    const created=await admin.request('/admin/projects','POST',values);
    assert.equal(created.status,201);
    let row=created.data;
    assert.equal(row.published,null);
    assert.deepEqual((await anon.request('/projects')).data,[]);
    assert.equal((await admin.request(`/admin/projects/${row.id}/publish`,'POST',{version:row.version},{'X-CSRF-Token':''})).status,403);
    row=(await admin.request(`/admin/projects/${row.id}/publish`,'POST',{version:row.version})).data;
    let publicRows=(await anon.request('/projects')).data;
    assert.equal(publicRows[0].title,values.title);
    assert.ok(!JSON.stringify(publicRows).includes('SECRET-NOTES'));
    assert.deepEqual(Object.keys(publicRows[0]).sort(),['description','id','publishedAt','summary','title']);
    assert.equal((await admin.request(`/admin/projects/${row.id}`,'PUT',{...values,version:1})).status,409);
    row=(await admin.request(`/admin/projects/${row.id}`,'PUT',{...values,title:'Private revision',version:row.version})).data;
    assert.equal((await anon.request('/projects')).data[0].title,'Data project');
    row=(await admin.request(`/admin/projects/${row.id}/publish`,'POST',{version:row.version})).data;
    assert.equal((await anon.request('/projects')).data[0].title,'Private revision');
    assert.equal((await admin.request(`/admin/projects/${row.id}/unpublish`,'POST',{version:row.version})).status,200);
    assert.deepEqual((await anon.request('/projects')).data,[]);
    assert.equal((await admin.request('/admin/projects')).data[0].privateNotes,'SECRET-NOTES');
    const original=(await anon.request('/leadership')).data;
    let bio=(await admin.request('/admin/leadership')).data;
    bio=(await admin.request('/admin/leadership','PUT',{...bio.draft,biography:'Reviewed biography.\nWith a second paragraph.',version:bio.version})).data;
    assert.deepEqual((await anon.request('/leadership')).data,original);
    assert.equal((await customer.request('/admin/leadership/publish','POST',{version:bio.version,reviewed:true})).status,403);
    assert.equal((await admin.request('/admin/leadership/publish','POST',{version:bio.version,reviewed:false})).status,400);
    assert.equal((await admin.request('/admin/leadership/publish','POST',{version:bio.version,reviewed:true})).status,200);
    assert.equal((await anon.request('/leadership')).data.biography,'Reviewed biography.\nWith a second paragraph.');
    assert.equal((await admin.request('/admin/leadership')).data.original.biography,original.biography);
    assert.ok(f.db.prepare("SELECT id FROM audit WHERE action='leadership.publish'").get());
    assert.ok(f.db.prepare("SELECT id FROM audit WHERE action='project.unpublish'").get());
  } finally { await f.close(); }
});
async function fixture(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'svbt-test-'));
  const app = await createApp({ production: false, origin, frontend: false, dbPath: join(directory, 'bank.sqlite'), statementDir: join(directory, 'statements'), demoSeed: true, ...options });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  function client() {
    let cookie = '';
    let csrf = '';
    return {
      get cookie() { return cookie; },
      get csrf() { return csrf; },
      async request(path, method = 'GET', body, headers = {}) {
        const response = await fetch(`${url}/api${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { Origin: origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
        if (data.csrfToken) csrf = data.csrfToken;
        return { status: response.status, data, headers: response.headers };
      },
      async login(email, password) {
        await this.request('/session');
        const result = await this.request('/login', 'POST', { email, password });
        assert.equal(result.status, 200);
        return result;
      }
    };
  }
  return { app, db: app.locals.db, directory, client, url, async close() { await new Promise(resolve => server.close(resolve)); await app.locals.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('authentication, hashed sessions, rotation, origin, CSRF, expiry and logout', async () => {
  const f = await fixture();
  try {
    const c = f.client();
    assert.equal((await c.request('/account')).status, 401);
    assert.equal((await c.request('/admin/accounts')).status, 401);
    const session = await c.request('/session');
    assert.equal(session.data.user, null);
    assert.match(session.headers.get('set-cookie'), /Secure/);
    assert.match(session.headers.get('set-cookie'), /HttpOnly/);
    assert.match(session.headers.get('set-cookie'), /SameSite=Strict/);
    const anonymous = c.cookie;
    assert.equal((await c.request('/login', 'POST', { email: 'sales@bakhtiariautogroup.com', password: 'FounderClient!2026' }, { Origin: 'http://evil.example' })).status, 403);
    assert.equal((await c.request('/login', 'POST', {}, { 'X-CSRF-Token': '' })).status, 403);
    assert.equal((await c.request('/login', 'POST', {}, { Origin: '' })).status, 403);
    assert.equal((await c.request('/login', 'POST', {}, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await c.request('/login', 'POST', [])).status, 400);
    assert.equal((await c.request('/login', 'POST', { email: 'missing@example.com', password: 'x'.repeat(1025) })).status, 400);
    assert.equal((await c.request('/login', 'POST', { padding: 'x'.repeat(17000) })).status, 413);
    assert.equal((await c.request('/session', 'GET', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await c.request('/login', 'POST', { email: 'sales@bakhtiariautogroup.com', password: 'incorrect-password' })).status, 401);
    await c.login('sales@bakhtiariautogroup.com', 'FounderClient!2026');
    assert.notEqual(c.cookie, anonymous);
    assert.equal(f.db.prepare('SELECT * FROM sessions WHERE tokenHash=?').get(digest(anonymous.split('=')[1])), undefined);
    const token = c.cookie.split('=')[1];
    const stored = f.db.prepare('SELECT * FROM sessions WHERE tokenHash=?').get(digest(token));
    assert.ok(stored);
    assert.notEqual(stored.tokenHash, token);
    const user = f.db.prepare('SELECT * FROM users WHERE id=?').get(stored.userId);
    assert.match(user.passwordHash, /^scrypt\$131072\$8\$1\$/);
    assert.ok(await verifyPassword('FounderClient!2026', user.passwordHash));
    assert.ok(!JSON.stringify((await c.request('/session')).data).includes('passwordHash'));
    const old = c.cookie;
    await c.request('/logout', 'POST', {});
    assert.equal((await c.request('/account')).status, 401);
    assert.equal((await c.request('/account', 'GET', undefined, { Cookie: old })).status, 401);
    await c.login('sales@bakhtiariautogroup.com', 'FounderClient!2026');
    f.db.prepare('UPDATE sessions SET expiresAt=0 WHERE tokenHash=?').run(digest(c.cookie.split('=')[1]));
    assert.equal((await c.request('/account')).status, 401);
  } finally { await f.close(); }
});

test('registration always creates isolated zero-funded customers; password-confirmed profile edits', async () => {
  const f = await fixture();
  try {
    const first = f.client();
    const second = f.client();
    const register = async (c, email, extra = {}) => { await c.request('/session'); return c.request('/register', 'POST', { name: 'New Founder', address: '1 Main Street', email, password: 'UniquePassword!2026', balance: 999999, ...extra }); };
    assert.equal((await register(first, 'first@example.com', { role: 'moderator' })).status, 400);
    assert.equal(f.db.prepare('SELECT id FROM users WHERE email=?').get('first@example.com'), undefined);
    assert.equal((await register(first, 'first@example.com')).status, 201);
    assert.equal((await register(second, 'second@example.com')).status, 201);
    const a = (await first.request('/account')).data;
    const b = (await second.request('/account')).data;
    assert.match(a.account.number, /^\d{12}$/);
    assert.notEqual(a.account.number, b.account.number);
    assert.equal(a.balance, 0);
    assert.deepEqual(a.transactions, []);
    assert.equal((await first.request('/session')).data.user.role, 'customer');
    for (const path of ['/admin/accounts', '/admin/accounts/1', '/admin/investments', '/admin/accounts/1/statements', '/admin/accounts/1/preview?month=2026-06', '/admin/statements/1/pdf', '/admin/statements/1/integrity', '/admin/audit']) assert.equal((await first.request(path)).status, 403, path);
    assert.equal((await first.request('/admin/accounts/1/transactions', 'POST', { date: '2026-06-01', amount: 100, description: 'Escalation' })).status, 403);
    for (const [path, method] of [['/admin/transactions/1/reverse', 'POST'], ['/admin/accounts/1/statements', 'POST'], ['/admin/investments', 'POST'], ['/admin/investments/1', 'PUT']]) assert.equal((await first.request(path, method, {})).status, 403, path);
    assert.equal((await first.request('/admin/accounts', 'GET', undefined, { 'X-User-Role': 'moderator', 'X-User-Id': '2', Authorization: 'Bearer moderator' })).status, 403);
    assert.equal((await first.request('/account', 'GET', undefined, { Cookie: 'svbt_session=' + 'A'.repeat(43) })).status, 401);
    assert.equal((await first.request('/account', 'GET', undefined, { Cookie: `${first.cookie}; ${second.cookie}` })).status, 401);
    assert.equal((await first.request('/account?accountId=1')).data.account.id, a.account.id);
    assert.equal((await second.request(`/account?accountId=${a.account.id}`)).data.account.id, b.account.id);
    assert.equal((await first.request('/profile', 'PATCH', { name: 'Wrong', address: 'Changed', password: 'wrong' })).status, 401);
    const change = await first.request('/profile', 'PATCH', { name: 'Updated Founder', address: '2 Main Street', password: 'UniquePassword!2026', role: 'moderator', email: 'hijack@example.com' });
    assert.equal(change.status, 200);
    assert.equal(change.data.role, 'customer');
    assert.equal(change.data.email, 'first@example.com');
    assert.equal((await first.request('/account')).data.account.name, 'Updated Founder');
    assert.equal((await second.request('/account')).data.account.address, '1 Main Street');
    assert.equal((await register(second, 'FIRST@example.com')).status, 409);
    assert.equal((await first.request('/register', 'POST', { name: 'Weak', email: 'weak@example.com', password: 'short', address: 'A' })).status, 400);
  } finally { await f.close(); }
});

test('exact seeded ledger, continuity, PDF archive and immutable statement revisions', async () => {
  const f = await fixture();
  try {
    const admin = f.client();
    await admin.login('tpower@siliconvalleybankandtrust.com', 'ModeratorGod!2026');
    const accounts = (await admin.request('/admin/accounts')).data;
    assert.equal(accounts.length, 1);
    const id = accounts[0].id;
    const account = (await admin.request(`/admin/accounts/${id}`)).data;
    assert.equal(account.balance, 3123000);
    assert.equal(account.transactions.length, 52);
    assert.deepEqual(account.monthly.map(row => row.debits), [576700, 588400, 600100, 611800]);
    assert.deepEqual(account.monthly.map(row => row.deposits), [1000000, 1500000, 1500000, 1500000]);
    assert.deepEqual(account.monthly.map(row => row.opening), [0, 423300, 1334900, 2234800]);
    assert.deepEqual(account.monthly.map(row => row.closing), [423300, 1334900, 2234800, 3123000]);
    const statements = (await admin.request(`/admin/accounts/${id}/statements`)).data;
    assert.equal(statements.length, 4);
    for (const statement of statements) {
      const check = await admin.request(`/admin/statements/${statement.id}/integrity`);
      assert.equal(check.data.valid, true);
      const pdf = await admin.request(`/admin/statements/${statement.id}/pdf`);
      assert.equal(pdf.status, 200);
      assert.equal(pdf.headers.get('content-type'), 'application/pdf');
      assert.equal(pdf.data.subarray(0, 5).toString(), '%PDF-');
      const row = f.db.prepare('SELECT * FROM statements WHERE id=?').get(statement.id);
      assert.deepEqual(pdf.data, readFileSync(row.archivePath));
    }
    const june = statements.find(s => s.month === '2026-06');
    const oldPdf = (await admin.request(`/admin/statements/${june.id}/pdf`)).data;
    const posting = await admin.request(`/admin/accounts/${id}/transactions`, 'POST', { date: '2026-06-20', description: 'Branch correction', amount: 12345 });
    assert.equal(posting.status, 201);
    const live = (await admin.request(`/admin/accounts/${id}/preview?month=2026-06`)).data;
    assert.equal(live.closing, 435645);
    assert.equal(live.transactions.at(-1).runningBalance, live.closing);
    assert.equal((await admin.request(`/admin/accounts/${id}/preview?month=2026-07`)).data.opening, live.closing);
    const revision = await admin.request(`/admin/accounts/${id}/statements`, 'POST', { month: '2026-06' });
    assert.equal(revision.status, 201);
    assert.equal(revision.data.revision, 2);
    assert.notEqual(revision.data.hash, june.hash);
    assert.deepEqual((await admin.request(`/admin/statements/${june.id}/pdf`)).data, oldPdf);
    for (const table of ['transactions', 'statements', 'audit']) {
      assert.throws(() => f.db.exec(`DELETE FROM ${table}`), /Immutable/);
      assert.throws(() => f.db.exec(`UPDATE ${table} SET id=id`), /Immutable/);
    }
    const row = f.db.prepare('SELECT * FROM statements WHERE id=?').get(june.id);
    const path = row.archivePath;
    writeFileSync(path, 'tampered');
    assert.equal((await admin.request(`/admin/statements/${june.id}/integrity`)).data.valid, false);
    assert.equal((await admin.request(`/admin/statements/${june.id}/pdf`)).status, 409);
    writeFileSync(path, oldPdf);
    assert.equal((await admin.request(`/admin/statements/${june.id}/integrity`)).data.valid, true);
    assert.equal((await admin.request(`/admin/accounts/${id}/preview?month=not-a-month`)).status, 400);
    assert.equal((await admin.request(`/admin/statements/99999/pdf`)).status, 404);
  } finally { await f.close(); }
});

test('validated reversals, investment administration, audit records and SQL-safe input', async () => {
  const f = await fixture();
  try {
    const c = f.client();
    await c.login('tpower@siliconvalleybankandtrust.com', 'ModeratorGod!2026');
    const id = (await c.request('/admin/accounts')).data[0].id;
    for (const amount of [0, 1.5, '100', Number.MAX_SAFE_INTEGER]) assert.equal((await c.request(`/admin/accounts/${id}/transactions`, 'POST', { date: '2026-09-20', description: 'Invalid', amount })).status, 400);
    assert.equal((await c.request(`/admin/accounts/${id}/transactions`, 'POST', { date: '2026-02-30', description: 'Invalid', amount: 1 })).status, 400);
    assert.equal((await c.request(`/admin/accounts/${id}/transactions`, 'POST', { date: '2026-99-01', description: 'Invalid', amount: 1 })).status, 400);
    const post = await c.request(`/admin/accounts/${id}/transactions`, 'POST', { date: '2026-09-20', description: "Deposit '; DROP TABLE users; --", amount: 50000 });
    assert.equal(post.status, 201);
    assert.equal((await c.request(`/admin/transactions/${post.data.id}/reverse`, 'POST', { date: '2026-09-19', reason: 'Wrong posting' })).status, 400);
    const reverse = await c.request(`/admin/transactions/${post.data.id}/reverse`, 'POST', { date: '2026-09-21', reason: 'Wrong posting' });
    assert.equal(reverse.status, 201);
    assert.equal(reverse.data.reversalOf, post.data.id);
    assert.equal(reverse.data.amount, -50000);
    assert.equal((await c.request(`/admin/transactions/${post.data.id}/reverse`, 'POST', { date: '2026-09-22', reason: 'Again' })).status, 409);
    assert.equal((await c.request(`/admin/transactions/${reverse.data.id}/reverse`, 'POST', { date: '2026-09-22', reason: 'Again' })).status, 409);
    assert.equal((await c.request(`/admin/accounts/${id}`)).data.balance, 3123000);
    assert.equal((await c.request('/admin/investments')).data.length, 3);
    const value = { sector: 'Data centers', status: 'Review', targetCapital: 10000000, risk: 'High', strategy: 'Build resilient capacity' };
    const investment = await c.request('/admin/investments', 'POST', value);
    assert.equal(investment.status, 201);
    const update = await c.request(`/admin/investments/${investment.data.id}`, 'PUT', { ...value, status: 'Active' });
    assert.equal(update.status, 200);
    assert.equal(update.data.status, 'Active');
    assert.equal((await c.request('/admin/investments', 'POST', { ...value, targetCapital: -1 })).status, 400);
    const trail = (await c.request('/admin/audit')).data;
    for (const action of ['transaction.post', 'transaction.reverse', 'investment.save', 'session.login', 'statement.issue', 'demo.seed']) assert.ok(trail.some(row => row.action === action));
    assert.ok(!JSON.stringify(trail).includes('ModeratorGod!2026'));
    assert.equal((await c.request('/admin/accounts/999')).status, 404);
  } finally { await f.close(); }
});

test('rate limiting is server-enforced', async () => {
  const f = await fixture({ demoSeed: false, authRateLimit: 2 });
  try {
    const c = f.client();
    await c.request('/session');
    for (let i = 0; i < 2; i++) assert.equal((await c.request('/login', 'POST', { email: 'missing@example.com', password: 'incorrect-password' })).status, 401);
    const denied = await c.request('/login', 'POST', { email: 'missing@example.com', password: 'incorrect-password' });
    assert.equal(denied.status, 429);
    assert.ok(Number(denied.headers.get('retry-after')) > 0);
    assert.equal((await c.request('/register', 'POST', { name: 'Founder', address: 'A', email: 'new@example.com', password: 'UniquePassword!2026' }, { 'X-Forwarded-For': '203.0.113.4' })).status, 429);
  } finally { await f.close(); }
  const registration = await fixture({ demoSeed: false, authRateLimit: 2 });
  try {
    const c = registration.client();
    await c.request('/session');
    for (let i = 0; i < 2; i++) assert.equal((await c.request('/register', 'POST', { name: 'Founder', address: 'A', email: `new${i}@example.com`, password: 'UniquePassword!2026' })).status, 201);
    assert.equal((await c.request('/register', 'POST', { name: 'Founder', address: 'A', email: 'denied@example.com', password: 'UniquePassword!2026' })).status, 429);
    assert.equal(registration.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2);
  } finally { await registration.close(); }
});

test('authentication memory capacity is shared across apps and released after completion', async () => {
  const first = await fixture({ demoSeed: false });
  const second = await fixture({ demoSeed: false });
  try {
    const clients = [first.client(), second.client(), first.client(), second.client(), first.client(), second.client()];
    for (const c of clients) await c.request('/session');
    const responses = await Promise.all(clients.map((c, i) => i % 2 ? c.request('/login', 'POST', { email: 'missing@example.com', password: 'incorrect-password' }) : c.request('/register', 'POST', { name: 'Founder', address: 'A', email: `capacity${i}@example.com`, password: 'UniquePassword!2026' })));
    assert.ok(responses.some(response => response.status === 429));
    assert.ok(responses.some(response => [201, 401].includes(response.status)));
    for (const response of responses) {
      assert.ok([201, 401, 429].includes(response.status));
      if (response.status === 429) assert.ok(Number(response.headers.get('retry-after')) > 0);
    }
    assert.equal((await clients[0].request('/login', 'POST', { email: 'missing@example.com', password: 'incorrect-password' })).status, 401);
  } finally { await first.close(); await second.close(); }
});

test('production fails closed and unseeded databases have no default users', async () => {
  await assert.rejects(createApp({ production: true, demoSeed: true, origin: 'https://bank.example', dbPath: ':memory:', frontend: false }), /seeding is forbidden/);
  await assert.rejects(createApp({ production: true, origin: '', dbPath: ':memory:', frontend: false }), /explicit valid origin/);
  await assert.rejects(createApp({ production: true, origin, dbPath: ':memory:', frontend: false }), /HTTPS/);
  const f = await fixture({ production: true, demoSeed: false, origin: 'https://bank.example' });
  try {
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
    const health = await f.client().request('/health');
    assert.equal(health.status, 200);
    assert.deepEqual(health.data, { status: 'ok' });
    assert.equal(health.headers.get('cache-control'), 'no-store');
    assert.match(health.headers.get('strict-transport-security'), /max-age=31536000/);
    const csp = health.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self';/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal((await fetch(`${f.url}/`)).status, 404);
  } finally { await f.close(); }
  const seeded = await fixture();
  try { await assert.rejects(createApp({ dbPath: seeded.app.locals.config.dbPath, production: true, demoSeed: false, origin: 'https://bank.example', frontend: false }), /demo-seeded database/); }
  finally { await seeded.close(); }
});

test('production refuses sign-in and new accounts that use a published password', async () => {
  const f = await fixture({ production: true, demoSeed: false, origin: 'https://bank.example' });
  try {
    const insert = f.db.prepare("INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,'moderator',?)");
    insert.run('leaked@example.com', 'Leaked', 'A', await hashPassword('svbt2026!'));
    insert.run('unique@example.com', 'Unique', 'A', await hashPassword('UniqueOperations!2026'));
    const write = { Origin: 'https://bank.example' };
    const signIn = async (email, password) => { const c = f.client(); await c.request('/session'); return c.request('/login', 'POST', { email, password }, write); };
    const leaked = await signIn('leaked@example.com', 'svbt2026!');
    assert.equal(leaked.status, 401);
    assert.equal(leaked.data.error, 'Email or password is incorrect.');
    assert.equal((await signIn('unique@example.com', 'UniqueOperations!2026')).status, 200);
    const c = f.client(); await c.request('/session');
    assert.equal((await c.request('/register', 'POST', { name: 'Founder', address: 'A', email: 'new@example.com', password: 'ModeratorGod!2026' }, write)).status, 400);
  } finally { await f.close(); }
});

test('persistent demo startup is idempotent and concurrent statement issuance is serialized', async () => {
  const f = await fixture();
  try {
    const before = f.db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n;
    const startup = await createApp({ dbPath: f.app.locals.config.dbPath, production: false, origin, demoSeed: true, frontend: false, statementDir: f.app.locals.config.statementDir });
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, before);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM statements').get().n, 4);
    await startup.locals.close();
    const admin = f.client();
    await admin.login('tpower@siliconvalleybankandtrust.com', 'ModeratorGod!2026');
    assert.equal((await admin.request('/admin/accounts/01/statements', 'POST', { month: '2026-06' })).status, 400);
    const responses = await Promise.all([admin.request('/admin/accounts/1/statements', 'POST', { month: '2026-06' }), admin.request('/admin/accounts/1/statements', 'POST', { month: '2026-06' })]);
    const successful = responses.filter(response => response.status === 201);
    assert.ok(successful.length >= 1);
    for (const response of responses) assert.ok([201, 409].includes(response.status));
    assert.deepEqual(successful.map(response => response.data.revision).sort(), successful.length === 1 ? [2] : [2, 3]);
    const next = await admin.request('/admin/accounts/1/statements', 'POST', { month: '2026-06' });
    assert.equal(next.status, 201);
    assert.equal(next.data.revision, 2 + successful.length);
    for (const response of [...successful, next]) assert.equal((await admin.request(`/admin/statements/${response.data.id}/integrity`)).data.valid, true);
  } finally { await f.close(); }
});

test('server-only moderator provisioning requires unique non-demo credentials', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'svbt-provision-'));
  const env = { ...process.env, NODE_ENV: 'test', DEMO_SEED: 'false', DB_PATH: join(directory, 'bank.sqlite'), MODERATOR_EMAIL: 'operations@example.com', MODERATOR_PASSWORD: 'UniqueOperations!2026' };
  try {
    execFileSync(process.execPath, ['server/create-moderator.js'], { env, stdio: 'pipe' });
    const db = openDatabase(env.DB_PATH);
    const user = db.prepare('SELECT * FROM users').get();
    assert.equal(user.role, 'moderator');
    assert.equal(user.email, env.MODERATOR_EMAIL);
    assert.ok(await verifyPassword(env.MODERATOR_PASSWORD, user.passwordHash));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 0);
    db.close();
    assert.throws(() => execFileSync(process.execPath, ['server/create-moderator.js'], { env, stdio: 'pipe' }), /email already exists/);
    assert.throws(() => execFileSync(process.execPath, ['server/create-moderator.js'], { env: { ...env, MODERATOR_PASSWORD: 'ModeratorGod!2026' }, stdio: 'pipe' }), /demonstration password/);
    const rotation = { ...env, MODERATOR_RESET: 'true', MODERATOR_PASSWORD: 'RotatedOperations!2026' };
    const beforeReset = openDatabase(env.DB_PATH);
    beforeReset.prepare('INSERT INTO sessions(tokenHash,userId,csrfToken,expiresAt) VALUES (?,?,?,?)').run(digest('old-session'), user.id, 'csrf', Date.now() + 100000);
    beforeReset.close();
    execFileSync(process.execPath, ['server/create-moderator.js'], { env: rotation, stdio: 'pipe' });
    const afterReset = openDatabase(env.DB_PATH);
    assert.ok(await verifyPassword(rotation.MODERATOR_PASSWORD, afterReset.prepare('SELECT passwordHash FROM users WHERE id=?').get(user.id).passwordHash));
    assert.equal(afterReset.prepare('SELECT COUNT(*) AS n FROM sessions WHERE userId=?').get(user.id).n, 0);
    assert.ok(afterReset.prepare("SELECT id FROM audit WHERE action='moderator.password-reset'").get());
    afterReset.close();
    const ownerEnv = { ...env, MODERATOR_EMAIL: 'owner@example.com', MODERATOR_PASSWORD: 'UniqueOwnerAccess!2026', MODERATOR_ROLE: 'owner' };
    execFileSync(process.execPath, ['server/create-moderator.js'], { env: ownerEnv, stdio: 'pipe' });
    assert.throws(() => execFileSync(process.execPath, ['server/create-moderator.js'], { env: { ...ownerEnv, MODERATOR_EMAIL: 'other@example.com', MODERATOR_ROLE: 'admin' }, stdio: 'pipe' }), /MODERATOR_ROLE must be/);
    execFileSync(process.execPath, ['server/create-moderator.js'], { env: { ...ownerEnv, MODERATOR_RESET: 'true', MODERATOR_ROLE: 'moderator', MODERATOR_PASSWORD: 'RotatedOwnerAccess!2026' }, stdio: 'pipe' });
    const roles = openDatabase(env.DB_PATH);
    assert.equal(roles.prepare("SELECT role FROM staff_access WHERE userId=(SELECT id FROM users WHERE email='owner@example.com')").get().role, 'owner');
    assert.equal(roles.prepare('SELECT role FROM staff_access WHERE userId=?').get(user.id), undefined);
    roles.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('failed passwords lock the account across IP addresses without revealing whether it exists', async () => {
  const f = await fixture({ accountFailureLimit: 3, trustProxy: true });
  try {
    const email = 'sales@bakhtiariautogroup.com';
    for (const [i, target] of [email, 'nobody@example.com'].entries()) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const c = f.client();
        await c.request('/session', 'GET', undefined, { 'X-Forwarded-For': `198.51.100.${i * 10 + attempt}` });
        assert.equal((await c.request('/login', 'POST', { email: target, password: 'wrong-password' }, { 'X-Forwarded-For': `198.51.100.${i * 10 + attempt}` })).status, 401);
      }
      const c = f.client();
      await c.request('/session', 'GET', undefined, { 'X-Forwarded-For': '203.0.113.9' });
      const locked = await c.request('/login', 'POST', { email: target.toUpperCase(), password: target === email ? 'FounderClient!2026' : 'x' }, { 'X-Forwarded-For': '203.0.113.9' });
      assert.equal(locked.status, 429);
      assert.ok(Number(locked.headers.get('retry-after')) > 0);
    }
    assert.ok(f.db.prepare("SELECT id FROM audit WHERE action='session.locked'").get());
    const other = f.client();
    await other.login('tpower@siliconvalleybankandtrust.com', 'ModeratorGod!2026');
  } finally { await f.close(); }
  const reset = await fixture({ accountFailureLimit: 2 });
  try {
    const c = reset.client();
    await c.request('/session');
    assert.equal((await c.request('/login', 'POST', { email: 'sales@bakhtiariautogroup.com', password: 'wrong-password' })).status, 401);
    await c.login('sales@bakhtiariautogroup.com', 'FounderClient!2026');
    assert.equal((await c.request('/profile', 'PATCH', { name: 'A', address: 'B', password: 'wrong-password' })).status, 401);
    assert.equal((await c.request('/profile', 'PATCH', { name: 'A', address: 'B', password: 'wrong-password' })).status, 401);
    assert.equal((await c.request('/profile', 'PATCH', { name: 'A', address: 'B', password: 'FounderClient!2026' })).status, 429);
  } finally { await reset.close(); }
});

test('new anonymous sessions are throttled and IPv6 clients are limited per /64', async () => {
  const { clientKey } = await import('../server/index.js');
  assert.equal(clientKey('2001:db8:1:2:aaaa::1'), clientKey('2001:db8:1:2:bbbb:cccc:dddd:eeee'));
  assert.notEqual(clientKey('2001:db8:1:2::1'), clientKey('2001:db8:1:3::1'));
  assert.equal(clientKey('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(clientKey('192.0.2.1'), '192.0.2.1');
  const f = await fixture({ sessionRateLimit: 2 });
  try {
    for (let i = 0; i < 2; i++) assert.equal((await f.client().request('/session')).status, 200);
    const denied = await f.client().request('/session');
    assert.equal(denied.status, 429);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 2);
    const anonymous = f.db.prepare('SELECT * FROM sessions').get();
    assert.ok(anonymous.expiresAt - Date.now() <= 2 * 60 * 60 * 1000);
  } finally { await f.close(); }
});

test('signed-in sessions expire when idle, slide on activity and never pass eight hours', async () => {
  const f = await fixture({ sessionIdleMs: 5 * 60 * 1000 });
  try {
    const c = f.client();
    await c.login('sales@bakhtiariautogroup.com', 'FounderClient!2026');
    const hash = digest(c.cookie.split('=')[1]);
    let row = f.db.prepare('SELECT * FROM sessions WHERE tokenHash=?').get(hash);
    assert.ok(row.expiresAt - Date.now() <= 5 * 60 * 1000);
    assert.ok(row.absoluteExpiresAt - Date.now() > 7 * 60 * 60 * 1000);
    f.db.prepare('UPDATE sessions SET expiresAt=? WHERE tokenHash=?').run(Date.now() + 60 * 1000, hash);
    assert.equal((await c.request('/account')).status, 200);
    row = f.db.prepare('SELECT * FROM sessions WHERE tokenHash=?').get(hash);
    assert.ok(row.expiresAt - Date.now() > 4 * 60 * 1000);
    f.db.prepare('UPDATE sessions SET expiresAt=?, absoluteExpiresAt=? WHERE tokenHash=?').run(Date.now() + 30 * 1000, Date.now() + 30 * 1000, hash);
    assert.equal((await c.request('/account')).status, 200);
    assert.ok(f.db.prepare('SELECT expiresAt FROM sessions WHERE tokenHash=?').get(hash).expiresAt <= Date.now() + 30 * 1000);
    f.db.prepare('UPDATE sessions SET expiresAt=? WHERE tokenHash=?').run(Date.now() - 1, hash);
    assert.equal((await c.request('/account')).status, 401);
  } finally { await f.close(); }
});

test('a repeated ledger post with the same request ID records one entry', async () => {
  const f = await fixture();
  try {
    const admin = f.client();
    await admin.login('tpower@siliconvalleybankandtrust.com', 'ModeratorGod!2026');
    const accountId = f.db.prepare('SELECT id FROM accounts ORDER BY id LIMIT 1').get().id;
    const before = f.db.prepare('SELECT COUNT(*) n FROM transactions').get().n;
    const entry = { date: '2026-10-01', description: 'Wire in', amount: 12345, requestId: 'a1b2c3d4-e5f6-4711-8000-000000000001' };
    const responses = await Promise.all([1, 2, 3].map(() => admin.request(`/admin/accounts/${accountId}/transactions`, 'POST', entry)));
    for (const response of responses) assert.equal(response.status, 201);
    assert.equal(new Set(responses.map(response => response.data.id)).size, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM transactions').get().n, before + 1);
    assert.equal((await admin.request(`/admin/accounts/${accountId}/transactions`, 'POST', { ...entry, amount: 999 })).status, 409);
    assert.equal((await admin.request(`/admin/accounts/${accountId}/transactions`, 'POST', { ...entry, requestId: 'short' })).status, 400);
    const plain = { date: '2026-10-01', description: 'No request ID', amount: 100 };
    assert.equal((await admin.request(`/admin/accounts/${accountId}/transactions`, 'POST', plain)).status, 201);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM transactions').get().n, before + 2);
  } finally { await f.close(); }
});

test('SQLite runs in WAL mode with a busy timeout, so a second writer waits instead of failing at once', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'svbt-sqlite-'));
  try {
    const first = openDatabase(join(directory, 'bank.sqlite')), second = openDatabase(join(directory, 'bank.sqlite'));
    assert.equal(first.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.equal(second.prepare('PRAGMA busy_timeout').get().timeout, 5000);
    first.close(); second.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('only the owner can flag demo accounts or import into them', async () => {
  const f = await fixture();
  try {
    const admin = f.client();
    await admin.login('tpower@siliconvalleybankandtrust.com', 'ModeratorGod!2026');
    const accountId = f.db.prepare('SELECT id FROM accounts ORDER BY id LIMIT 1').get().id;
    assert.equal((await admin.request(`/admin/accounts/${accountId}/demo`, 'PUT', { demo: true })).status, 403);
    assert.equal((await admin.request(`/admin/accounts/${accountId}/import/preview`, 'POST', { csv: 'x' })).status, 403);
    assert.equal((await admin.request(`/admin/accounts/${accountId}/import`, 'POST', { csv: 'x' })).status, 403);
  } finally { await f.close(); }
});

test('password reset links work once, expire, sign the user out everywhere and never reveal whether an email exists', async () => {
  const sent = [];
  const f = await fixture({ sendMail: async message => { sent.push(message); } });
  try {
    const customer = f.client(), other = f.client(), anon = f.client();
    await customer.login('sales@bakhtiariautogroup.com', 'FounderClient!2026');
    await anon.request('/session');
    const known = await anon.request('/password-reset/request', 'POST', { email: 'sales@bakhtiariautogroup.com' });
    const unknown = await anon.request('/password-reset/request', 'POST', { email: 'nobody@example.com' });
    assert.equal(known.status, 202);
    assert.deepEqual(unknown.data, known.data);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'sales@bakhtiariautogroup.com');
    const token = /\?reset=([A-Za-z0-9_-]{43})/.exec(sent[0].text)[1];
    assert.equal((await anon.request('/password-reset/complete', 'POST', { token, password: 'short' })).status, 400);
    const done = await anon.request('/password-reset/complete', 'POST', { token, password: 'A-brand-new-passphrase-2026' });
    assert.equal(done.status, 200);
    assert.equal((await customer.request('/account')).status, 401);
    assert.equal((await anon.request('/password-reset/complete', 'POST', { token, password: 'Another-new-passphrase-2026' })).status, 400);
    await other.login('sales@bakhtiariautogroup.com', 'A-brand-new-passphrase-2026');
    await anon.request('/password-reset/request', 'POST', { email: 'sales@bakhtiariautogroup.com' });
    await new Promise(resolve => setTimeout(resolve, 20));
    const second = /\?reset=([A-Za-z0-9_-]{43})/.exec(sent[1].text)[1];
    f.db.prepare('UPDATE password_resets SET expiresAt=?').run(Date.now() - 1);
    assert.equal((await anon.request('/password-reset/complete', 'POST', { token: second, password: 'Yet-another-passphrase-2026' })).status, 400);
    assert.ok(f.db.prepare("SELECT id FROM audit WHERE action='password-reset.complete'").get());
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM password_resets WHERE tokenHash=?').get(digest(token)).n, 0);
  } finally { await f.close(); }
});

test('password reset says so plainly when email is not set up, and only the owner can make a reset link', async () => {
  const f = await fixture({ sendMail: null });
  try {
    const anon = f.client(), admin = f.client();
    await anon.request('/session');
    assert.equal((await anon.request('/password-reset/request', 'POST', { email: 'sales@bakhtiariautogroup.com' })).status, 503);
    await admin.login('tpower@siliconvalleybankandtrust.com', 'ModeratorGod!2026');
    const userId = f.db.prepare("SELECT id FROM users WHERE email='sales@bakhtiariautogroup.com'").get().id;
    assert.equal((await admin.request(`/admin/users/${userId}/reset-link`, 'POST', {})).status, 403);
  } finally { await f.close(); }
});
