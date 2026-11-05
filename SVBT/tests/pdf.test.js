import test from 'node:test';
import assert from 'node:assert/strict';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createApp } from '../server/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('issued PDF text contains exact balances, dates, account identity, revisions, running balances and every page number', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'svbt-pdf-'));
  const app = await createApp({ production: false, origin: 'http://localhost:3000', dbPath: join(directory, 'bank.sqlite'), statementDir: join(directory, 'statements'), demoSeed: true, frontend: false });
  try {
    const statements = app.locals.db.prepare('SELECT * FROM statements ORDER BY month').all();
    assert.equal(statements.length, 4);
    const ending = ['$4,233.00', '$13,349.00', '$22,348.00', '$31,230.00'];
    for (const [index, row] of statements.entries()) {
      const snapshot = JSON.parse(row.snapshot);
      const loading = getDocument({ data: new Uint8Array(row.pdf), useSystemFonts: true, isEvalSupported: false });
      const document = await loading.promise;
      const pages = [];
      for (let page = 1; page <= document.numPages; page++) {
        const content = await (await document.getPage(page)).getTextContent();
        const text = content.items.map(item => item.str).join(' ');
        assert.ok(text.includes(`Page ${page} of ${document.numPages}`), `Page ${page}/${document.numPages} text: ${text}`);
        pages.push(text);
      }
      const text = pages.join(' ');
      for (const expected of ['BUSINESS CHECKING STATEMENT', 'SVBT', 'Bakhtiari Auto Group, LLC', snapshot.account.number, snapshot.startDate, snapshot.endDate, 'Revision 1', ending[index], '3155 Stevens Creek', 'San Jose', '95117']) assert.ok(text.includes(expected), `PDF ${row.month} missing ${expected}`);
      for (const entry of snapshot.transactions) {
        assert.ok(text.includes(entry.date));
        assert.ok(text.includes(entry.description));
        const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(entry.runningBalance / 100);
        assert.ok(text.includes(money), `Missing running balance ${money}`);
      }
      await loading.destroy();
    }
  } finally { await app.locals.close(); rmSync(directory, { recursive: true, force: true }); }
});
