/* SVBT EXTERNAL TRANSFERS */

 * Sends funds from a customer's SVBT account OUT to an external bank account
 * (BofA business checking / any US bank) over the SVBT <-> Bank of America
 * settlement rail.
 *
 * Money flow, all written in ONE atomic DB transaction:
 *   customer account    = DEBIT  (funds leave SVBT)
 *   external settlement = CREDIT (held by SVBT at BofA, routing 026009593)
 *   external_transfers row links the two ledger entries + rail metadata.
 *
 * The settlement account is created automatically on first use and is not linked
 * to a customer user, so it never shows up as a customer's account.
 */
import { atomic, audit, newAccount, verifyPassword } from './db.js';
import { digest, fail, accountData } from './services.js';
import { today, ownAccount, checkPin } from './transfers.js';

// SVBT <-> BofA settlement rail (from the SVBT settlement footer).
export const SETTLEMENT = {
  partner: 'Bank of America, N.A.',
  routingElectronic: '026009593',
  routingPaper: '121000358',
  accountNumber: '325223276370',
};

// Default daily cap for external sends in cents ($50,000.00). Override with
// EXTERNAL_DAILY_LIMIT (dollars) in Render env vars if you want a different cap.
const DEFAULT_DAILY_LIMIT_CENTS = Number(process.env.EXTERNAL_DAILY_LIMIT || 50000) * 100;

// ACH routing validation. An ACH routing number must be 9 digits and pass the
// ABA weighted checksum, so a typo is caught before money moves.
export function routeNumber(value) {
  if (typeof value !== 'string' || !/^\d{9}$/.test(value)) fail(400, 'Routing number must be exactly 9 digits.');
  const d = [...value].map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  if (sum % 10 !== 0) fail(400, 'That routing number is not a valid US bank routing number.');
  return value;
}

export function externalBankInput(values) {
  const name = String(values.name ?? '').trim();
  if (name.length < 2 || name.length > 80) fail(400, 'Bank name must be 2-80 characters.');
  const accountNumber = String(values.accountNumber ?? '').trim();
  if (!/^\d{4,17}$/.test(accountNumber)) fail(400, 'External account number must be 4-17 digits.');
  const routingNumber = routeNumber(String(values.routingNumber ?? '').trim());
  const nickname = String(values.nickname ?? '').trim();
  if (nickname.length > 60) fail(400, 'Nickname must be at most 60 characters.');
  return { name, nickname: nickname || `${name} ....${accountNumber.slice(-4)}`, accountNumber, routingNumber };
}

export function externalRequest(values) {
  const amount = values.amount;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 50000000000) fail(400, 'Amount must be a positive whole number of cents.');
  const requestId = values.requestId;
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) fail(400, 'Request ID must be 16-100 letters, digits, hyphens or underscores.');
  const description = String(values.description ?? '').trim();
  if (description.length > 140) fail(400, 'Memo must be at most 140 characters.');
  return { amount, requestId, description };
}

// The internal holding account that represents SVBT's money-at-BofA.
// Created once, then reused. NOT linked to a customer user.
export function settlementAccount(db) {
  const existing = db.prepare("SELECT * FROM accounts WHERE name LIKE 'SVBT External Settlement%' LIMIT 1").get();
  if (existing) return existing;
  return atomic(db, () => {
    const again = db.prepare("SELECT * FROM accounts WHERE name LIKE 'SVBT External Settlement%' LIMIT 1").get();
    if (again) return again;
    const id = newAccount(db, null, 'SVBT External Settlement - Bank of America', '3003 Tasman Dr, Santa Clara, CA 95054');
    audit(db, null, 'external.settlement.created', id, { routing: SETTLEMENT.routingElectronic });
    return db.prepare('SELECT * FROM accounts WHERE id=?').get(id);
  });
}

export function externalSummary(db, userId) {
  ownAccount(db, userId); // 404 if the user has no SVBT account
  const rows = db.prepare('SELECT * FROM external_transfers WHERE actorId=? ORDER BY id DESC LIMIT 200').all(userId);
  const date = today();
  const sentToday = db.prepare("SELECT COALESCE(SUM(amount),0) total FROM external_transfers WHERE actorId=? AND date=? AND status<>'returned'").get(userId, date).total;
  return {
    rail: SETTLEMENT,
    dailyLimit: DEFAULT_DAILY_LIMIT_CENTS,
    sentToday,
    externalAccounts: rows.map(externalView),
  };
}

function externalView(row) {
  return {
    id: row.id,
    bankName: row.bankName,
    nickname: row.nickname,
    routingNumber: row.routingNumber,
    accountEnding: row.accountNumber.slice(-4),
    amount: row.amount,
    description: row.description,
    date: row.date,
    createdAt: row.createdAt,
    status: row.status,
    reference: row.reference,
  };
}

export async function postExternalTransfer(db, userId, values, res) {
  const request = externalRequest(values);
  const { amount, requestId, description } = request;

  // 1. Verify the 6-digit transfer PIN (shares lock/failure counting with internal).
  await checkPin(db, userId, values.pin, verifyPassword, res);

  const bank = externalBankInput(values);
  const requestHash = digest(JSON.stringify({ amount, requestId, description, routing: bank.routingNumber, account: bank.accountNumber }));

  // 2. Book the transfer atomically.
  return atomic(db, () => {
    const sender = ownAccount(db, userId);
    const previous = db.prepare('SELECT * FROM external_transfers WHERE requestId=?').get(requestId);
    if (previous) {
      if (previous.actorId !== userId || previous.requestHash !== requestHash) fail(409, 'This request ID was already used for a different external transfer.');
      return externalView(previous);
    }
    const { balance } = accountData(db, sender.id);
    if (balance < amount) fail(409, 'Insufficient available balance for this external transfer.');

    const date = today();
    const sentToday = db.prepare("SELECT COALESCE(SUM(amount),0) total FROM external_transfers WHERE actorId=? AND date=? AND status<>'returned'").get(userId, date).total;
    if (sentToday + amount > DEFAULT_DAILY_LIMIT_CENTS) {
      fail(409, `This transfer would exceed the external daily limit of $${(DEFAULT_DAILY_LIMIT_CENTS / 100).toFixed(2)}.`);
    }

    const settlement = settlementAccount(db);
    const reference = 'EXT' + digest(requestId).slice(0, 10).toUpperCase();
    const memo = description ? `: ${description}` : '';
    const insert = db.prepare('INSERT INTO transactions(accountId,date,description,amount,actorId) VALUES (?,?,?,?,?)');
    const debitId = Number(insert.run(
      sender.id, date,
      `External ACH to ${bank.name} ....${bank.accountNumber.slice(-4)} ref ${reference}${memo}`,
      -amount, userId).lastInsertRowid);
    const creditId = Number(insert.run(
      settlement.id, date,
      `ACH outbound ${sender.name} ....${sender.number.slice(-4)} ref ${reference}${memo}`,
      amount, userId).lastInsertRowid);

    const id = Number(db.prepare(`INSERT INTO external_transfers
      (actorId,fromAccountId,settlementAccountId,amount,description,date,debitId,creditId,
       requestId,requestHash,bankName,nickname,routingNumber,accountNumber,status,reference)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        userId, sender.id, settlement.id, amount, description, date, debitId, creditId,
        requestId, requestHash, bank.name, bank.nickname, bank.routingNumber, bank.accountNumber,
        'pending', reference).lastInsertRowid);

    accountData(db, sender.id);
    accountData(db, settlement.id);
    audit(db, userId, 'external-transfer.post', id, {
      fromAccountId: sender.id, settlementAccountId: settlement.id, amount, debitId, creditId,
      routingNumber: bank.routingNumber, reference,
    });

    return externalView(db.prepare('SELECT * FROM external_transfers WHERE id=?').get(id));
  });
}

// Moderator action: mark an outbound item as settled, returned (NSF etc.) or failed.
export function settleExternal(db, id, status) {
  if (!['pending', 'settled', 'returned', 'failed'].includes(status)) fail(400, 'Unknown settlement status.');
  return atomic(db, () => {
    const row = db.prepare('SELECT * FROM external_transfers WHERE id=?').get(id);
    if (!row) fail(404, 'External transfer not found.');
    if (row.status === status) return externalView(row);
    if (row.status !== 'pending') fail(409, `Cannot change a ${row.status} transfer.`);

    const settlement = db.prepare('SELECT * FROM accounts WHERE id=?').get(row.settlementAccountId);
    if (status === 'returned' || status === 'failed') {
      // Put the money back on the customer's account.
      const date = today();
      const memo = `External ACH return ref ${row.reference}`;
      const insert = db.prepare('INSERT INTO transactions(accountId,date,description,amount,actorId) VALUES (?,?,?,?,?)');
      insert.run(row.fromAccountId, date, memo, row.amount, row.actorId);
      insert.run(settlement.id, date, memo + ' (reversal)', -row.amount, row.actorId);
      accountData(db, row.fromAccountId);
      accountData(db, settlement.id);
    }
    db.prepare('UPDATE external_transfers SET status=? WHERE id=?').run(status, id);
    audit(db, row.actorId, 'external-transfer.settle', id, { status });
    return externalView(db.prepare('SELECT * FROM external_transfers WHERE id=?').get(id));
  });
}

export function externalQueue(db) {
  const rows = db.prepare("SELECT * FROM external_transfers WHERE status='pending' ORDER BY id DESC LIMIT 500").all();
  return { pending: rows.map(externalView), count: rows.length };
}
