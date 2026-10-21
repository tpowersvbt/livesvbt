import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { createApp } from '../server/index.js';
import { openDatabase, verifyPassword } from '../server/db.js';
import { digest } from '../server/services.js';

const origin = 'http://localhost:3000';
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
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
