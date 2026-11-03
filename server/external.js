import { atomic, audit } from './db.js';
import { digest, fail, accountData, text } from './services.js';
import { today } from './transfers.js';

// External (outbound) ACH transfer requests. A customer submits the destination bank
// details and the request is recorded as pending for staff review. Submitting a request
// does not post anything to the ledger and does not settle the transfer anywhere.
export const STATUS = { PENDING: 'pending', SETTLED: 'settled' };
export const DAILY_LIMIT = Number(process.env.EXTERNAL_DAILY_LIMIT || 50000_00);

// ABA routing checksum (weights 3,7,1 over the first 8 digits mod 10).
export function validRouting(value) {
  if (typeof value !== 'string' || !/^\d{9}$/.test(value)) return false;
  const d = [...value].map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

export function externalRequest(values) {
  const bankName = text(values.bankName, 'Bank name', 200);
  const { routingNumber, accountNumber, amount, requestId } = values;
  if (!validRouting(routingNumber) || routingNumber === '000000000') fail(400, 'Enter a valid 9-digit routing number.');
  if (typeof accountNumber !== 'string' || !/^\d{4,17}$/.test(accountNumber)) fail(400, 'Enter a valid bank account number (4-17 digits).');
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000000) fail(400, 'Transfer amount must be a positive whole number of cents.');
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) fail(400, 'Invalid transfer request ID.');
  const memo = values.memo ?? '';
  if (typeof memo !== 'string' || memo.length > 200 || /[\x00-\x1f\x7f]/.test(memo)) fail(400, 'Memo must be at most 200 characters without control characters.');
  return { bankName, routingNumber, accountNumber, amount, requestId, memo: memo.trim() };
}

export function migrate(db) {
  if (!Number.isSafeInteger(DAILY_LIMIT) || DAILY_LIMIT < 1) throw new Error('EXTERNAL_DAILY_LIMIT must be a positive whole number of cents.');
  db.exec(`
    CREATE TABLE IF NOT EXISTS external_transfers(
      id INTEGER PRIMARY KEY,
      fromAccountId INTEGER NOT NULL,
      userId INTEGER NOT NULL,
      bankName TEXT NOT NULL,
      routingNumber TEXT NOT NULL,
      accountNumber TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0 AND amount<=100000000000),
      memo TEXT,
      date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','settled')),
      debitId INTEGER,
      creditId INTEGER,
      requestId TEXT NOT NULL,
      requestHash TEXT NOT NULL,
      actorId INTEGER,
      settledAt TEXT,
      reason TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS external_transfers_requestId ON external_transfers(requestId);
    CREATE INDEX IF NOT EXISTS external_transfers_from_date ON external_transfers(fromAccountId, date);
  `);
}

// Customer-visible view: full destination details are safe to show (they are the client's
// own external account), but never expose internal ledger ids.
function view(row) {
  return {
    id: row.id,
    bankName: row.bankName,
    routingNumber: row.routingNumber,
    accountEnding: row.accountNumber.slice(-4),
    amount: row.amount,
    memo: row.memo,
    date: row.date,
    status: row.status,
    reason: row.reason,
    createdAt: row.createdAt
  };
}

export function sentSummary(db, accountId) {
  const date = today();
  const sentToday = db.prepare('SELECT COALESCE(SUM(amount),0) total FROM external_transfers WHERE fromAccountId=? AND date=?').get(accountId, date).total;
  const rows = db.prepare('SELECT * FROM external_transfers WHERE fromAccountId=? ORDER BY id DESC LIMIT 200').all(accountId);
  return { dailyLimit: DAILY_LIMIT, sentToday, remaining: Math.max(0, DAILY_LIMIT - sentToday), transfers: rows.map(view) };
}

export function queue(db) {
  const rows = db.prepare('SELECT * FROM external_transfers WHERE status=? ORDER BY id ASC LIMIT 500').all(STATUS.PENDING);
  const transfers = rows.map(row => {
    const owner = db.prepare('SELECT name, number FROM accounts WHERE id=?').get(row.fromAccountId);
    return { ...view(row), customer: owner.name, customerEnding: owner.number.slice(-4) };
  });
  return { transfers };
}

// Records the request for staff review. No ledger entries are posted and nothing is settled here.
export function initiate(db, userId, request) {
  const { bankName, routingNumber, accountNumber, amount, memo, requestId } = externalRequest(request);
  const requestHash = digest(JSON.stringify({ bankName, routingNumber, accountNumber, amount, memo }));
  return atomic(db, () => {
    const sender = db.prepare('SELECT * FROM accounts WHERE userId=?').get(userId);
    if (!sender) fail(404, 'No customer account is associated with this user.');
    const previous = db.prepare('SELECT * FROM external_transfers WHERE requestId=?').get(requestId);
    if (previous) {
      if (previous.userId !== userId || previous.requestHash !== requestHash) fail(409, 'This request ID was already used for a different external transfer.');
      return view(previous);
    }
    const { balance } = accountData(db, sender.id);
    if (balance < amount) fail(409, 'Insufficient available balance for this external transfer.');
    const date = today();
    const sentToday = db.prepare('SELECT COALESCE(SUM(amount),0) total FROM external_transfers WHERE fromAccountId=? AND date=?').get(sender.id, date).total;
    if (sentToday + amount > DAILY_LIMIT) fail(409, `This external transfer would exceed the daily limit of $${(DAILY_LIMIT / 100).toFixed(2)}.`);
    const id = Number(db.prepare('INSERT INTO external_transfers(fromAccountId,userId,bankName,routingNumber,accountNumber,amount,memo,date,status,requestId,requestHash,actorId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(sender.id, userId, bankName, routingNumber, accountNumber, amount, memo || null, date, STATUS.PENDING, requestId, requestHash, userId).lastInsertRowid);
    audit(db, userId, 'external.initiate', id, { fromAccountId: sender.id, amount, bankName, accountEnding: accountNumber.slice(-4) });
    return view(db.prepare('SELECT * FROM external_transfers WHERE id=?').get(id));
  });
}
