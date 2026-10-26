import { randomBytes } from 'node:crypto';
import { atomic, audit, newAccount } from './db.js';
import { digest, fail, accountData, text } from './services.js';

// External (outbound) ACH transfers: SVBT -> the client's real Bank of America
// business account. We book the money out of the customer ledger instantly against an
// internal "settlement" book account that mirrors the SVBT account held at BofA, then a
// moderator releases the ACH at BofA and marks the item settled. A returned item
// auto-refunds the customer, so the ledger is always self-consistent.
//
export const ROUTING_ELECTRONIC = '121000358'; // BofA electronic (ACH) routing
export const ROUTING_PAPER = '121000358';      // BofA paper routing
export const SETTLEMENT_ACCOUNT = '325223276370';
export const SETTLEMENT_PARTNER = 'Bank of America, N.A.';
export const SETTLEMENT_NAME = 'SVBT External Settlement - Bank of America';
export const STATUS = { PENDING: 'pending', SETTLED: 'settled', RETURNED: 'returned' };
export const DAILY_LIMIT = Infinity;

export function today() { return new Date().toISOString().slice(0, 10); }

export function reference(id) { return `EXT${String(id).padStart(8, '0')}`; }

// ABA routing checksum (weights 3,7,1 over the first 8 digits mod 10).
export function validRouting(value) {
  if (typeof value !== 'string' || !/^\d{9}$/.test(value)) return false;
  const d = [...value].map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

// Called within initiate/refund's transaction. A dedicated, unguessable system
// identity satisfies the existing NOT NULL owner constraint without altering accounts.
export function settlementAccount(db) {
  const saved = db.prepare("SELECT value FROM metadata WHERE key='external-settlement-account'").get();
  if (saved) {
    const account = db.prepare('SELECT * FROM accounts WHERE id=?').get(Number(saved.value));
    if (!account) fail(500, 'Settlement account is missing.');
    return account;
  }
  const passwordHash = `${randomBytes(32).toString('hex')}:${randomBytes(64).toString('hex')}`;
  const userId = Number(db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run(
    `external-settlement-${randomBytes(16).toString('hex')}@internal.invalid`, SETTLEMENT_NAME,
    SETTLEMENT_PARTNER, 'customer', passwordHash
  ).lastInsertRowid);
  const id = newAccount(db, userId, SETTLEMENT_NAME, `${SETTLEMENT_PARTNER} - ${SETTLEMENT_ACCOUNT}`);
  db.prepare("INSERT INTO metadata(key,value) VALUES ('external-settlement-account',?)").run(String(id));
  return db.prepare('SELECT * FROM accounts WHERE id=?').get(id);
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
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','settled','returned')),
      debitId INTEGER,
      creditId INTEGER,
      returnId INTEGER,
      requestId TEXT NOT NULL,
      requestHash TEXT NOT NULL,
      actorId INTEGER,
      settledAt TEXT,
      returnedAt TEXT,
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
    reference: reference(row.id),
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
  const sentToday = db.prepare('SELECT COALESCE(SUM(amount),0) total FROM external_transfers WHERE fromAccountId=? AND date=? AND status<>?').get(accountId, date, STATUS.RETURNED).total;
  const rows = db.prepare('SELECT * FROM external_transfers WHERE fromAccountId=? ORDER BY id DESC LIMIT 200').all(accountId);
  return { rail: { partner: SETTLEMENT_PARTNER, routing: ROUTING_ELECTRONIC, account: SETTLEMENT_ACCOUNT }, dailyLimit: DAILY_LIMIT, sentToday, remaining: Math.max(0, DAILY_LIMIT - sentToday), transfers: rows.map(view) };
}

export function queue(db) {
  const rows = db.prepare('SELECT * FROM external_transfers WHERE status=? ORDER BY id ASC LIMIT 500').all(STATUS.PENDING);
  const transfers = rows.map(row => {
    const owner = db.prepare('SELECT name, number FROM accounts WHERE id=?').get(row.fromAccountId);
    return { ...view(row), customer: owner.name, customerEnding: owner.number.slice(-4) };
  });
  return { rail: { partner: SETTLEMENT_PARTNER, routing: ROUTING_ELECTRONIC, account: SETTLEMENT_ACCOUNT }, transfers };
}

// Both ledger entries and the request receipt commit in one transaction.
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
    if (!validRouting(routingNumber)) fail(400, 'The routing number failed the ABA checksum.');
    if (typeof accountNumber !== 'string' || !/^\d{4,17}$/.test(accountNumber)) fail(400, 'Enter a valid bank account number (4-17 digits).');
    const { balance } = accountData(db, sender.id);
    if (balance < amount) fail(409, 'Insufficient available balance for this external transfer.');
    const date = today();
    const sentToday = db.prepare('SELECT COALESCE(SUM(amount),0) total FROM external_transfers WHERE fromAccountId=? AND date=? AND status<>?').get(sender.id, date, STATUS.RETURNED).total;
    if (sentToday + amount > DAILY_LIMIT) fail(409, `This external transfer would exceed the daily limit of $${(DAILY_LIMIT / 100).toFixed(2)}.`);
    const settlement = settlementAccount(db);
    const ref = `External ACH to ${bankName} ...${accountNumber.slice(-4)}`;
    const insert = db.prepare('INSERT INTO transactions(accountId,date,description,amount,actorId) VALUES (?,?,?,?,?)');
    const debitId = Number(insert.run(sender.id, date, `${ref}`, -amount, userId).lastInsertRowid);
    const creditId = Number(insert.run(settlement.id, date, `${ref} (from ${sender.name} ...${sender.number.slice(-4)})`, amount, userId).lastInsertRowid);
    const id = Number(db.prepare('INSERT INTO external_transfers(fromAccountId,userId,bankName,routingNumber,accountNumber,amount,memo,date,status,debitId,creditId,requestId,requestHash,actorId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(sender.id, userId, bankName, routingNumber, accountNumber, amount, memo || null, date, STATUS.PENDING, debitId, creditId, requestId, requestHash, userId).lastInsertRowid);
    accountData(db, sender.id); accountData(db, settlement.id);
    audit(db, userId, 'external.initiate', id, { fromAccountId: sender.id, amount, bankName, accountEnding: accountNumber.slice(-4) });
    return view(db.prepare('SELECT * FROM external_transfers WHERE id=?').get(id));
  });
}

// Moderator release: the ACH actually left BofA. Nothing moves on the customer ledger; we
// only flip status and stamp the time. Reference number is stable for the operator.
export function settle(db, id, actorId) {
  return atomic(db, () => {
    const row = db.prepare('SELECT * FROM external_transfers WHERE id=?').get(id);
    if (!row) fail(404, 'External transfer not found.');
    if (row.status !== STATUS.PENDING) fail(409, `This transfer is already ${row.status}.`);
    db.prepare("UPDATE external_transfers SET status=?, settledAt=datetime('now') WHERE id=?").run(STATUS.SETTLED, id);
    audit(db, actorId, 'external.settle', id, { reference: reference(id) });
    return view(db.prepare('SELECT * FROM external_transfers WHERE id=?').get(id));
  });
}

// Return: BofA bounced it, so refund the customer by reversing the pair and crediting the
// sender back through a fresh opposite entry on their own account.
export function refund(db, id, actorId, reason) {
  reason = text(reason, 'Return reason', 250);
  return atomic(db, () => {
    const row = db.prepare('SELECT * FROM external_transfers WHERE id=?').get(id);
    if (!row) fail(404, 'External transfer not found.');
    if (row.status === STATUS.RETURNED) fail(409, 'This transfer was already returned.');
    const settlement = settlementAccount(db);
    const date = today();
    const ref = `External ACH return ${reference(id)}`;
    const insert = db.prepare('INSERT INTO transactions(accountId,date,description,amount,reversalOf,actorId) VALUES (?,?,?,?,?,?)');
    const returnId = Number(insert.run(row.fromAccountId, date, `${ref}${reason ? `: ${reason}` : ''}`, row.amount, row.debitId, actorId).lastInsertRowid);
    insert.run(settlement.id, date, `${ref} (settlement unwind)`, -row.amount, row.creditId, actorId);
    db.prepare("UPDATE external_transfers SET status=?, returnedAt=datetime('now'), reason=?, returnId=? WHERE id=?").run(STATUS.RETURNED, reason, returnId, id);
    accountData(db, row.fromAccountId); accountData(db, settlement.id);
    audit(db, actorId, 'external.return', id, { reference: reference(id), reason: reason || null, returnId });
    return view(db.prepare('SELECT * FROM external_transfers WHERE id=?').get(id));
  });
}

