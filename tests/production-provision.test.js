import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

function child(source, overrides = {}) {
  const privatePassword = randomBytes(24).toString('base64url');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 30000,
    env: { ...process.env, NODE_ENV: 'production', DEMO_SEED: 'false', SAMPLE_DATA: 'false',
      MODERATOR_EMAIL: 'tpower@siliconvalleybankandtrust.com', MODERATOR_PASSWORD: privatePassword,
      DEMO_MODERATOR_PASSWORD: privatePassword, ...overrides }
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

test('unseeded production provisions the private owner password despite a legacy demo alias', () => {
  const result = child(`
    import { createApp } from './server/index.js';
    import { publicPasswords } from './server/db.js';
    const app = await createApp({ dbPath: ':memory:', origin: 'https://example.test', frontend: false });
    const db = app.locals.db;
    const count = table => db.prepare('SELECT count(*) n FROM ' + table).get().n;
    const role = db.prepare('SELECT role FROM staff_access').get().role;
    console.log(JSON.stringify({ users: count('users'), accounts: count('accounts'), transactions: count('transactions'), role,
      publishedBlocked: publicPasswords.has('ModeratorGod!2026'), privateBlocked: publicPasswords.has(process.env.MODERATOR_PASSWORD) }));
    await app.locals.close();
  `);
  assert.deepEqual(result, { users: 1, accounts: 0, transactions: 0, role: 'owner', publishedBlocked: true, privateBlocked: false });
});

test('sample mode continues blocking configured demo passwords', () => {
  assert.deepEqual(child(`
    import { publicPasswords } from './server/db.js';
    console.log(JSON.stringify({ blocked: publicPasswords.has(process.env.MODERATOR_PASSWORD) }));
  `, { SAMPLE_DATA: 'true' }), { blocked: true });
});
