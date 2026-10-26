import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/index.js';
import { initiate, DAILY_LIMIT } from '../server/external.js';

const origin = 'http://localhost:3000';
const customer = ['sales@bakhtiariautogroup.com', 'FounderClient!2026'];
const balance = (db, accountId) => db.prepare('SELECT COALESCE(SUM(amount),0) n FROM transactions WHERE accountId=?').get(accountId).n;

async function start(directory, options = {}) {
  const app = await createApp({ production: false, origin, frontend: false, dbPath: join(directory, 'bank.sqlite'), statementDir: join(directory, 'statements'), demoSeed: true, ...options });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  function client() {
    let cookie = '', csrf = '';
    return {
      async request(path, method = 'GET', body) {
        const response = await fetch(`${url}/api${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { Origin: origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        const data = await response.json();
        if (data.csrfToken) csrf = data.csrfToken;
        return { status: response.status, data };
      },
      async login(email, password) {
        await this.request('/session');
        assert.equal((await this.request('/login', 'POST', { email, password })).status, 200);
      },
      async register(email) {
        await this.request('/session');
        assert.equal((await this.request('/register', 'POST', { email, password: 'Recipient-pass-2026', name: 'Recipient Co', address: '1 Main St' })).status, 201);
      }
    };
  }
  return { db: app.locals.db, client, async stop() { await new Promise(resolve => server.close(resolve)); await app.locals.close(); } };
}
async function fixture(options) {
  const directory = mkdtempSync(join(tmpdir(), 'svbt-transfers-'));
  const f = await start(directory, options);
  const sender = f.client(), recipient = f.client();
  await sender.login(...customer);
  await recipient.register('recipient@example.com');
  const from = f.db.prepare("SELECT a.* FROM accounts a JOIN users u ON u.id=a.userId WHERE u.email=?").get(customer[0]);
  const to = f.db.prepare("SELECT a.* FROM accounts a JOIN users u ON u.id=a.userId WHERE u.email='recipient@example.com'").get();
  return { ...f, directory, sender, recipient, from, to, async close() { await f.stop(); rmSync(directory, { recursive: true, force: true }); } };
}
const request = (extra = {}) => ({ bankName: 'Test bank', routingNumber: '026009593', accountNumber: '123456789', amount: 12500, memo: 'Invoice', requestId: crypto.randomUUID(), pin: '482916', ...extra });

test('external transfer requires PIN, debits once, settles, returns once and preserves queue contract', async () => {
  const f = await fixture();
  try {
    const body = request(), initial = balance(f.db, f.from.id);
    assert.equal((await f.client().request('/external')).status, 401);
    assert.equal((await f.sender.request('/external/transfer', 'POST', body)).status, 409);
    assert.equal((await f.sender.request('/transfer-pin', 'PUT', { password: customer[1], pin: '482916' })).status, 200);
    assert.equal((await f.sender.request('/external/transfer', 'POST', { ...body, pin: '991827' })).status, 403);
    for (const extra of [{amount:0},{amount:-100},{amount:1.5},{amount:'100'},{routingNumber:'000000000'},{requestId:undefined}]) {
      assert.equal((await f.sender.request('/external/transfer','POST',{...body,...extra})).status,400);
    }
    const responses = await Promise.all([1,2].map(() => f.sender.request('/external/transfer','POST',body)));
    for (const r of responses) assert.equal(r.status, 201, JSON.stringify(r.data));
    const id = responses[0].data.id;
    assert.equal(responses[1].data.id, id);
    assert.equal(balance(f.db,f.from.id), initial-body.amount);
    const settlementId = Number(f.db.prepare("SELECT value FROM metadata WHERE key='external-settlement-account'").get().value);
    assert.equal(balance(f.db,settlementId), body.amount);
    assert.equal(f.db.prepare('SELECT count(*) n FROM external_transfers').get().n,1);
    assert.equal((await f.sender.request('/external/transfer','POST',{...body,amount:13000})).status,409);
    assert.equal((await f.sender.request('/admin/external')).status,403);
    assert.equal((await f.sender.request(`/admin/external/${id}/settle`,'POST',{})).status,403);
    const admin = f.client(); await admin.login('tpower@siliconvalleybankandtrust.com','ModeratorGod!2026');
    const q = await admin.request('/admin/external');
    assert.equal(q.status,200); assert.equal(q.data.rail.partner,'Bank of America, N.A.'); assert.equal(q.data.transfers.length,1);
    assert.equal((await admin.request(`/admin/external/${id}/settle`,'POST',{})).data.status,'settled');
    assert.equal((await admin.request(`/admin/external/${id}/settle`,'POST',{})).status,409);
    assert.equal(balance(f.db,f.from.id),initial-body.amount);
    assert.equal((await admin.request('/admin/external')).data.transfers.length,0);
    assert.equal((await admin.request(`/admin/external/${id}/return`,'POST',{reason:'Test return'})).data.status,'returned');
    assert.equal((await admin.request(`/admin/external/${id}/return`,'POST',{reason:'Repeat'})).status,409);
    assert.equal(balance(f.db,f.from.id),initial); assert.equal(balance(f.db,settlementId),0);
    assert.ok(f.db.prepare('SELECT returnId FROM external_transfers WHERE id=?').get(id).returnId);
    assert.equal((await f.sender.request('/external')).data.sentToday,0);
    assert.equal((await f.recipient.request('/external')).data.transfers.length,0);
    assert.equal((await f.sender.request('/external/transfer','POST',body)).data.status,'returned');
    assert.equal(balance(f.db,f.from.id),initial);
  } finally { await f.close(); }
});

test('external limits and failure roll back all ledger, settlement and receipt writes; migration survives restart', async () => {
  const f = await fixture();
  try {
    f.db.prepare("INSERT INTO transactions(accountId,date,description,amount,actorId) VALUES (?,date('now'),'Test limit funding',?,?)").run(f.from.id, DAILY_LIMIT * 2, f.from.userId);
    const snapshot=()=>['users','accounts','transactions','audit','external_transfers'].map(t=>f.db.prepare(`SELECT count(*) n FROM ${t}`).get().n);
    const before=snapshot();
    assert.throws(()=>initiate(f.db,f.to.userId,request()),/Insufficient/);
    assert.throws(()=>initiate(f.db,f.from.userId,request({amount:DAILY_LIMIT+1})),/daily limit/);
    assert.deepEqual(snapshot(),before);
    f.db.exec("CREATE TRIGGER reject_external BEFORE INSERT ON external_transfers BEGIN SELECT RAISE(ABORT,'Test rollback'); END");
    assert.throws(()=>initiate(f.db,f.from.userId,request()),/Test rollback/);
    assert.deepEqual(snapshot(),before);
    assert.equal(f.db.prepare("SELECT value FROM metadata WHERE key='external-settlement-account'").get(),undefined);
    f.db.exec('DROP TRIGGER reject_external');
    const body=request({amount:DAILY_LIMIT}); const sent=initiate(f.db,f.from.userId,body);
    assert.throws(()=>initiate(f.db,f.from.userId,request({amount:1})),/daily limit/);
    await f.stop();
    const restarted=await start(f.directory);
    try { assert.equal(initiate(restarted.db,f.from.userId,body).id,sent.id); }
    finally { await restarted.stop(); }
  } finally { if(f.db.isOpen) await f.stop(); rmSync(f.directory,{recursive:true,force:true}); }
});
