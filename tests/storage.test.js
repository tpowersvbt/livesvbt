import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { databasePath, assertProductionStorage } from '../server/storage.js';
import { restoreDatabase } from '../server/restore-bootstrap.js';

test('production executable requires explicit absolute paths and an existing database',()=>{
  const original={...process.env}, dir=mkdtempSync(join(tmpdir(),'svbt-storage-'));
  try {
    process.env.NODE_ENV='production';delete process.env.DB_PATH;delete process.env.STATEMENT_DIR;
    assert.throws(assertProductionStorage,/DB_PATH/);
    process.env.DB_PATH='relative.sqlite';assert.throws(assertProductionStorage,/absolute/);
    process.env.DB_PATH=join(dir,'bank.sqlite');process.env.STATEMENT_DIR=join(dir,'statements');
    assert.throws(assertProductionStorage,/missing/);
    writeFileSync(process.env.DB_PATH,'test fixture');assert.doesNotThrow(assertProductionStorage);
    process.env.DB_PATH='./data/explicit.sqlite';assert.equal(databasePath(),resolve('./data/explicit.sqlite'));
  }finally{process.env=original;rmSync(dir,{recursive:true,force:true});}
});

test('restore rejects orphan sidecars and cleans failed validation staging files',()=>{
  const dir=mkdtempSync(join(tmpdir(),'svbt-safe-restore-')), target=join(dir,'bank.sqlite');
  const compressed=gzipSync(Buffer.from('not a database')), hash=createHash('sha256').update(compressed).digest('hex');
  try{
    writeFileSync(target+'-wal','preserve');assert.throws(()=>restoreDatabase(compressed,target,hash),/overwrite/);
    rmSync(target+'-wal');assert.throws(()=>restoreDatabase(compressed,target,hash));
    assert.deepEqual(readdirSync(dir),[]);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
