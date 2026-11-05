import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { openDatabase, newAccount } from '../server/db.js';
import { migrate } from '../server/migrations.js';
import { accountData, issueStatement } from '../server/services.js';
import { parseMoney, previewImport, postImport, setDemo } from '../server/imports.js';

// Same layout as an exported cash book: a first section with no year heading, then "Month YYYY"
// headings, repeated header rows, blank separators, Unicode minus signs and quoted amounts.
const sheet = `Date,Payee / payer,Description,Category,In / (out),Running cash
June 1,Example Investor,Initial capital,Capital,"$10,000.00","$10,000.00"
June 3,Example Landlord ,June rent,Rent,"−$2,500.00","$7,500.00"
June 9,Example Supplies,"Desks, chairs",Furniture,−$499.99,"$7,000.01"
,,,,,
July 2026,,,,,
,,,,,
Date,Payee / payer,Description,Category,In / (out),Running cash
July 1,Example Landlord,July rent,Rent,"−$2,500.00","$4,500.01"
July 10,Example Client,July subscription,Revenue,"$1,200.00","$5,700.01"
`;

function bank() {
  const dir = mkdtempSync(join(tmpdir(), 'svbt-import-'));
  const db = openDatabase(join(dir, 'bank.sqlite'));
  migrate(db);
  const user = (email, role) => Number(db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run(email, email, 'Address', role, 'x').lastInsertRowid);
  const owner = user('owner@example.com', 'moderator');
  const id = newAccount(db, user('demo@example.com', 'customer'), 'Example Demo Co', 'Address');
  return { dir, db, owner, id, close() { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('cash-book amounts parse to exact cents', () => {
  assert.equal(parseMoney('"$20,000.00"'.replaceAll('"', '')), 2000000);
  assert.equal(parseMoney('−$3,350.00'), -335000);
  assert.equal(parseMoney('-$0.05'), -5);
  assert.equal(parseMoney('($12.5)'), -1250);
  assert.equal(parseMoney('$1.234'), null);
  assert.equal(parseMoney('abc'), null);
});

test('preview reads every section, infers the year and reconciles to the running cash column', () => {
  const b = bank();
  try {
    const result = previewImport(b.db, b.id, { csv: sheet });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.rows.map(row => row.date), ['2026-06-01', '2026-06-03', '2026-06-09', '2026-07-01', '2026-07-10']);
    assert.equal(result.rows[1].description, 'Example Landlord — June rent');
    assert.equal(result.closing, 570001);
    assert.equal(result.deposits, 1120000);
    assert.equal(result.debits, 549999);
    const broken = previewImport(b.db, b.id, { csv: sheet.replace('"$4,500.01"', '"$4,500.00"') });
    assert.equal(broken.errors.length, 1, JSON.stringify(broken.errors));
    assert.match(broken.errors[0].error, /Running cash/);
  } finally { b.close(); }
});

test('imports post only into demo accounts, once, and the account stays a demo afterwards', () => {
  const b = bank();
  try {
    const { fileHash } = previewImport(b.db, b.id, { csv: sheet });
    assert.throws(() => postImport(b.db, b.id, { csv: sheet, fileHash }, b.owner), /only allowed into demo accounts/);
    setDemo(b.db, b.id, true, b.owner);
    assert.throws(() => postImport(b.db, b.id, { csv: sheet, fileHash: 'stale' }, b.owner), /changed since it was previewed/);
    const result = postImport(b.db, b.id, { csv: sheet, fileHash }, b.owner);
    assert.equal(result.rows, 5);
    assert.equal(accountData(b.db, b.id).balance, 570001);
    assert.throws(() => postImport(b.db, b.id, { csv: sheet, fileHash }, b.owner), /Running cash|already imported|problem/);
    assert.throws(() => setDemo(b.db, b.id, false, b.owner), /stays a demo account/);
    assert.throws(() => b.db.prepare('UPDATE accounts SET demo=0 WHERE id=?').run(b.id), /imported demonstration data/);
    assert.ok(b.db.prepare("SELECT id FROM audit WHERE action='import.post'").get());
  } finally { b.close(); }
});

test('a rejected import posts nothing', () => {
  const b = bank();
  try {
    setDemo(b.db, b.id, true, b.owner);
    const csv = sheet.replace('July 10,', 'July 32,');
    const preview = previewImport(b.db, b.id, { csv });
    assert.equal(preview.errors.length, 1);
    assert.throws(() => postImport(b.db, b.id, { csv, fileHash: preview.fileHash }, b.owner), /problem/);
    assert.equal(accountData(b.db, b.id).transactions.length, 0);
  } finally { b.close(); }
});

test('every page of a demo account statement says it is a sample, whatever the branding says', async () => {
  const b = bank();
  try {
    setDemo(b.db, b.id, true, b.owner);
    const { fileHash } = previewImport(b.db, b.id, { csv: sheet });
    postImport(b.db, b.id, { csv: sheet, fileHash }, b.owner);
    const issued = await issueStatement(b.db, b.id, '2026-06', b.owner, join(b.dir, 'statements'));
    const row = b.db.prepare('SELECT pdf FROM statements WHERE id=?').get(issued.id);
    const document = await getDocument({ data: new Uint8Array(row.pdf), useSystemFonts: true, isEvalSupported: false }).promise;
    for (let page = 1; page <= document.numPages; page++) {
      const text = (await (await document.getPage(page)).getTextContent()).items.map(item => item.str).join(' ');
      assert.ok(text.includes('SAMPLE · NOT A BANK STATEMENT'), text);
      assert.ok(text.includes('Not a bank statement and not a record of funds held'), text);
    }
    assert.match((await document.getMetadata()).info.Title, /^SAMPLE - /);
  } finally { b.close(); }
});
