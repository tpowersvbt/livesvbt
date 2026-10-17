const test = require('node:test');
const assert = require('node:assert');
const { createServer } = require('../server');

test('serves pages, health, 404 and blocks traversal', async (t) => {
  const s = createServer().listen(0);
  t.after(() => s.close());
  const base = `http://127.0.0.1:${s.address().port}`;
  const home = await fetch(base + '/');
  assert.strictEqual(home.status, 200);
  assert.match(await home.text(), /Silicon Valley Bank and Trust/);
  assert.strictEqual((await fetch(base + '/healthz')).status, 200);
  assert.strictEqual((await fetch(base + '/nope')).status, 404);
  const trav = await fetch(base + '/..%2fserver.js');
  assert.notStrictEqual(trav.status, 200);
});
