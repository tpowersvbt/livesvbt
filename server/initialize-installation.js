import 'dotenv/config';
import { existsSync, mkdirSync, openSync, closeSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertProductionPaths, assertProductionStorage, databasePath } from './storage.js';

export function initializeApprovedDatabase(file, approved = false) {
  if (existsSync(file)) return false;
  if (!approved) throw new Error('A new empty installation must be explicitly enabled.');
  mkdirSync(dirname(file), {recursive:true});
  // Exclusive creation prevents replacing any database that appears concurrently.
  const handle=openSync(file,'wx',0o600);closeSync(handle);
  return true;
}

export function requirePersistentStorage(root, paths) {
  if(!root || !isAbsolute(root) || !existsSync(root)) throw new Error('An explicit mounted STORAGE_ROOT is required.');
  const canonical=realpathSync(root);
  if(process.platform==='linux' && statSync(canonical).dev===statSync('/').dev) throw new Error('STORAGE_ROOT must be on a persistent mounted volume.');
  for(const file of paths){
    const child=relative(canonical,resolve(file));
    if(child==='..'||child.startsWith('../')||child.startsWith('..\\')||isAbsolute(child))throw new Error('All durable paths must remain inside STORAGE_ROOT.');
    if(existsSync(file)){
      const actualFile=relative(canonical,realpathSync(file));
      if(actualFile==='..'||actualFile.startsWith('../')||actualFile.startsWith('..\\')||isAbsolute(actualFile))throw new Error('Durable paths cannot follow symlinks outside STORAGE_ROOT.');
    }
    let parent=dirname(file);
    while(!existsSync(parent))parent=dirname(parent);
    const actual=relative(canonical,realpathSync(parent));
    if(actual==='..'||actual.startsWith('../')||actual.startsWith('..\\')||isAbsolute(actual))throw new Error('Durable paths cannot follow symlinks outside STORAGE_ROOT.');
  }
}

async function start(){
  if(process.env.NODE_ENV!=='production')throw new Error('Installation entry point requires NODE_ENV=production.');
  if(process.env.DEMO_SEED!=='false'||process.env.SAMPLE_DATA!=='false')throw new Error('Real installations require DEMO_SEED=false and SAMPLE_DATA=false.');
  assertProductionPaths();
  requirePersistentStorage(process.env.STORAGE_ROOT,[databasePath(),process.env.STATEMENT_DIR]);
  const created=initializeApprovedDatabase(databasePath(),process.env.SVBT_INITIALIZE_EMPTY==='true');
  assertProductionStorage();
  const {createApp}=await import('./index.js');
  const app=await createApp();
  if(created)console.log('New empty SVBT installation initialized; no sample accounts or transactions were created.');
  const server=app.listen(Number(process.env.PORT||3000),process.env.HOST||'0.0.0.0',()=>console.log('SVBT application is listening.'));
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(async()=>{await app.locals.close();process.exit(0);}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await start();
