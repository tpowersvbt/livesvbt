import { createApp } from './index.js';

if (process.env.NODE_ENV === 'production') throw new Error('Demo seeding is not allowed in production.');
const app = await createApp({ demoSeed: true, frontend: false });
try {
  const accountId = Number(app.locals.db.prepare("SELECT value FROM metadata WHERE key='demo-seeded'").get().value);
  const { accountData } = await import('./services.js');
  const data = accountData(app.locals.db, accountId);
  const expected = [423300, 1334900, 2234800, 3123000];
  const actual = data.monthly.filter(row => ['2026-06', '2026-07', '2026-08', '2026-09'].includes(row.month)).map(row => row.closing);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Seed ledger no longer matches the original four month balances. Existing corrections must not be silently overwritten.');
  console.log('Seed verified: June $4,233; July $13,349; August $22,348; September $31,230. Four issued statements are archived in monthly/statements.');
} finally { await app.locals.close(); }
