import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, newAccount } from '../server/db.js';
import { postTransaction, issueStatement, integrity } from '../server/services.js';
import { migrate, migrations, schemaVersion } from '../server/migrations.js';
import { backupDatabase } from '../server/backup.js';
import { restoreDatabase } from '../server/restore-bootstrap.js';

function bank(dir) {
  const db = openDatabase(join(dir, 'bank.sqlite'));
  const user = (email, role = 'customer') => Number(db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run(email, email, 'Address', role, 'x').lastInsertRowid);
  const staff = user('staff@example.com', 'moderator');
  return { db, staff, account: email => newAccount(db, user(email), email, 'Address') };
}

test('a reassigned account number cannot overwrite another account\'s issued statement archive', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'svbt-data-'));
  const { db, staff, account } = bank(dir);
  try {
    const first = account('first@example.com'), second = account('second@example.com');
    for (const id of [first, second]) postTransaction(db, id, { date: '2026-01-05', description: 'Deposit', amount: 10000 }, staff);
    const original = await issueStatement(db, first, '2026-01', staff, join(dir, 'statements'));
    const firstNumber = db.prepare('SELECT number FROM accounts WHERE id=?').get(first).number;
    // Staff renumber the first account, then give its old number to the second account.
    db.prepare("UPDATE accounts SET number='111111111111' WHERE id=?").run(first);
    db.prepare('UPDATE accounts SET number=? WHERE id=?').run(firstNumber, second);
    const other = await issueStatement(db, second, '2026-01', staff, join(dir, 'statements'));
    const paths = db.prepare('SELECT archivePath FROM statements ORDER BY id').all().map(row => row.archivePath);
    assert.notEqual(paths[0], paths[1]);
    assert.equal(integrity(db, original.id).valid, true);
    assert.equal(integrity(db, other.id).valid, true);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('migrations are versioned, idempotent and guard ledger values at the database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'svbt-migrate-'));
  const { db, staff, account } = bank(dir);
  try {
    const id = account('customer@example.com');
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
    assert.equal(migrate(db), schemaVersion);
    assert.equal(migrate(db), schemaVersion);
    const insert = date => db.prepare('INSERT INTO transactions(accountId,date,description,amount,actorId) VALUES (?,?,?,?,?)').run(id, date, 'Entry', 100, staff);
    for (const bad of ['2026-02-30', '2026-1-5', '05/01/2026', '1899-12-31']) assert.throws(() => insert(bad), /Invalid ledger date/, bad);
    insert('2026-02-28');
    assert.throws(() => db.prepare("INSERT INTO statements(accountId,month,revision,issuedAt,closing,snapshot,hash,pdf,pdfHash,archivePath) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, '2026-02', 1, 'now', 1.5, '{}', 'h', Buffer.from('p'), 'h', 'p'), /integer cents/);

    let ran = 0;
    const next = schemaVersion + 1;
    const failing = [...migrations, { version: next, name: 'broken', up(d) { ran++; d.exec('CREATE TABLE partial(id INTEGER)'); throw new Error('boom'); } }];
    assert.throws(() => migrate(db, failing), new RegExp(`migration ${next} \\(broken\\) failed: boom`));
    assert.equal(ran, 1);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, schemaVersion);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='partial'").get(), undefined);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('backup captures committed WAL data and restores through the restore endpoint\'s checks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'svbt-backup-'));
  const { db, staff, account } = bank(dir);
  try {
    migrate(db);
    const id = account('customer@example.com');
    postTransaction(db, id, { date: '2026-03-01', description: 'Deposit', amount: 123456 }, staff);
    // The writer stays open, so the entry above is still only in the WAL file.
    const { file, sha256 } = backupDatabase(join(dir, 'bank.sqlite'), join(dir, 'backups'));
    const target = join(dir, 'restored.sqlite');
    restoreDatabase(readFileSync(file), target, sha256);
    const copy = new DatabaseSync(target, { readOnly: true });
    try {
      assert.equal(copy.prepare('SELECT sum(amount) total FROM transactions').get().total, 123456);
      assert.equal(copy.prepare('PRAGMA user_version').get().user_version, schemaVersion);
    } finally { copy.close(); }
    assert.ok(gunzipSync(readFileSync(file)).subarray(0, 15).toString() === 'SQLite format 3');
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
