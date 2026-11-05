import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { verifyPassword, openDatabase, seedDemo, hashPassword, demoCredentials } from '../server/db.js';

test('operations startup provisions moderator, preserves four months and survives restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'svbt-handoff-'));
  const oldEmail = process.env.MODERATOR_EMAIL, oldPassword = process.env.MODERATOR_PASSWORD;
  process.env.MODERATOR_EMAIL = 'operations@example.com';
  process.env.MODERATOR_PASSWORD = 'UniqueOperationsTest!2026';
  const options = { production: true, demoSeed: false, sampleData: true, origin: 'https://bank.example', frontend: false, dbPath: join(dir, 'bank.sqlite'), statementDir: join(dir, 'statements') };
  let app;
  try {
    app = await createApp(options);
    const db = app.locals.db;
    const moderator = db.prepare('SELECT * FROM users WHERE email=?').get(process.env.MODERATOR_EMAIL);
    assert.equal(moderator.role, 'moderator');
    assert.ok(await verifyPassword(process.env.MODERATOR_PASSWORD, moderator.passwordHash));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 2);
    assert.deepEqual(db.prepare('SELECT month FROM statements ORDER BY month').all().map(x => x.month), ['2026-06','2026-07','2026-08','2026-09']);
    const before = db.prepare('SELECT id,hash,pdfHash FROM statements ORDER BY id').all();
    const transactions = db.prepare('SELECT COUNT(*) n FROM transactions').get().n;
    const customer = db.prepare("SELECT * FROM users WHERE role='customer'").get();
    assert.equal(await verifyPassword(demoCredentials.customer[1], customer.passwordHash), false);
    await app.locals.close(); app = null;
    process.env.MODERATOR_PASSWORD = 'ChangedEnvDoesNotReset!2026';
    app = await createApp(options);
    assert.equal(app.locals.db.prepare('SELECT COUNT(*) n FROM transactions').get().n, transactions);
    assert.deepEqual(app.locals.db.prepare('SELECT id,hash,pdfHash FROM statements ORDER BY id').all(), before);
    assert.equal(app.locals.db.prepare('SELECT passwordHash FROM users WHERE id=?').get(moderator.id).passwordHash, moderator.passwordHash);
  } finally {
    if (app) await app.locals.close();
    if (oldEmail === undefined) delete process.env.MODERATOR_EMAIL; else process.env.MODERATOR_EMAIL = oldEmail;
    if (oldPassword === undefined) delete process.env.MODERATOR_PASSWORD; else process.env.MODERATOR_PASSWORD = oldPassword;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sample setup reuses a pre-provisioned customer without duplicate email or password reset', async () => {
  const db = openDatabase(':memory:');
  try {
    const hash = await hashPassword('ExistingCustomerSecret!2026');
    db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run(demoCredentials.customer[0], 'Existing', 'Review', 'customer', hash);
    await seedDemo(db);
    await seedDemo(db);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 2);
    assert.equal(db.prepare('SELECT passwordHash FROM users WHERE email=?').get(demoCredentials.customer[0]).passwordHash, hash);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM transactions').get().n, 52);
  } finally { db.close(); }
});
