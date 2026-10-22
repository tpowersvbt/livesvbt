import { parseFundsRows } from './funds-parse.js';
import { statementDefaults } from '../src/site-copy.js';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, linkSync, unlinkSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { atomic, audit } from './db.js';
import { renderStatement } from './pdf.js';

export const digest = value => createHash('sha256').update(value).digest('hex');
export function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
export function text(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) fail(400, `${name} is required and must be at most ${max} characters without control characters.`);
  return value.trim();
}
export function cents(value, allowZero = false) {
  if (!Number.isSafeInteger(value) || Math.abs(value) > 100000000000 || (!allowZero && value === 0)) fail(400, 'Amount must be integer USD cents within the supported range, and nonzero for ledger entries.');
  return value;
}
export function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(400, 'A valid ledger date (YYYY-MM-DD) is required.');
  return value;
}
export function account(db, id) {
  const result = db.prepare('SELECT * FROM accounts WHERE id=?').get(id);
  if (!result) fail(404, 'Account not found.');
  return result;
}
export function transactions(db, id) { return db.prepare('SELECT t.*,COALESCE(d.referenceId,\'\') referenceId,COALESCE(d.occurredAt,\'\') occurredAt,COALESCE(d.notes,\'\') notes,COALESCE(d.version,0) detailsVersion FROM transactions t LEFT JOIN transaction_details d ON d.transactionId=t.id WHERE t.accountId=? ORDER BY t.date,t.id').all(id); }
export function preview(db, id, month) {
  if (typeof month !== 'string' || !/^(19|[2-9]\d)\d{2}-(0[1-9]|1[0-2])$/.test(month)) fail(400, 'A valid statement month (YYYY-MM) is required.');
  const owner = account(db, id);
  const rows = transactions(db, id);
  let opening = 0, deposits = 0, debits = 0;
  for (const row of rows) if (row.date.slice(0, 7) < month) opening += row.amount;
  let runningBalance = opening;
  const entries = rows.filter(row => row.date.startsWith(month)).map(row => {
    if (row.amount > 0) deposits += row.amount; else debits -= row.amount;
    runningBalance += row.amount;
    return { ...row, runningBalance };
  });
  for (const value of [opening, deposits, debits, runningBalance]) if (!Number.isSafeInteger(value)) fail(409, 'Ledger total exceeds safe integer precision.');
  const [year, m] = month.split('-').map(Number);
  return { account: owner, month, startDate: `${month}-01`, endDate: `${month}-${new Date(Date.UTC(year, m, 0)).getUTCDate()}`, opening, deposits, debits, closing: runningBalance, statementBranding: statementBranding(db), statementNotes: statementNotes(db, id, month).notes, transactions: entries };
}
export function accountData(db, id) {
  const owner = account(db, id), rows = transactions(db, id);
  const monthly = [...new Set(rows.map(row => row.date.slice(0, 7)))].map(month => {
    const { opening, deposits, debits, closing } = preview(db, id, month);
    return { month, opening, deposits, debits, closing };
  });
  const balance = rows.reduce((sum, row) => sum + row.amount, 0);
  if (!Number.isSafeInteger(balance)) fail(409, 'Ledger balance exceeds safe integer precision.');
  return { account: owner, transactions: rows, monthly, balance };
}
export function postTransaction(db, id, values, actorId) {
  account(db, id);
  const entry = { date: date(values.date), description: text(values.description, 'Description', 300), amount: cents(values.amount) };
  const requestId = values.requestId;
  if (requestId !== undefined && (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(requestId))) fail(400, 'Request ID must be 16-100 letters, digits, hyphens or underscores.');
  const requestHash = digest(JSON.stringify(entry));
  return atomic(db, () => {
    // A retried or double-submitted post returns the entry it already created instead of posting twice.
    const previous = requestId && db.prepare('SELECT * FROM ledger_requests WHERE requestId=?').get(requestId);
    if (previous) {
      if (previous.actorId !== actorId || previous.accountId !== id || previous.requestHash !== requestHash) fail(409, 'This request ID was already used for a different ledger entry.');
      return db.prepare('SELECT * FROM transactions WHERE id=?').get(previous.transactionId);
    }
    const transactionId = Number(db.prepare('INSERT INTO transactions(accountId,date,description,amount,actorId) VALUES (?,?,?,?,?)').run(id, entry.date, entry.description, entry.amount, actorId).lastInsertRowid);
    if (requestId) db.prepare('INSERT INTO ledger_requests(requestId,actorId,accountId,requestHash,transactionId) VALUES (?,?,?,?,?)').run(requestId, actorId, id, requestHash, transactionId);
    accountData(db, id);
    audit(db, actorId, 'transaction.post', transactionId, { accountId: id, ...entry });
    return db.prepare('SELECT * FROM transactions WHERE id=?').get(transactionId);
  });
}
export function reverseTransaction(db, id, values, actorId) {
  const ledgerDate = date(values.date), reason = text(values.reason, 'Reversal reason', 250);
  return atomic(db, () => {
    const original = db.prepare('SELECT * FROM transactions WHERE id=?').get(id);
    if (!original) fail(404, 'Transaction not found.');
    if (original.reversalOf || db.prepare('SELECT id FROM transactions WHERE reversalOf=?').get(id)) fail(409, 'This entry cannot be reversed again.');
    if (ledgerDate < original.date) fail(400, 'Reversal date cannot precede the original entry.');
    const transactionId = Number(db.prepare('INSERT INTO transactions(accountId,date,description,amount,reversalOf,actorId) VALUES (?,?,?,?,?,?)').run(original.accountId, ledgerDate, `Reversal #${id}: ${reason}`, -original.amount, id, actorId).lastInsertRowid);
    accountData(db, original.accountId);
    audit(db, actorId, 'transaction.reverse', transactionId, { reversalOf: id, reason });
    return db.prepare('SELECT * FROM transactions WHERE id=?').get(transactionId);
  });
}
export function archive(db, id) {
  account(db, id);
  return db.prepare('SELECT id,accountId,month,revision,issuedAt,closing,hash FROM statements WHERE accountId=? ORDER BY month DESC,revision DESC').all(id);
}
export function statement(db, id) {
  const result = db.prepare('SELECT * FROM statements WHERE id=?').get(id);
  if (!result) fail(404, 'Issued statement not found.');
  return result;
}
export function integrity(db, id, directory) {
  const row = statement(db, id);
  let archiveValid = false;
  try { archiveValid = digest(readFileSync(directory ? join(directory,basename(row.archivePath)) : row.archivePath)) === row.pdfHash; } catch {
    if (process.env.STATEMENT_DIR) { try { archiveValid = digest(readFileSync(join(process.env.STATEMENT_DIR, basename(row.archivePath)))) === row.pdfHash; } catch {} }
  }
  const snapshotValid = digest(row.snapshot) === row.hash, pdfValid = digest(row.pdf) === row.pdfHash;
  return { valid: snapshotValid && pdfValid && archiveValid, snapshotValid, pdfValid, archiveValid };
}
export async function issueStatement(db, id, month, actorId, directory) {
  const live = preview(db, id, month);
  const revision = db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS revision FROM statements WHERE accountId=? AND month=?').get(id, month).revision;
  const snapshot = { ...live, revision, issuedAt: new Date().toISOString() };
  const serialized = JSON.stringify(snapshot), pdf = await renderStatement(snapshot);
  mkdirSync(directory, { recursive: true });
  // Account numbers can be reassigned, so the account id keeps archive names unique.
  const archivePath = join(directory, `${id}-${live.account.number}-${month}-r${revision}.pdf`);
  const temporary = `${archivePath}.${randomBytes(12).toString('hex')}.tmp`;
  writeFileSync(temporary, pdf, { flag: 'wx', mode: 0o600 });
  let moved = false;
  try {
    return atomic(db, () => {
      if (JSON.stringify(preview(db, id, month)) !== JSON.stringify(live) || db.prepare('SELECT id FROM statements WHERE accountId=? AND month=? AND revision=?').get(id, month, revision)) fail(409, 'Ledger or revision changed during PDF generation. Recalculate and try again.');
      const result = db.prepare('INSERT INTO statements(accountId,month,revision,issuedAt,closing,snapshot,hash,pdf,pdfHash,archivePath) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, month, revision, snapshot.issuedAt, snapshot.closing, serialized, digest(serialized), pdf, digest(pdf), archivePath);
      const statementId = Number(result.lastInsertRowid);
      audit(db, actorId, 'statement.issue', statementId, { accountId: id, month, revision });
      // Never replace an existing archive file: it may belong to another issued statement.
      if (existsSync(archivePath)) fail(409, 'A statement archive file with this name already exists.');
      linkSync(temporary, archivePath); moved = true;
      unlinkSync(temporary);
      return archive(db, id).find(row => row.id === statementId);
    });
  } catch (error) {
    for (const file of moved ? [archivePath, temporary] : [temporary]) { try { unlinkSync(file); } catch {} }
    throw error;
  }
}
export function saveInvestment(db, id, values, actorId) {
  const data = [text(values.sector, 'Sector', 100), text(values.status, 'Status', 100), cents(values.targetCapital, true), text(values.risk, 'Risk', 200), text(values.strategy, 'Strategy', 2000)];
  if (data[2] < 0) fail(400, 'Target capital cannot be negative.');
  return atomic(db, () => {
    if (id) {
      if (!db.prepare('UPDATE investments SET sector=?,status=?,targetCapital=?,risk=?,strategy=? WHERE id=?').run(...data, id).changes) fail(404, 'Investment not found.');
    } else id = Number(db.prepare('INSERT INTO investments(sector,status,targetCapital,risk,strategy) VALUES (?,?,?,?,?)').run(...data).lastInsertRowid);
    const result = db.prepare('SELECT * FROM investments WHERE id=?').get(id);
    audit(db, actorId, 'investment.save', id, result);
    return result;
  });
}


function optionalText(value, name, max) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail(400, `${name} must be at most ${max} characters.`);
  return value.trim();
}
function validMonth(month) {
  if (typeof month !== 'string' || !/^(19|[2-9]\d)\d{2}-(0[1-9]|1[0-2])$/.test(month)) fail(400,'A valid statement month is required.');
}
export function statementNotes(db, id, month) {
  account(db,id); validMonth(month);
  return db.prepare('SELECT notes,version FROM statement_notes WHERE accountId=? AND month=?').get(id,month) || {notes:'',version:0};
}
export function saveStatementNotes(db,id,values,actorId) {
  const notes=optionalText(values.notes,'Statement notes',6000);
  return atomic(db,()=>{
    const current=statementNotes(db,id,values.month);
    if(current.version!==values.version) fail(409,'Statement notes changed. Reload before saving.');
    db.prepare('INSERT INTO statement_notes(accountId,month,notes,version) VALUES (?,?,?,1) ON CONFLICT(accountId,month) DO UPDATE SET notes=excluded.notes,version=statement_notes.version+1').run(id,values.month,notes);
    audit(db,actorId,'statement.notes',id,{month:values.month,version:current.version+1});
    return statementNotes(db,id,values.month);
  });
}
export function updateTransactionDetails(db,id,values,actorId) {
  if(!Number.isSafeInteger(id))fail(400,'Invalid transaction ID.');
  const referenceId=optionalText(values.referenceId,'Transaction reference ID',120),notes=optionalText(values.notes,'Transaction notes',2000);
  let occurredAt=optionalText(values.occurredAt,'Transaction date/time',40);
  if(occurredAt) {
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(occurredAt)||!Number.isFinite(Date.parse(occurredAt)))fail(400,'A valid transaction timestamp in UTC is required.');
    const normalized=new Date(occurredAt).toISOString();
    if(normalized!==occurredAt && normalized.replace('.000Z','Z')!==occurredAt)fail(400,'Invalid transaction date/time.');
    occurredAt=normalized;
  }
  return atomic(db,()=>{
    const row=db.prepare('SELECT * FROM transactions WHERE id=?').get(id);if(!row)fail(404,'Transaction not found.');
    const current=db.prepare('SELECT * FROM transaction_details WHERE transactionId=?').get(id);
    if((current?.version||0)!==values.version)fail(409,'Transaction details changed. Reload before saving.');
    db.prepare('INSERT INTO transaction_details(transactionId,referenceId,occurredAt,notes,version) VALUES (?,?,?,?,1) ON CONFLICT(transactionId) DO UPDATE SET referenceId=excluded.referenceId,occurredAt=excluded.occurredAt,notes=excluded.notes,version=transaction_details.version+1').run(id,referenceId,occurredAt,notes);
    audit(db,actorId,'transaction.details',id,{referenceId,occurredAt,version:(current?.version||0)+1});
    return transactions(db,row.accountId).find(t=>t.id===id);
  });
}

function statementBranding(db) {
  const table=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='site_content'").get();
  const overrides=table?JSON.parse(db.prepare('SELECT overrides FROM site_content WHERE id=1').get()?.overrides||'{}'):{};
  return Object.fromEntries(Object.entries(statementDefaults).map(([key,value])=>[key,overrides[key]??value]));
}

export function postTransactionsBulk(db, id, values, actorId) {
  account(db, id);
  if (!values || typeof values !== 'object' || Array.isArray(values)) fail(400, 'Provide an entries array or CSV rows.');
  let entries;
  if (Array.isArray(values.entries) && values.rows === undefined) entries = values.entries;
  else if (typeof values.rows === 'string' && values.entries === undefined) {
    try { entries = parseFundsRows(values.rows); } catch (error) { fail(400, error.message); }
  } else fail(400, 'Provide either an entries array or CSV rows.');
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 2000) fail(400, 'Provide 1-2000 transaction rows.');
  const rows = entries.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(400, 'Each transaction row must be an object.');
    return { date: date(entry.date), description: text(entry.description, 'Description', 300), amount: cents(entry.amount) };
  });
  return atomic(db, () => {
    const ids = [];
    const insert = db.prepare('INSERT INTO transactions(accountId,date,description,amount,actorId) VALUES (?,?,?,?,?)');
    for (const row of rows) ids.push(Number(insert.run(id, row.date, row.description, row.amount, actorId).lastInsertRowid));
    accountData(db, id);
    audit(db, actorId, 'transaction.bulkPost', ids[0], { accountId: id, count: ids.length, total: rows.reduce((sum, row) => sum + row.amount, 0) });
    return ids.map(transactionId => db.prepare('SELECT * FROM transactions WHERE id=?').get(transactionId));
  });
}
