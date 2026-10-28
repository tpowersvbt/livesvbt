import { atomic, audit } from './db.js';
import { digest, fail, accountData } from './services.js';

// Customer transfers between SVBT accounts. A transfer is a debit on the sender and a credit on
// the recipient, written in one transaction together with the transfers row that links them, so
// either both ledger entries exist or neither does.
export const pinFailureLimit = 5, pinLockMs = 30 * 60 * 1000;

export function pin(value) {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value)) fail(400, 'Transfer PIN must be exactly 6 digits.');
  return value;
}
export function trivialPin(value) {
  const digits = [...value].map(Number), steps = new Set(digits.slice(1).map((d, i) => (d - digits[i] + 10) % 10));
  return steps.size === 1 && [0, 1, 9].includes([...steps][0]);
}
export function today() { return new Date().toISOString().slice(0, 10); }
export function ownAccount(db, userId) {
  const row = db.prepare('SELECT * FROM accounts WHERE userId=?').get(userId);
  if (!row) fail(404, 'No customer account is associated with this user.');
  return row;
}
export function pinStatus(db, userId) {
  const row = db.prepare('SELECT lockedUntil FROM transfer_pins WHERE userId=?').get(userId);
  return { pinSet: Boolean(row), lockedUntil: row && row.lockedUntil > Date.now() ? new Date(row.lockedUntil).toISOString() : null };
}
export function savePin(db, userId, pinHash) {
  atomic(db, () => {
    const existed = db.prepare('SELECT 1 FROM transfer_pins WHERE userId=?').get(userId);
    // Changing the PIN clears the failure count, but an active lock still runs its full 30 minutes.
    db.prepare('INSERT INTO transfer_pins(userId,pinHash,failedCount,lockedUntil) VALUES (?,?,0,0) ON CONFLICT(userId) DO UPDATE SET pinHash=excluded.pinHash,failedCount=0').run(userId, pinHash);
    audit(db, userId, existed ? 'transfer-pin.change' : 'transfer-pin.set', userId);
  });
}
// Checks a PIN. The attempt is counted before the slow hash comparison runs, so concurrent
// guesses cannot all slip in under the limit; a correct PIN clears the count again.
export async function checkPin(db, userId, value, verify, res) {
  const now = Date.now();
  const row = atomic(db, () => {
    const current = db.prepare('SELECT * FROM transfer_pins WHERE userId=?').get(userId);
    if (!current) fail(409, 'Set a transfer PIN before sending a transfer.');
    if (current.lockedUntil > now) {
      res.set('Retry-After', String(Math.ceil((current.lockedUntil - now) / 1000)));
      fail(429, 'Transfers are locked after too many incorrect PINs. Try again later.');
    }
    db.prepare('UPDATE transfer_pins SET failedCount=failedCount+1 WHERE userId=?').run(userId);
    return current;
  });
  if (await verify(value, row.pinHash)) {
    db.prepare('UPDATE transfer_pins SET failedCount=0 WHERE userId=? AND pinHash=?').run(userId, row.pinHash);
    return;
  }
  atomic(db, () => {
    const current = db.prepare('SELECT failedCount FROM transfer_pins WHERE userId=?').get(userId);
    if (current && current.failedCount >= pinFailureLimit) {
      db.prepare('UPDATE transfer_pins SET failedCount=0,lockedUntil=? WHERE userId=?').run(Date.now() + pinLockMs, userId);
      audit(db, userId, 'transfer-pin.locked', userId, { failures: current.failedCount });
    }
  });
  fail(403, 'Transfer PIN is incorrect.');
}

// Cheap checks that run before the PIN is verified.
export function transferRequest(values) {
  const toAccountNumber = values.toAccountNumber;
  if (typeof toAccountNumber !== 'string' || !/^\d{12}$/.test(toAccountNumber)) fail(400, 'Recipient account number must be 12 digits.');
  const amount = values.amount;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000000) fail(400, 'Transfer amount must be a positive whole number of cents.');
  let description = values.description ?? '';
  if (typeof description !== 'string' || description.trim().length > 140 || /[\x00-\x1f\x7f]/.test(description)) fail(400, 'Memo must be at most 140 characters without control characters.');
  description = description.trim();
  const requestId = values.requestId;
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) fail(400, 'Request ID must be 16-100 letters, digits, hyphens or underscores.');
  return { toAccountNumber, amount, description, requestId };
}

const ending = number => `…${number.slice(-4)}`;

export function postTransfer(db, userId, request, dailyLimit) {
  return atomic(db, () => postTransferWithinTransaction(db, userId, request, dailyLimit));
}

function postTransferWithinTransaction(db, userId, request, dailyLimit) {
  const { toAccountNumber, amount, description, requestId } = request;
  const requestHash = digest(JSON.stringify({ toAccountNumber, amount, description }));
    const sender = ownAccount(db, userId);
    // A retried or double-submitted transfer returns the one it already made.
    const previous = db.prepare('SELECT * FROM transfers WHERE requestId=?').get(requestId);
    if (previous) {
      if (previous.actorId !== userId || previous.requestHash !== requestHash) fail(409, 'This request ID was already used for a different transfer.');
      return transferView(db, previous, sender.id);
    }
    const recipient = db.prepare('SELECT * FROM accounts WHERE number=?').get(toAccountNumber);
    if (!recipient) fail(404, 'Recipient account not found.');
    if (recipient.id === sender.id) fail(400, 'Choose an account other than your own.');
    const { balance } = accountData(db, sender.id);
    if (balance < amount) fail(409, 'Insufficient available balance for this transfer.');
    const date = today();
    const sentToday = db.prepare('SELECT COALESCE(SUM(amount),0) total FROM transfers WHERE fromAccountId=? AND date=?').get(sender.id, date).total;
    if (sentToday + amount > dailyLimit) fail(409, `This transfer would exceed the daily transfer limit of $${(dailyLimit / 100).toFixed(2)}.`);
    const memo = description ? `: ${description}` : '';
    const insert = db.prepare('INSERT INTO transactions(accountId,date,description,amount,actorId) VALUES (?,?,?,?,?)');
    const debitId = Number(insert.run(sender.id, date, `Transfer to ${recipient.name} ${ending(recipient.number)}${memo}`, -amount, userId).lastInsertRowid);
    const creditId = Number(insert.run(recipient.id, date, `Transfer from ${sender.name} ${ending(sender.number)}${memo}`, amount, userId).lastInsertRowid);
    const id = Number(db.prepare('INSERT INTO transfers(fromAccountId,toAccountId,amount,description,date,debitId,creditId,requestId,requestHash,actorId) VALUES (?,?,?,?,?,?,?,?,?,?)').run(sender.id, recipient.id, amount, description, date, debitId, creditId, requestId, requestHash, userId).lastInsertRowid);
    accountData(db, sender.id); accountData(db, recipient.id);
    audit(db, userId, 'transfer.post', id, { fromAccountId: sender.id, toAccountId: recipient.id, amount, debitId, creditId });
    return transferView(db, db.prepare('SELECT * FROM transfers WHERE id=?').get(id), sender.id);
}

export function batchRequest(values) {
  if (!Array.isArray(values?.transfers) || values.transfers.length < 1 || values.transfers.length > 100) fail(400, 'Provide 1–100 transfers.');
  const requestId = values.requestId;
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) fail(400, 'Invalid batch request ID.');
  return { requestId, transfers: values.transfers.map((row, i) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail(400, 'Invalid transfer row.');
    return transferRequest({ ...row, requestId: digest(`batch:${requestId}:${i}`) });
  }) };
}

export function postBatch(db, userId, request, dailyLimit) {
  const requestHash = digest(JSON.stringify(request.transfers));
  return atomic(db, () => {
    const sender = ownAccount(db, userId);
    const previous = db.prepare('SELECT * FROM transfer_batches WHERE requestId=?').get(request.requestId);
    if (previous) {
      if (previous.actorId !== userId || previous.requestHash !== requestHash) fail(409, 'Batch request ID was already used for a different request.');
      return { requestId: request.requestId, transfers: JSON.parse(previous.transferIds).map(id => transferView(db, db.prepare('SELECT * FROM transfers WHERE id=?').get(id), sender.id)) };
    }
    // One transaction covers every debit, credit, transfer, audit and the batch receipt.
    const transfers = request.transfers.map(row => postTransferWithinTransaction(db, userId, row, dailyLimit));
    db.prepare('INSERT INTO transfer_batches(requestId,actorId,requestHash,transferIds) VALUES (?,?,?,?)').run(request.requestId,userId,requestHash,JSON.stringify(transfers.map(t=>t.id)));
    audit(db,userId,'transfer.batch',request.requestId,{count:transfers.length,total:transfers.reduce((n,t)=>n+t.amount,0)});
    return { requestId: request.requestId, transfers };
  });
}

// What a customer may see about a transfer: the other side's name and the last four digits only.
function transferView(db, row, accountId) {
  const outgoing = row.fromAccountId === accountId;
  const other = db.prepare('SELECT name,number FROM accounts WHERE id=?').get(outgoing ? row.toAccountId : row.fromAccountId);
  return { id: row.id, direction: outgoing ? 'sent' : 'received', amount: row.amount, description: row.description, date: row.date, createdAt: row.createdAt, counterparty: other.name, counterpartyEnding: other.number.slice(-4) };
}
export function transferSummary(db, userId, dailyLimit) {
  const own = ownAccount(db, userId), date = today();
  const rows = db.prepare('SELECT * FROM transfers WHERE fromAccountId=? OR toAccountId=? ORDER BY id DESC LIMIT 200').all(own.id, own.id);
  const sentToday = db.prepare('SELECT COALESCE(SUM(amount),0) total FROM transfers WHERE fromAccountId=? AND date=?').get(own.id, date).total;
  return { ...pinStatus(db, userId), dailyLimit, sentToday, transfers: rows.map(row => transferView(db, row, own.id)) };
}
