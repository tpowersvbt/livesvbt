import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/index.js';
import { trivialPin } from '../server/transfers.js';

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
const request = (to, amount, extra = {}) => ({ toAccountNumber: to.number, amount, description: 'Parts invoice 42', pin: '482916', requestId: crypto.randomUUID(), ...extra });

test('trivial PINs are recognised', () => {
  for (const value of ['000000', '777777', '123456', '654321', '890123', '210987']) assert.ok(trivialPin(value), value);
  for (const value of ['482916', '112233', '135790']) assert.ok(!trivialPin(value), value);
});

test('a transfer needs a PIN set with the password, and moves money as two linked entries', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.sender.request('/transfers', 'POST', request(f.to, 100))).status, 409);
    assert.equal((await f.sender.request('/transfer-pin', 'PUT', { password: 'wrong-password-123', pin: '482916' })).status, 403);
    assert.equal((await f.sender.request('/transfer-pin', 'PUT', { password: customer[1], pin: '123456' })).status, 400);
    assert.equal((await f.sender.request('/transfer-pin', 'PUT', { password: customer[1], pin: '48291' })).status, 400);
    const set = await f.sender.request('/transfer-pin', 'PUT', { password: customer[1], pin: '482916' });
    assert.equal(set.status, 200);
    assert.equal(set.data.pinSet, true);
    assert.ok(!JSON.stringify(f.db.prepare('SELECT pinHash FROM transfer_pins').get()).includes('482916'));

    const before = [balance(f.db, f.from.id), balance(f.db, f.to.id)];
    const sent = await f.sender.request('/transfers', 'POST', request(f.to, 123456));
    assert.equal(sent.status, 201);
    assert.equal(sent.data.direction, 'sent');
    assert.equal(sent.data.counterpartyEnding, f.to.number.slice(-4));
    assert.deepEqual([balance(f.db, f.from.id), balance(f.db, f.to.id)], [before[0] - 123456, before[1] + 123456]);
    const row = f.db.prepare('SELECT * FROM transfers').get();
    const debit = f.db.prepare('SELECT * FROM transactions WHERE id=?').get(row.debitId), credit = f.db.prepare('SELECT * FROM transactions WHERE id=?').get(row.creditId);
    assert.equal(debit.amount, -123456); assert.equal(credit.amount, 123456);
    assert.equal(debit.date, new Date().toISOString().slice(0, 10));
    assert.match(credit.description, /^Transfer from Bakhtiari Auto Group, LLC …\d{4}: Parts invoice 42$/);
    assert.ok(f.db.prepare("SELECT id FROM audit WHERE action='transfer.post'").get());
    assert.throws(() => f.db.prepare('UPDATE transfers SET amount=1').run(), /Immutable transfers/);
    assert.throws(() => f.db.prepare('DELETE FROM transfers').run(), /Immutable transfers/);

    const received = await f.recipient.request('/transfers');
    assert.equal(received.data.transfers[0].direction, 'received');
    assert.equal(received.data.pinSet, false);
    assert.equal((await f.recipient.request('/account')).data.balance, 123456);
  } finally { await f.close(); }
});

test('the recipient is only looked up after a correct PIN, and other mistakes are refused', async () => {
  const f = await fixture();
  try {
    await f.sender.request('/transfer-pin', 'PUT', { password: customer[1], pin: '482916' });
    const unknown = { number: '999999999999' };
    assert.equal((await f.sender.request('/transfers', 'POST', request(unknown, 100, { pin: '111222' }))).status, 403);
    assert.equal((await f.sender.request('/transfers', 'POST', request(unknown, 100))).status, 404);
    assert.equal((await f.sender.request('/transfers', 'POST', request(f.from, 100))).status, 400);
    for (const amount of [0, -5, 1.5, '100']) assert.equal((await f.sender.request('/transfers', 'POST', request(f.to, amount))).status, 400);
    assert.equal(f.db.prepare('SELECT count(*) n FROM transfers').get().n, 0);
  } finally { await f.close(); }
});

test('customers cannot overdraw, and the daily limit counts every transfer sent that day', async () => {
  const f = await fixture({ transferDailyLimit: 50000 });
  try {
    await f.recipient.request('/transfer-pin', 'PUT', { password: 'Recipient-pass-2026', pin: '730518' });
    const empty = await f.recipient.request('/transfers', 'POST', request(f.from, 1, { pin: '730518' }));
    assert.equal(empty.status, 409);
    assert.match(empty.data.error, /Insufficient/);
    await f.sender.request('/transfer-pin', 'PUT', { password: customer[1], pin: '482916' });
    assert.equal((await f.sender.request('/transfers', 'POST', request(f.to, 30000))).status, 201);
    const over = await f.sender.request('/transfers', 'POST', request(f.to, 20001));
    assert.equal(over.status, 409);
    assert.match(over.data.error, /daily transfer limit/);
    assert.equal((await f.sender.request('/transfers', 'POST', request(f.to, 20000))).status, 201);
    assert.equal((await f.sender.request('/transfers')).data.sentToday, 50000);
    // The recipient can send on what they received, and not a cent more.
    assert.equal((await f.recipient.request('/transfers', 'POST', request(f.from, 50001, { pin: '730518' }))).status, 409);
    assert.equal((await f.recipient.request('/transfers', 'POST', request(f.from, 50000, { pin: '730518' }))).status, 201);
    assert.equal((await f.recipient.request('/account')).data.balance, 0);
  } finally { await f.close(); }
});

test('a double-submitted transfer with the same request ID moves money once', async () => {
  const f = await fixture();
  try {
    await f.sender.request('/transfer-pin', 'PUT', { password: customer[1], pin: '482916' });
    const body = request(f.to, 2500);
    const responses = await Promise.all([1, 2].map(() => f.sender.request('/transfers', 'POST', body)));
    for (const response of responses) assert.equal(response.status, 201);
    assert.equal(new Set(responses.map(response => response.data.id)).size, 1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM transfers').get().n, 1);
    assert.equal(balance(f.db, f.to.id), 2500);
    assert.equal((await f.sender.request('/transfers', 'POST', { ...body, amount: 2600 })).status, 409);
    assert.equal((await f.recipient.request('/transfer-pin', 'PUT', { password: 'Recipient-pass-2026', pin: '730518' })).status, 200);
    assert.equal((await f.recipient.request('/transfers', 'POST', { ...body, toAccountNumber: f.from.number, pin: '730518' })).status, 409);
  } finally { await f.close(); }
});

test('five wrong PINs lock transfers for 30 minutes, and the lock survives a restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'svbt-transfers-'));
  try {
    let f = await start(directory);
    let sender = f.client();
    await sender.login(...customer);
    await sender.request('/transfer-pin', 'PUT', { password: customer[1], pin: '482916' });
    const to = { number: '999999999999' };
    for (let i = 0; i < 5; i++) assert.equal((await sender.request('/transfers', 'POST', request(to, 100, { pin: '111222' }))).status, 403);
    assert.equal((await sender.request('/transfers', 'POST', request(to, 100))).status, 429);
    assert.ok(f.db.prepare("SELECT id FROM audit WHERE action='transfer-pin.locked'").get());
    // Changing the PIN does not lift an active lock.
    await sender.request('/transfer-pin', 'PUT', { password: customer[1], pin: '592047' });
    assert.equal((await sender.request('/transfers', 'POST', request(to, 100, { pin: '592047' }))).status, 429);
    assert.ok((await sender.request('/transfers')).data.lockedUntil);
    await f.stop();

    f = await start(directory);
    sender = f.client();
    await sender.login(...customer);
    assert.equal((await sender.request('/transfers', 'POST', request(to, 100, { pin: '592047' }))).status, 429);
    f.db.prepare('UPDATE transfer_pins SET lockedUntil=?').run(Date.now() - 1);
    assert.equal((await sender.request('/transfers', 'POST', request(to, 100, { pin: '592047' }))).status, 404);
    // A correct PIN clears the count, so earlier mistakes do not carry over.
    for (let i = 0; i < 4; i++) assert.equal((await sender.request('/transfers', 'POST', request(to, 100, { pin: '111222' }))).status, 403);
    assert.equal((await sender.request('/transfers', 'POST', request(to, 100, { pin: '592047' }))).status, 404);
    assert.equal(f.db.prepare('SELECT failedCount FROM transfer_pins').get().failedCount, 0);
    await f.stop();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('staff without a customer account cannot set a PIN or send transfers', async () => {
  const f = await fixture();
  try {
    const admin = f.client();
    await admin.login('tpower@siliconvalleybankandtrust.com', 'ModeratorGod!2026');
    assert.equal((await admin.request('/transfer-pin', 'PUT', { password: 'ModeratorGod!2026', pin: '482916' })).status, 404);
    assert.equal((await admin.request('/transfers', 'POST', request(f.to, 100))).status, 404);
    assert.equal((await f.client().request('/transfers')).status, 401);
  } finally { await f.close(); }
});
