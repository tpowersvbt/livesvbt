// Bulk import of a cash-book CSV into a demo account. Imported figures are a demonstration, so
// they may only land in accounts flagged as demo, and every statement PDF for such an account is
// stamped as a sample (see pdf.js). An account that has received an import can never be unflagged.
import { atomic, audit } from './db.js';
import { account, accountData, digest, fail, date } from './services.js';

const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const maxBytes = 256 * 1024, maxRows = 2000;
const dollars = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100);

function parseLine(line) {
  const cells = []; let cell = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) { if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { cells.push(cell); cell = ''; }
    else cell += c;
  }
  if (quoted) return null;
  cells.push(cell);
  return cells.map(value => value.trim());
}

// "$1,234.56", "−$3,350.00" (Unicode minus), "-$5.00" or "($5.00)" to integer cents, without floating point.
export function parseMoney(value) {
  const normalized = String(value).replace(/−/g, '-').replace(/[$,\s]/g, '');
  const match = /^(\()?(-)?(\d+)(?:\.(\d{1,2}))?(\))?$/.exec(normalized);
  if (!match || Boolean(match[1]) !== Boolean(match[5])) return null;
  const amount = Number(match[3]) * 100 + Number((match[4] || '0').padEnd(2, '0'));
  if (!Number.isSafeInteger(amount)) return null;
  return match[1] || match[2] ? -amount : amount;
}

// Reads the sectioned cash-book layout: optional "Month YYYY" headings, repeated header rows,
// blank separator rows, and data rows of Date, Payee, Description, Category, In/(out), Running cash.
export function parseCashBook(csv, defaultYear) {
  if (typeof csv !== 'string' || !csv.trim()) fail(400, 'Paste or upload the CSV text.');
  if (Buffer.byteLength(csv) > maxBytes) fail(413, 'The CSV is larger than 256 KB.');
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/);
  const firstYear = lines.map(line => /^"?([A-Za-z]+) (\d{4})"?(,|$)/.exec(line.trim())).find(match => match && months.includes(match[1].toLowerCase()))?.[2];
  let year = defaultYear ?? (firstYear ? Number(firstYear) : undefined);
  const rows = [], errors = [];
  lines.forEach((line, index) => {
    const number = index + 1, cells = parseLine(line);
    if (!cells) { errors.push({ line: number, error: 'Unclosed quote.' }); return; }
    if (cells.every(cell => !cell)) return;
    if (cells[0].toLowerCase() === 'date') return;
    const heading = /^([A-Za-z]+) (\d{4})$/.exec(cells[0]);
    if (heading && months.includes(heading[1].toLowerCase()) && cells.slice(1).every(cell => !cell)) { year = Number(heading[2]); return; }
    const day = /^([A-Za-z]+) (\d{1,2})$/.exec(cells[0]);
    const month = day && months.indexOf(day[1].toLowerCase());
    if (!day || month < 0) { errors.push({ line: number, error: `Unrecognized date "${cells[0]}". Use a date like "June 1".` }); return; }
    if (!Number.isSafeInteger(year)) { errors.push({ line: number, error: 'No year found. Add a "Month YYYY" heading or choose a year.' }); return; }
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${day[2].padStart(2, '0')}`;
    try { date(iso); } catch { errors.push({ line: number, error: `"${cells[0]} ${year}" is not a real date.` }); return; }
    const amount = parseMoney(cells[4] ?? ''), running = parseMoney(cells[5] ?? '');
    if (amount === null || amount === 0) { errors.push({ line: number, error: `Amount "${cells[4] ?? ''}" is not a nonzero USD amount.` }); return; }
    if (running === null) { errors.push({ line: number, error: `Running cash "${cells[5] ?? ''}" is not a USD amount.` }); return; }
    const payee = (cells[1] || '').replace(/\s+/g, ' '), detail = (cells[2] || '').replace(/\s+/g, ' ');
    const description = [payee, detail].filter(Boolean).join(' — ');
    if (!description || description.length > 300 || /[\x00-\x1f\x7f]/.test(description)) { errors.push({ line: number, error: 'Payee and description are required, at most 300 characters together.' }); return; }
    rows.push({ line: number, date: iso, description, category: cells[3] || '', amount, running });
  });
  if (rows.length > maxRows) fail(413, `The CSV has more than ${maxRows} rows.`);
  return { rows, errors };
}

// Checks every row against the sheet's running cash column, starting from the account's balance.
export function previewImport(db, id, values) {
  const target = account(db, id);
  const yearValue = values.year === undefined || values.year === null || values.year === '' ? undefined : Number(values.year);
  if (yearValue !== undefined && (!Number.isSafeInteger(yearValue) || yearValue < 1900 || yearValue > 9999)) fail(400, 'Year must be a four-digit year.');
  const { rows, errors } = parseCashBook(values.csv, yearValue);
  const opening = accountData(db, id).balance;
  let balance = opening;
  for (const row of rows) {
    balance += row.amount;
    if (balance !== row.running) errors.push({ line: row.line, error: `Running cash in the sheet is ${dollars(row.running)}, but the ledger would be ${dollars(balance)}.` });
  }
  errors.sort((a, b) => a.line - b.line);
  const deposits = rows.filter(row => row.amount > 0).reduce((sum, row) => sum + row.amount, 0);
  const debits = rows.filter(row => row.amount < 0).reduce((sum, row) => sum - row.amount, 0);
  return { account: { id: target.id, name: target.name, number: target.number, demo: Boolean(target.demo) }, opening, deposits, debits, closing: balance, rows, errors, fileHash: digest(values.csv) };
}

export function postImport(db, id, values, actorId) {
  return atomic(db, () => {
    if (!account(db, id).demo) fail(409, 'Imports are only allowed into demo accounts. Mark the account as a demo first.');
    const result = previewImport(db, id, values);
    if (!result.rows.length) fail(400, 'The CSV has no transaction rows.');
    if (result.errors.length) fail(422, `The CSV has ${result.errors.length} problem(s). Preview it and fix them before importing.`);
    if (values.fileHash !== result.fileHash) fail(409, 'The CSV changed since it was previewed. Preview it again.');
    if (db.prepare('SELECT id FROM imports WHERE accountId=? AND fileHash=?').get(id, result.fileHash)) fail(409, 'This exact file was already imported into this account.');
    const insert = db.prepare('INSERT INTO transactions(accountId,date,description,amount,actorId) VALUES (?,?,?,?,?)');
    const ids = result.rows.map(row => Number(insert.run(id, row.date, row.description, row.amount, actorId).lastInsertRowid));
    const importId = Number(db.prepare('INSERT INTO imports(accountId,actorId,fileHash,rowCount,firstTransactionId,lastTransactionId,closing) VALUES (?,?,?,?,?,?,?)').run(id, actorId, result.fileHash, ids.length, ids[0], ids.at(-1), result.closing).lastInsertRowid);
    if (accountData(db, id).balance !== result.closing) fail(409, 'Imported balance did not match the sheet.');
    audit(db, actorId, 'import.post', importId, { accountId: id, rows: ids.length, deposits: result.deposits, debits: result.debits, closing: result.closing, fileHash: result.fileHash });
    return { importId, rows: ids.length, closing: result.closing };
  });
}

export function setDemo(db, id, demo, actorId) {
  if (typeof demo !== 'boolean') fail(400, 'demo must be true or false.');
  return atomic(db, () => {
    const target = account(db, id);
    if (!demo && db.prepare('SELECT id FROM imports WHERE accountId=?').get(id)) fail(409, 'This account holds imported demonstration data, so it stays a demo account.');
    if (Boolean(target.demo) !== demo) {
      db.prepare('UPDATE accounts SET demo=? WHERE id=?').run(demo ? 1 : 0, id);
      audit(db, actorId, demo ? 'account.demo.on' : 'account.demo.off', id);
    }
    return { ...account(db, id), demo };
  });
}
