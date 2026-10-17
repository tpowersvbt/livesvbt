'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const path = require('node:path');
const { validateContact } = require('../src/contact');

execSync('node scripts/build.js', { cwd: path.join(__dirname, '..') });
const server = require('../server');

test('contact validation', () => {
  assert.ok(Object.keys(validateContact({}).errors).length > 0);
  const ok = validateContact({ name: 'Ann', email: 'a@b.co', topic: 'business', message: 'Hello there, please call.' });
  assert.deepStrictEqual(ok.errors, {});
});

test('server routes', async (t) => {
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.strictEqual((await fetch(base + '/healthz')).status, 200);
  assert.strictEqual((await fetch(base + '/')).status, 200);
  assert.strictEqual((await fetch(base + '/contact')).status, 200);
  assert.strictEqual((await fetch(base + '/nope')).status, 404);
  assert.strictEqual((await fetch(base + '/%2e%2e/package.json')).status, 404);
  const bad = await fetch(base + '/api/contact', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: '{}' });
  assert.strictEqual(bad.status, 400);
  const good = await fetch(base + '/api/contact', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ name: 'Ann', email: 'a@b.co', topic: 'other', message: 'Hello there, please call.' }) });
  assert.strictEqual(good.status, 200);
});
