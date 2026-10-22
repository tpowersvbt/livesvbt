import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeApprovedDatabase, requirePersistentStorage } from '../server/initialize-installation.js';
import { createApp } from '../server/index.js';

test('new installation requires explicit approval and never replaces an existing database',()=>{
  const directory=mkdtempSync(join(tmpdir(),'svbt-install-')),file=join(directory,'bank.sqlite');
  assert.throws(()=>initializeApprovedDatabase(file),/explicitly enabled/);
  assert.equal(initializeApprovedDatabase(file,true),true);
  writeFileSync(file,'existing database must survive');
  assert.equal(initializeApprovedDatabase(file,true),false);
  assert.equal(readFileSync(file,'utf8'),'existing database must survive');
});

test('the real production base starts with no users, balances, statement records or demo seed marker',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'svbt-real-base-')),file=join(directory,'bank.sqlite');
  initializeApprovedDatabase(file,true);
  const app=await createApp({production:true,origin:'https://base.example.test',dbPath:file,statementDir:join(directory,'statements'),demoSeed:false,sampleData:false,frontend:false,sendMail:null});
  try{
    for(const table of ['users','accounts','transactions','statements'])assert.equal(app.locals.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
    assert.equal(app.locals.db.prepare("SELECT value FROM metadata WHERE key='demo-seeded'").get(),undefined);
    assert.throws(()=>requirePersistentStorage('',[file]),/mounted STORAGE_ROOT/);
  }finally{await app.locals.close();}
});
