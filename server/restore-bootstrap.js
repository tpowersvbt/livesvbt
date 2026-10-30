import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import 'dotenv/config';
import { existsSync, mkdirSync, writeFileSync, linkSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { databasePath, assertProductionPaths, assertProductionStorage } from './storage.js';
import { dirname, resolve, basename, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

export function restoreDatabase(compressed, target, expectedHash) {
  if ([target, target+'-wal', target+'-shm'].some(existsSync)) throw new Error('Database or sidecar already exists; refusing overwrite.');
  if (createHash('sha256').update(compressed).digest('hex') !== expectedHash) throw new Error('Backup checksum mismatch.');
  const bytes = gunzipSync(compressed, { maxOutputLength: 100 * 1024 * 1024 });
  mkdirSync(dirname(target), { recursive: true });
  const staging = target + '.restore-' + randomUUID();
  writeFileSync(staging, bytes, { mode: 0o600, flag: 'wx' });
  try {
    const db = new DatabaseSync(staging, { readOnly: true });
    try {
      if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Database integrity failed.');
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database foreign keys failed.');
      for (const table of ['users','accounts','transactions','statements']) db.prepare(`SELECT count(*) FROM ${table}`).get();
    } finally { db.close(); }
    // Atomic no-clobber publication: unlike rename, link fails if target appeared meanwhile.
    if ([target+'-wal',target+'-shm'].some(existsSync)) throw new Error('Database sidecar already exists; refusing overwrite.');
    linkSync(staging, target);
  } finally { unlinkSync(staging); }
}
async function start() {
  assertProductionPaths();
  const target = databasePath();
  const port = Number(process.env.PORT || 3000), host = process.env.HOST || '0.0.0.0';
  async function runApp() {
    assertProductionStorage();
    if (process.env.STATEMENT_DIR) {
      const directory=resolve(process.env.STATEMENT_DIR);
      mkdirSync(directory,{recursive:true});
      const db=new DatabaseSync(target,{readOnly:true});
      try { for(const row of db.prepare('SELECT archivePath,pdf,pdfHash FROM statements').all()) {
        const file=join(directory,basename(row.archivePath));
        if(createHash('sha256').update(row.pdf).digest('hex')!==row.pdfHash)throw new Error('Stored statement checksum mismatch.');
        if(!existsSync(file))writeFileSync(file,Buffer.from(row.pdf),{mode:0o600});
      } } finally {db.close();}
    }
    const { createApp } = await import('./index.js');
    const app = await createApp();
    const server = app.listen(port, host, () => console.log('SVBT restored and running'));
    for (const signal of ['SIGTERM','SIGINT']) process.once(signal, () => server.close(async () => { await app.locals.close(); process.exit(0); }));
  }
  if (existsSync(target)) return runApp();
  const token = process.env.SVBT_RESTORE_TOKEN, hash = process.env.SVBT_RESTORE_SHA256;
  if (!token || token.length < 40 || !/^[a-f0-9]{64}$/.test(hash || '')) throw new Error('Existing database or authorized restore configuration is required.');
  let busy = false;
  const server = createServer(async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    if (req.method === 'GET' && req.url === '/api/health') { res.writeHead(503); res.end('{"status":"restore_pending"}'); return; }
    const provided = req.headers.authorization || '', expected = `Bearer ${token}`;
    if (req.method !== 'POST' || req.url !== '/restore' || Buffer.byteLength(provided) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(provided),Buffer.from(expected))) { res.writeHead(503); res.end('Maintenance in progress.'); return; }
    if (busy) { res.writeHead(409); res.end('Restore in progress.'); return; }
    busy = true;
    try {
      const chunks=[]; let size=0;
      for await(const chunk of req) { size+=chunk.length; if(size>20*1024*1024)throw new Error('Backup too large.'); chunks.push(chunk); }
      restoreDatabase(Buffer.concat(chunks),target,hash);
      res.end('{"restored":true}');
      server.close(() => runApp().catch(error=>{console.error(error);process.exit(1);}));
      server.closeIdleConnections();
    } catch(error) { busy=false; res.writeHead(400);res.end('Restore failed validation.');console.error(error.message); }
  });
  server.requestTimeout=120000;
  server.listen(port,host,()=>console.log('Waiting for authenticated database restoration'));
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) await start();
