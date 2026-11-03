import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/index.js';

// This suite uses disposable SQLite databases and local HTTP only.
// The application records INTERNAL clearing entries; it does not transmit ACH.
const origin = 'http://localhost:3000';
const customer = ['sales@bakhtiariautogroup.com', 'FounderClient!2026'];
const admin = ['tpower@siliconvalleybankandtrust.com', 'ModeratorGod!2026'];
const pin = '482916';
const balance = (db, id) => db.prepare(
  'SELECT COALESCE(SUM(amount),0) AS n FROM transactions WHERE accountId=?'
).get(id).n;
const count = (db, table) => db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n;

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'svbt-external-test-'));
  let app, server;
  try {
    app = await createApp({
      production: false, origin, frontend: false, demoSeed: true,
      dbPath: join(directory, 'bank.sqlite'),
      statementDir: join(directory, 'statements'),
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const endpoint = 'http://127.0.0.1:' + server.address().port;
    function client() {
      let cookie = '', csrf = '';
      return {
        async request(path, method = 'GET', body) {
          const response = await fetch(endpoint + '/api' + path, {
            method,
            headers: {
              ...(cookie ? { Cookie: cookie } : {}),
              ...(method === 'GET' ? {} : {
                Origin: origin, 'X-CSRF-Token': csrf,
                'Content-Type': 'application/json',
              }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          const setCookie = response.headers.get('set-cookie');
          if (setCookie) cookie = setCookie.split(';')[0];
          const data = await response.json();
          if (data.csrfToken) csrf = data.csrfToken;
          return { status: response.status, data };
        },
        async login(email, password) {
          await this.request('/session');
          const result = await this.request('/login', 'POST', { email, password });
          assert.equal(result.status, 200, JSON.stringify(result.data));
        },
      };
    }
    const sender = client(), staff = client(), anonymous = client();
    await sender.login(...customer);
    await staff.login(...admin);
    const db = app.locals.db;
    const from = db.prepare('SELECT a.* FROM accounts a JOIN users u ON u.id=a.userId WHERE u.email=?').get(customer[0]);
    assert.ok(from);
    assert.equal((await sender.request('/transfer-pin', 'PUT', { password: customer[1], pin })).status, 200);
    return {
      db, from, sender, staff, anonymous, directory,
      async close() {
        await new Promise(resolve => server.close(resolve));
        await app.locals.close();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (app) await app.locals.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

const transfer = (extra = {}) => ({
  pin, amount: 100, description: 'Isolated ACH simulation',
  requestId: randomUUID(),
  bank: {
    name: 'Test institution', nickname: 'Test destination',
    routingNumber: '026009593', accountNumber: '123456789',
  },
  ...extra,
});

test('outbound ACH request is idempotent, balances reconcile, and customer cannot settle', async () => {
  const f = await fixture();
  try {
    const initial = balance(f.db, f.from.id);
    const body = transfer();
    const unauthorized = await f.anonymous.request('/external');
    assert.equal(unauthorized.status, 401);
    const responses = await Promise.all([
      f.sender.request('/external/transfer', 'POST', body),
      f.sender.request('/external/transfer', 'POST', body),
    ]);
    for (const response of responses) assert.equal(response.status, 201, JSON.stringify(response.data));
    assert.equal(responses[0].data.id, responses[1].data.id);
    assert.equal(count(f.db, 'external_transfers'), 1);
    const row = f.db.prepare('SELECT * FROM external_transfers').get();
    assert.equal(row.status, 'pending');
    assert.equal(balance(f.db, f.from.id), initial - 100);
    assert.equal(balance(f.db, row.settlementAccountId), 100);
    assert.equal(f.db.prepare('SELECT amount FROM transactions WHERE id=?').get(row.debitId).amount, -100);
    assert.equal(f.db.prepare('SELECT amount FROM transactions WHERE id=?').get(row.creditId).amount, 100);
    assert.equal((await f.sender.request('/external/transfer', 'POST', { ...body, amount: 200 })).status, 409);
    assert.equal((await f.sender.request('/admin/external')).status, 403);
    assert.equal((await f.sender.request('/admin/external/' + row.id + '/settle', 'POST', { status: 'settled' })).status, 403);
    const queue = await f.staff.request('/admin/external');
    assert.equal(queue.status, 200);
    assert.equal(queue.data.count, 1);
    assert.equal(queue.data.pending[0].id, row.id);
  } finally { await f.close(); }
});

test('return restores balances once, settled transfers are not refundable by settlement API', async () => {
  const f = await fixture();
  try {
    const initial = balance(f.db, f.from.id);
    const returned = await f.sender.request('/external/transfer', 'POST', transfer());
    assert.equal(returned.status, 201, JSON.stringify(returned.data));
    const first = f.db.prepare('SELECT * FROM external_transfers WHERE id=?').get(returned.data.id);
    const result = await f.staff.request('/admin/external/' + first.id + '/settle', 'POST', { status: 'returned' });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.status, 'returned');
    assert.equal(balance(f.db, f.from.id), initial);
    assert.equal(balance(f.db, first.settlementAccountId), 0);
    assert.equal((await f.staff.request('/admin/external/' + first.id + '/settle', 'POST', { status: 'settled' })).status, 409);
    assert.equal((await f.sender.request('/external/transfer', 'POST', transfer({ requestId: first.requestId }))).status, 409);
    const settled = await f.sender.request('/external/transfer', 'POST', transfer());
    assert.equal(settled.status, 201, JSON.stringify(settled.data));
    const second = await f.staff.request('/admin/external/' + settled.data.id + '/settle', 'POST', { status: 'settled' });
    assert.equal(second.status, 200, JSON.stringify(second.data));
    assert.equal(second.data.status, 'settled');
    assert.equal(balance(f.db, f.from.id), initial - 100);
    assert.equal(balance(f.db, first.settlementAccountId), 100);
    assert.equal((await f.staff.request('/admin/external/' + settled.data.id + '/settle', 'POST', { status: 'returned' })).status, 409);
    assert.equal((await f.staff.request('/admin/external')).data.count, 0);
    assert.equal(count(f.db, 'external_transfers'), 2);
  } finally { await f.close(); }
});

test('invalid input, insufficient funds and injected write failure cannot leave partial transfers', async () => {
  const f = await fixture();
  try {
    const snapshot = () => ({
      transactions: count(f.db, 'transactions'),
      transfers: count(f.db, 'external_transfers'),
      users: count(f.db, 'users'),
      accounts: count(f.db, 'accounts'),
      audit: count(f.db, 'audit'),
    });
    const before = snapshot();
    for (const body of [
      transfer({ amount: 0 }),
      transfer({ amount: -1 }),
      transfer({ amount: '100' }),
      transfer({ amount: 1.5 }),
      transfer({ bank: { name: 'Test institution', routingNumber: '000000000', accountNumber: '123456789' } }),
    ]) {
      const result = await f.sender.request('/external/transfer', 'POST', body);
      assert.equal(result.status, 400, JSON.stringify(result.data));
      assert.deepEqual(snapshot(), before);
    }
    const tooMuch = await f.sender.request('/external/transfer', 'POST', transfer({ amount: 1000000000 }));
    assert.equal(tooMuch.status, 409);
    assert.deepEqual(snapshot(), before);
    f.db.exec("CREATE TRIGGER fail_external_test BEFORE INSERT ON external_transfers BEGIN SELECT RAISE(ABORT,'Injected rollback'); END");
    const failed = await f.sender.request('/external/transfer', 'POST', transfer());
    assert.ok(failed.status >= 400, JSON.stringify(failed.data));
    assert.deepEqual(snapshot(), before);
    assert.equal(f.db.prepare("SELECT value FROM metadata WHERE key='external-settlement-account'").get(), undefined);
    f.db.exec('DROP TRIGGER fail_external_test');
    const recovered = await f.sender.request('/external/transfer', 'POST', transfer());
    assert.equal(recovered.status, 201, JSON.stringify(recovered.data));
    assert.equal(count(f.db, 'external_transfers'), 1);
  } finally { await f.close(); }
});
