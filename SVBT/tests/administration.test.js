import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/index.js';
const origin='http://localhost:3000';
async function fixture(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'svbt-test-'));
  const app = await createApp({ production: false, origin, frontend: false, dbPath: join(directory, 'bank.sqlite'), statementDir: join(directory, 'statements'), demoSeed: true, ...options });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  function client() {
    let cookie = '';
    let csrf = '';
    return {
      get cookie() { return cookie; },
      get csrf() { return csrf; },
      async request(path, method = 'GET', body, headers = {}) {
        const response = await fetch(`${url}/api${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { Origin: origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
        if (data.csrfToken) csrf = data.csrfToken;
        return { status: response.status, data, headers: response.headers };
      },
      async login(email, password) {
        await this.request('/session');
        const result = await this.request('/login', 'POST', { email, password });
        assert.equal(result.status, 200);
        return result;
      }
    };
  }
  return { app, db: app.locals.db, directory, client, url, async close() { await new Promise(resolve => server.close(resolve)); await app.locals.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('owner handover protects customer access and supports staff, content and accounts', async()=>{
 const f=await fixture({ownerEmail:'tpower@siliconvalleybankandtrust.com'});
 try {
  const owner=f.client(),customer=f.client(),anon=f.client();
  const logged=await owner.login('tpower@siliconvalleybankandtrust.com','ModeratorGod!2026');
  assert.equal(logged.data.user.role,'owner');
  await customer.login('sales@bakhtiariautogroup.com','FounderClient!2026');
  for(const path of ['/admin/users','/admin/site-content']){
   assert.equal((await anon.request(path)).status,401);
   assert.equal((await customer.request(path)).status,403);
  }
  const users=(await owner.request('/admin/users')).data;
  assert.ok(users.every(u=>!('passwordHash' in u)));
  assert.equal((await owner.request(`/admin/users/${logged.data.user.id}`,'PATCH',{role:'customer'})).status,409);
  const created=await owner.request('/admin/users','POST',{name:'Editor',email:'editor@example.com',address:'Office',role:'admin',password:'UniqueEditor!2026'});
  assert.equal(created.status,201);
  const editor=f.client(); await editor.login('editor@example.com','UniqueEditor!2026');
  assert.equal((await editor.request('/admin/users')).status,403);
  const content=(await editor.request('/admin/site-content')).data;
  assert.equal((await customer.request('/admin/site-content','PUT',{overrides:{heroTitle:'Forbidden'},version:content.version})).status,403);
  assert.equal((await editor.request('/admin/site-content','PUT',{overrides:{heroTitle:'Owner approved title',disclosures:'Updated disclosure'},version:content.version})).status,200);
  assert.equal((await anon.request('/site-content')).data.overrides.heroTitle,'Owner approved title');
  assert.equal((await editor.request('/admin/site-content','PUT',{overrides:{},version:content.version})).status,409);
  const account=(await owner.request('/admin/accounts')).data[0];
  assert.equal((await owner.request(`/admin/accounts/${account.id}`,'PATCH',{name:'Updated customer',address:'New address',number:account.number})).status,200);
  assert.equal((await owner.request(`/admin/accounts/${account.id}`)).data.account.name,'Updated customer');
  assert.equal((await owner.request(`/admin/users/${created.data.id}`,'PATCH',{role:'customer'})).status,200);
  assert.equal((await editor.request('/admin/site-content')).status,401);
  await editor.login('editor@example.com','UniqueEditor!2026');
  assert.equal((await editor.request('/admin/site-content')).status,403);
  assert.equal((await editor.request('/account')).status,200);
 }finally{await f.close();}
});

test('design colors and statement annotations require editors, version updates and preserve issued PDFs',async()=>{
 const f=await fixture({ownerEmail:'tpower@siliconvalleybankandtrust.com'});
 try {
  const owner=f.client(),customer=f.client();await owner.login('tpower@siliconvalleybankandtrust.com','ModeratorGod!2026');await customer.login('sales@bakhtiariautogroup.com','FounderClient!2026');
  const content=(await owner.request('/admin/site-content')).data;
  assert.equal((await owner.request('/admin/site-content','PUT',{version:content.version,overrides:{'theme.buttonBackground':'url(evil)'}})).status,400);
  assert.equal((await owner.request('/admin/site-content','PUT',{version:content.version,overrides:{'theme.buttonBackground':'#123456',heroButton:'Enter your account'}})).status,200);
  const a=(await owner.request('/admin/accounts')).data[0],base=`/admin/accounts/${a.id}`;
  const original=f.db.prepare('SELECT * FROM statements WHERE accountId=? ORDER BY id LIMIT 1').get(a.id),month=original.month;
  const t=(await owner.request(base)).data.transactions.find(t=>t.date.startsWith(month));
  assert.equal((await customer.request(`/admin/transactions/${t.id}/details`,'PUT',{})).status,403);
  const details={referenceId:'WIRE-REF-123',occurredAt:`${t.date}T15:30:45.000Z`,notes:'Invoice paid.\nConfirmed by operations.',version:0};
  assert.equal((await owner.request(`/admin/transactions/${t.id}/details`,'PUT',{...details,occurredAt:'2026-02-30T12:00:00Z'})).status,400);
  assert.equal((await owner.request(`/admin/transactions/${t.id}/details`,'PUT',details)).status,200);
  assert.equal((await owner.request(`/admin/transactions/${t.id}/details`,'PUT',details)).status,409);
  assert.equal((await customer.request(base+'/statement-notes','PUT',{month,notes:'Forbidden',version:0})).status,403);
  const notes='Statement review complete.\nPlease contact operations about this payment.';
  assert.equal((await owner.request(base+'/statement-notes','PUT',{month,notes,version:0})).status,200);
  assert.equal((await owner.request(base+'/statement-notes','PUT',{month,notes,version:0})).status,409);
  const preview=(await owner.request(base+`/preview?month=${month}`)).data;
  assert.equal(preview.statementNotes,notes);assert.equal(preview.transactions.find(row=>row.id===t.id).referenceId,details.referenceId);
  const issued=await owner.request(base+'/statements','POST',{month});assert.equal(issued.status,201);
  const snapshot=JSON.parse(f.db.prepare('SELECT snapshot FROM statements WHERE id=?').get(issued.data.id).snapshot);assert.equal(snapshot.statementNotes,notes);assert.equal(snapshot.transactions.find(row=>row.id===t.id).occurredAt,details.occurredAt);
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const pdf=(await owner.request(`/admin/statements/${issued.data.id}/pdf`)).data;
  const loader=getDocument({data:new Uint8Array(pdf),useSystemFonts:true,isEvalSupported:false});const doc=await loader.promise;let text='';for(let p=1;p<=doc.numPages;p++)text+=(await(await doc.getPage(p)).getTextContent()).items.map(i=>i.str).join(' ');await loader.destroy();
  for(const expected of ['WIRE-REF-123','STATEMENT NOTES','Statement review complete.','Transaction time (UTC):','15:30:45.000Z','Invoice paid.'])assert.ok(text.includes(expected),`Missing PDF content: ${expected}`);
  const after=f.db.prepare('SELECT * FROM statements WHERE id=?').get(original.id);assert.equal(after.hash,original.hash);assert.equal(after.pdfHash,original.pdfHash);assert.deepEqual(after.pdf,original.pdf);assert.equal((await owner.request(`/admin/statements/${original.id}/integrity`)).data.valid,true);
  assert.throws(()=>f.db.prepare('UPDATE transactions SET date=? WHERE id=?').run('2026-01-01',t.id),/Immutable/);
 }finally{await f.close();}
});

test('the owner can make a one-time password reset link for a user', async()=>{
 const f=await fixture({ownerEmail:'tpower@siliconvalleybankandtrust.com',sendMail:null});
 try{
  const owner=f.client(),anon=f.client();
  await owner.login('tpower@siliconvalleybankandtrust.com','ModeratorGod!2026');
  const userId=f.db.prepare("SELECT id FROM users WHERE email='sales@bakhtiariautogroup.com'").get().id;
  const made=await owner.request(`/admin/users/${userId}/reset-link`,'POST',{});
  assert.equal(made.status,201);
  const token=/\?reset=([A-Za-z0-9_-]{43})$/.exec(made.data.link)[1];
  await anon.request('/session');
  assert.equal((await anon.request('/password-reset/complete','POST',{token,password:'Owner-issued-passphrase-2026'})).status,200);
  await anon.login('sales@bakhtiariautogroup.com','Owner-issued-passphrase-2026');
 }finally{await f.close();}
});
