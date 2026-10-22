import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
const logo = fileURLToPath(new URL('../public/svbt-logo.jpg', import.meta.url));

export const demoNotice = 'SAMPLE: demonstration only. Not a bank statement and not a record of funds held.';
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100);
export function renderStatement(snapshot, { brandedCopy = false } = {}) {
  return new Promise((resolve, reject) => {
    const demo = Boolean(snapshot.account?.demo);
    const document = new PDFDocument({ size: 'LETTER', margin: 48, bufferPages: true, info: { Title: `${demo ? 'SAMPLE - ' : ''}Business checking ${snapshot.month} revision ${snapshot.revision}`, Author: 'Silicon Valley Bank and Trust', ...(demo ? { Subject: demoNotice } : {}) } });
    const brand = snapshot.statementBranding || {};
    const chunks = [];
    document.on('data', chunk => chunks.push(chunk));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.image(logo, 48, 18, { fit: [90, 90] });
    document.font('Helvetica-Bold');
    document.fillColor('#152a3b').fontSize(16).text(brand['statement.bankName'] || 'Silicon Valley Bank and Trust', 150, 45, {width:414,height:20,ellipsis:true});
    document.fontSize(10).text(demo ? demoNotice : brand['statement.notice'] ?? 'SAMPLE RECORD - No real funds', 150, 65, {width:414,height:28,ellipsis:true});
    document.font('Helvetica').fontSize(9).text(brand['statement.address'] || '3003 Tasman Drive, Santa Clara, CA',150,94,{width:414,height:12,ellipsis:true});
    document.fontSize(21).text(brand['statement.heading'] || 'BUSINESS CHECKING STATEMENT', 48, 105, {width:516,height:28,ellipsis:true});
    document.font('Helvetica').fontSize(10).text(`${snapshot.startDate} through ${snapshot.endDate} | USD | Revision ${snapshot.revision}`, 48, 137);
    document.text(`Issued ${snapshot.issuedAt}`);
    document.moveDown().font('Helvetica-Bold').text(snapshot.account.name);
    document.font('Helvetica').text(snapshot.account.address).text(`Account number: ${snapshot.account.number}`);
    document.moveDown().text(`Opening balance: ${money(snapshot.opening)}`).text(`Deposits: ${money(snapshot.deposits)}    Debits: ${money(snapshot.debits)}`).font('Helvetica-Bold').text(`Closing balance: ${money(snapshot.closing)}`).moveDown();
    const headerY = document.y;
    document.fontSize(9).text('DATE / ENTRY', 48, headerY, { width: 82 });
    document.text('DESCRIPTION', 136, headerY, { width: 235 });
    document.text('AMOUNT', 375, headerY, { width: 80, align: 'right' });
    document.text('RUNNING BALANCE', 465, headerY, { width: 99, align: 'right' });
    document.y = headerY + 20;
    for (const transaction of snapshot.transactions) {
      const description = [transaction.description + (transaction.reversalOf ? ` (reverses #${transaction.reversalOf})` : ''), transaction.referenceId && `Transaction ID: ${transaction.referenceId}`, transaction.occurredAt && `Transaction time (UTC): ${transaction.occurredAt}`, transaction.createdAt && `Recorded (UTC): ${transaction.createdAt}`, transaction.notes && `Notes: ${transaction.notes}`].filter(Boolean).join('\n');
      const height = Math.max(32, document.heightOfString(description, { width: 235 }) + 16);
      if (document.y + height > 710) { document.addPage(); document.font('Helvetica-Bold').fontSize(14).text('BUSINESS CHECKING · CONTINUED').font('Helvetica').fontSize(9).moveDown(); }
      const y = document.y;
      document.font('Helvetica').text(`${transaction.date}\n#${transaction.id}`, 48, y, { width: 82 });
      document.text(description, 136, y, { width: 235 });
      document.text(money(transaction.amount), 375, y, { width: 80, align: 'right' });
      document.text(money(transaction.runningBalance), 465, y, { width: 99, align: 'right' });
      document.y = y + height;
    }
    if (snapshot.statementNotes) {
      if (document.y > 650) document.addPage();
      document.moveDown().font('Helvetica-Bold').fontSize(11).text(brand['statement.notesHeading'] || 'STATEMENT NOTES');
      document.font('Helvetica').fontSize(10).text(snapshot.statementNotes, {width:516});
    }
    const pages = document.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      document.switchToPage(i);
      document.page.margins.bottom = 0;
      // Demo accounts hold demonstration figures. The stamp is not part of the editable branding, so
      // no wording change can produce an unmarked statement for a demo account.
      if (demo) {
        document.save().rotate(-35, { origin: [306, 396] }).font('Helvetica-Bold').fontSize(44).fillColor('#c0392b').fillOpacity(0.18)
          .text('SAMPLE · NOT A BANK STATEMENT', -60, 370, { width: 732, align: 'center', lineBreak: false }).restore();
        document.fillOpacity(1).font('Helvetica-Bold').fontSize(9).fillColor('#c0392b')
          .text(demoNotice, 48, 726, { width: 516, align: 'center', lineBreak: false });
      }
      document.font('Helvetica').fontSize(8).fillColor('#465466').text(`SVBT | ${brandedCopy ? 'Branded copy of issued snapshot' : 'Immutable issued snapshot'} | ${snapshot.month} | Revision ${snapshot.revision} | Page ${i + 1} of ${pages.count}`, 48, 741, { width: 516, align: 'center', lineBreak: false });
    }
    document.end();
  });
}
