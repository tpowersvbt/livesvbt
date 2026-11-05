import 'dotenv/config';
import { databasePath } from './storage.js';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

// Copying bank.sqlite by itself is not a backup: in WAL mode recent commits live in bank.sqlite-wal
// until a checkpoint. VACUUM INTO writes one consistent, self-contained copy while the site runs.
// The output is the gzip file and SHA-256 that restore-bootstrap.js accepts.
export function backupDatabase(source, directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const snapshot = join(directory, `bank-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=5000');
    db.prepare('VACUUM INTO ?').run(snapshot);
  } finally { db.close(); }
  try {
    const copy = new DatabaseSync(snapshot, { readOnly: true });
    try {
      if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup copy failed its integrity check.');
    } finally { copy.close(); }
    const compressed = gzipSync(readFileSync(snapshot), { level: 9 });
    const file = `${snapshot}.gz`;
    writeFileSync(file, compressed, { flag: 'wx', mode: 0o600 });
    return { file, sha256: createHash('sha256').update(compressed).digest('hex'), bytes: compressed.length };
  } finally { unlinkSync(snapshot); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const source = databasePath();
  const directory = resolve(process.argv[2] || process.env.BACKUP_DIR || join(dirname(source), 'backups'));
  const { file, sha256, bytes } = backupDatabase(source, directory);
  console.log(`Backup written: ${file}\nSHA-256 (use as SVBT_RESTORE_SHA256): ${sha256}\nCompressed size: ${bytes} bytes`);
  if (bytes > 20 * 1024 * 1024) console.warn('This backup is larger than the 20 MB the restore endpoint accepts.');
  console.log('Copy it off this server; a backup on the same disk does not survive losing that disk.');
}
