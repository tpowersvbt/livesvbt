// Local-only customer password repair for the dedicated test account.
// Never run against production or a shared/customer-data database.
import { resolve, join } from 'node:path';
import { openDatabase, hashPassword, atomic, audit, publicPasswords } from '../server/db.js';

const expectedEmail = 'chrismac1124@gmail.com';
const expectedPath = resolve('data/bank.sqlite');
const configuredPath = process.env.DB_PATH ? resolve(process.env.DB_PATH) : null;
const password = process.env.SVBT_LOCAL_CUSTOMER_PASSWORD;
delete process.env.SVBT_LOCAL_CUSTOMER_PASSWORD;

if (process.env.NODE_ENV === 'production' ||
    process.env.SVBT_LOCAL_RESET_CONFIRM !== 'LOCAL_TEST_ONLY' ||
    !configuredPath || configuredPath !== expectedPath) {
  throw new Error('Refusing customer reset: requires explicit LOCAL_TEST_ONLY confirmation and local data/bank.sqlite path.');
}
if (typeof password !== 'string' || password.length < 12 || password.length > 1024 || publicPasswords.has(password)) {
  throw new Error('Choose a unique local password of 12-1024 characters (not a published demo password).');
}
const passwordHash = await hashPassword(password);
const db = openDatabase(configuredPath);
try {
  const user = db.prepare('SELECT id,email,role FROM users WHERE email=?').get(expectedEmail);
  if (!user) throw new Error('Local test customer was not found. No password changed.');
  if (user.role !== 'customer') throw new Error('Target is not a customer. Refusing to change staff credentials.');
  const linked = db.prepare('SELECT id FROM accounts WHERE userId=?').get(user.id);
  if (!linked) throw new Error('Customer has no associated account. No password changed.');
  atomic(db, () => {
    db.prepare('UPDATE users SET passwordHash=? WHERE id=? AND role=?').run(passwordHash, user.id, 'customer');
    db.prepare('DELETE FROM sessions WHERE userId=?').run(user.id);
    audit(db, user.id, 'local-test-customer.password-reset', user.id, { localTestOnly: true });
  });
  console.log('Local test customer password reset for ' + expectedEmail + '. Role and ledger unchanged.');
} finally {
  db.close();
}
