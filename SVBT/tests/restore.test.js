import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { openDatabase } from '../server/db.js';
import { restoreDatabase } from '../server/restore-bootstrap.js';
test('restore verifies checksum and integrity and refuses existing databases',()=>{
 const dir=mkdtempSync(join(tmpdir(),'svbt-restore-'));
 try{const source=join(dir,'source.sqlite'), target=join(dir,'target.sqlite'); const db=openDatabase(source);db.close();const compressed=gzipSync(readFileSync(source)),hash=createHash('sha256').update(compressed).digest('hex');
 assert.throws(()=>restoreDatabase(compressed,target,'0'.repeat(64)),/checksum/);
 restoreDatabase(compressed,target,hash);assert.deepEqual(readFileSync(target),readFileSync(source));assert.throws(()=>restoreDatabase(compressed,target,hash),/overwrite/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
