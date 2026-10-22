import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const derive = promisify(scrypt);
export const demoCredentials = { customer: [process.env.DEMO_CUSTOMER_EMAIL || 'sales@bakhtiariautogroup.com', process.env.DEMO_CUSTOMER_PASSWORD || 'FounderClient!2026'], moderator: [process.env.DEMO_MODERATOR_EMAIL || 'tpower@siliconvalleybankandtrust.com', process.env.DEMO_MODERATOR_PASSWORD || 'ModeratorGod!2026'] };
// Passwords that have been published in this repository, its history or its guides. They are
// local-demo values only and are refused for real accounts.
export const publicPasswords = new Set(['FounderClient!2026', 'ModeratorGod!2026', 'svbt2026!', 'YourSecurePassword123!@#', 'YourSecurePassword!2026', ...Object.values(demoCredentials).map(([, value]) => value)]);
export async function hashPassword(password) {
  const salt = randomBytes(32).toString('hex');
  const hash = await derive(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return `scrypt$131072$8$1$${salt}$${hash.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  const [algorithm, n, r, p, salt, hex] = encoded.split('$');
  if (algorithm !== 'scrypt' || n !== '131072' || r !== '8' || p !== '1' || !/^[a-f0-9]{128}$/.test(hex || '')) return false;
  const actual = await derive(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(hex, 'hex'));
}
export function atomic(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = operation(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function audit(db, actorId, action, entity, details = {}) {
  db.prepare('INSERT INTO audit(actorId, action, entity, details) VALUES (?, ?, ?, ?)').run(actorId ?? null, action, String(entity), JSON.stringify(details));
}
export function newAccount(db, userId, name, address) {
  let number;
  do { number = String(randomInt(100000, 1000000)) + String(randomInt(0, 1000000)).padStart(6, '0'); } while (db.prepare('SELECT id FROM accounts WHERE number = ?').get(number));
  return Number(db.prepare('INSERT INTO accounts(userId, number, name, address) VALUES (?, ?, ?, ?)').run(userId, number, name, address).lastInsertRowid);
}
export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, address TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('customer','moderator')), passwordHash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS accounts(id INTEGER PRIMARY KEY, userId INTEGER NOT NULL UNIQUE REFERENCES users(id), number TEXT NOT NULL UNIQUE CHECK(length(number)=12 AND number NOT GLOB '*[^0-9]*'), name TEXT NOT NULL, address TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY, accountId INTEGER NOT NULL REFERENCES accounts(id), date TEXT NOT NULL, description TEXT NOT NULL, amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount != 0 AND abs(amount)<=100000000000), reversalOf INTEGER UNIQUE REFERENCES transactions(id), actorId INTEGER REFERENCES users(id), createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS transaction_details(transactionId INTEGER PRIMARY KEY REFERENCES transactions(id), referenceId TEXT NOT NULL DEFAULT '', occurredAt TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS statement_notes(accountId INTEGER NOT NULL REFERENCES accounts(id), month TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(accountId,month));
    CREATE TABLE IF NOT EXISTS sessions(tokenHash TEXT PRIMARY KEY, userId INTEGER REFERENCES users(id), csrfToken TEXT NOT NULL, expiresAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS statements(id INTEGER PRIMARY KEY, accountId INTEGER NOT NULL REFERENCES accounts(id), month TEXT NOT NULL, revision INTEGER NOT NULL, issuedAt TEXT NOT NULL, closing INTEGER NOT NULL, snapshot TEXT NOT NULL, hash TEXT NOT NULL, pdf BLOB NOT NULL, pdfHash TEXT NOT NULL, archivePath TEXT NOT NULL, UNIQUE(accountId,month,revision));
    CREATE TABLE IF NOT EXISTS investments(id INTEGER PRIMARY KEY, sector TEXT NOT NULL, status TEXT NOT NULL, targetCapital INTEGER NOT NULL CHECK(typeof(targetCapital)='integer' AND targetCapital>=0 AND targetCapital<=100000000000), risk TEXT NOT NULL, strategy TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, actorId INTEGER REFERENCES users(id), action TEXT NOT NULL, entity TEXT NOT NULL, details TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS valid_reversal BEFORE INSERT ON transactions WHEN NEW.reversalOf IS NOT NULL BEGIN
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM transactions WHERE id=NEW.reversalOf AND accountId=NEW.accountId AND amount=-NEW.amount AND reversalOf IS NULL AND date<=NEW.date) THEN RAISE(ABORT,'Invalid reversal') END;
    END;
  `);
  for (const table of ['transactions', 'statements', 'audit']) {
    for (const operation of ['UPDATE', 'DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS immutable_${table}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Immutable ${table}'); END;`);
  }
  return db;
}
export async function seedDemo(db, { moderatorId, customerPassword } = {}) {
  if (db.prepare("SELECT value FROM metadata WHERE key='demo-seeded'").get()) return;
  const customerHash = await hashPassword(customerPassword || demoCredentials.customer[1]);
  const moderatorHash = moderatorId ? null : await hashPassword(demoCredentials.moderator[1]);
  atomic(db, () => {
    if (db.prepare("SELECT value FROM metadata WHERE key='demo-seeded'").get()) return;
    function accountUser(email, name, address, role, hash) {
      const existing = db.prepare('SELECT id,role FROM users WHERE email=?').get(email);
      if (existing) {
        if (existing.role !== role) throw new Error('Sample account email belongs to a different role.');
        return existing.id;
      }
      return Number(db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run(email, name, address, role, hash).lastInsertRowid);
    }
    const customer = accountUser(demoCredentials.customer[0], 'Bakhtiari Auto Group, LLC', '3155 Stevens Creek, San Jose, CA 95117', 'customer', customerHash);
    const moderator = moderatorId || accountUser(demoCredentials.moderator[0], 'Timothy Powers', 'Silicon Valley, California', 'moderator', moderatorHash);
    const existingAccount = db.prepare('SELECT id FROM accounts WHERE userId=?').get(customer);
    const accountId = existingAccount?.id || newAccount(db, customer, 'Bakhtiari Auto Group, LLC', '3155 Stevens Creek, San Jose, CA 95117');
    if (db.prepare('SELECT id FROM transactions WHERE accountId=?').get(accountId)) throw new Error('Existing ledger has activity; sample data was not added.');
    const descriptions = ['Cloud infrastructure', 'Software subscriptions', 'Office rent', 'Internet and communications', 'Business insurance', 'Accounting services', 'Digital marketing', 'Contract engineering', 'Office supplies', 'Security monitoring', 'Technology hardware', 'Business travel'];
    const base = [65000, 32000, 180000, 18000, 28000, 45000, 50000, 60000, 12000, 22000, 35000, 29700];
    const insert = db.prepare('INSERT INTO transactions(accountId,date,description,amount,actorId) VALUES (?,?,?,?,?)');
    for (let m = 0; m < 4; m++) {
      const month = `2026-${String(m + 6).padStart(2, '0')}`;
      insert.run(accountId, `${month}-02`, m ? 'Investment funding from Bakhtiari Corp. Wells Fargo Account' : 'Opening deposit', m ? 1500000 : 1000000, moderator);
      descriptions.forEach((description, i) => insert.run(accountId, `${month}-${String(i + 3).padStart(2, '0')}`, description, -(base[i] + (i === 11 ? m * 11700 : 0)), moderator));
    }
    for (const [sector, capital, strategy] of [['Startup technologies', 250000000, 'Milestone-based capital and runway planning'], ['Small data centers', 500000000, 'Capacity, cooling and energy resilience'], ['REITs', 350000000, 'Diversified property cash-flow review']]) db.prepare('INSERT INTO investments(sector,status,targetCapital,risk,strategy) VALUES (?,?,?,?,?)').run(sector, 'Review', capital, 'Capital at risk', strategy);
    audit(db, moderator, 'demo.seed', accountId, { months: 4 });
    db.prepare("INSERT INTO metadata(key,value) VALUES ('demo-seeded',?)").run(String(accountId));
  });
}
