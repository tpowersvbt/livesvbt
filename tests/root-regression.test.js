import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { createApp } from '../server/index.js';
import { openDatabase, verifyPassword } from '../server/db.js';
import { digest } from '../server/services.js';

const origin = 'http://localhost:3000';
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

test('site settings and team: public reads, moderator-only writes, validation and ordering', async () => {
  const f = await fixture();
  try {
    const anon = f.client(); await anon.request('/session');
    const pub = await anon.request('/site');
    assert.equal(pub.status, 200);
    assert.ok(pub.data.settings.heroTitle);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM site_settings').get().n, 1);
    assert.deepEqual((await anon.request('/team')).data, []);
    assert.equal((await anon.request('/admin/settings', 'PUT', { heroTitle: 'x' })).status, 401);
    assert.equal((await anon.request('/admin/site', 'PUT', { heroTitle: 'x' })).status, 401);
    const customer = f.client(); await customer.request('/session');
    await customer.request('/login', 'POST', { email: 'sales@bakhtiariautogroup.com', password: 'FounderClient!2026' });
    assert.equal((await customer.request('/admin/settings', 'PUT', { heroTitle: 'x' })).status, 403);
    assert.equal((await customer.request('/admin/site', 'PUT', { heroTitle: 'x' })).status, 403);
    assert.equal((await customer.request('/admin/employees', 'POST', { name: 'A', title: 'B', bio: 'C' })).status, 403);
    const c = f.client(); await c.request('/session');
    assert.equal((await c.request('/login', 'POST', { email: 'tpower@siliconvalleybankandtrust.com', password: 'ModeratorGod!2026' })).status, 200);
    assert.equal((await c.request('/admin/settings', 'PUT', { heroTitle: 'New title', bannerImage: 'javascript:alert(1)' })).status, 400);
    assert.equal((await c.request('/admin/settings', 'PUT', { unknown: 'x' })).status, 400);
    assert.equal((await c.request('/admin/site', 'PUT', { heroTitle: 'New title', footerText: 'Footer', bannerImage: '/banner.png', heroImage: '/svbt-facade.jpg', footerImage: '/footer.jpg' })).status, 200);
    assert.equal((await anon.request('/site')).data.settings.heroTitle, 'New title');
    assert.equal((await anon.request('/site')).data.settings.heroImage, '/svbt-facade.jpg');
    assert.equal(f.db.prepare('SELECT heroTitle FROM site_settings WHERE id=1').get().heroTitle, 'New title');
    assert.deepEqual((await c.request('/admin/team')).data, []);
    const first = (await c.request('/admin/team', 'POST', { name: 'First', title: 'T', bio: 'B', photoUrl: 'https://example.com/a.jpg', displayOrder: 1 })).data;
    assert.equal((await c.request(`/admin/team/${first.id}`, 'PUT', { name: 'First Updated', title: 'T2', bio: 'Updated', displayOrder: 3 })).data.name, 'First Updated');
    assert.equal((await anon.request('/team')).data[0].name, 'First Updated');
    assert.equal((await c.request(`/admin/team/${first.id}`, 'DELETE', {})).status, 200);
    assert.deepEqual((await anon.request('/team')).data, []);
    const second = (await c.request('/admin/employees', 'POST', { name: 'Second', title: 'T', bio: 'B', displayOrder: 2 })).data;
    await c.request('/admin/employees', 'POST', { name: 'First', title: 'T', bio: 'B', photoUrl: 'https://example.com/a.jpg', displayOrder: 1 });
    assert.equal((await c.request('/admin/employees', 'POST', { name: 'Bad', title: 'T', bio: 'B', photoUrl: 'http://example.com/a.jpg' })).status, 400);
    assert.deepEqual((await anon.request('/site')).data.employees.map(e => e.name), ['First', 'Second']);
    assert.equal((await c.request(`/admin/employees/${second.id}`, 'DELETE', {})).status, 200);
    assert.equal((await c.request(`/admin/employees/${second.id}`, 'DELETE', {})).status, 404);
    assert.deepEqual((await anon.request('/site')).data.employees.map(e => e.name), ['First']);
  } finally { await f.close(); }
});

test('Funds Flow bulk CSV validates all rows before atomically posting 1-2000 entries', async () => {
  const f = await fixture();
  try {
    const admin = f.client();
    await admin.login('tpower@siliconvalleybankandtrust.com', 'ModeratorGod!2026');
    const result = await admin.request('/admin/accounts/1/transactions/bulk', 'POST', {
      rows: 'date,description,amount\n2026-10-01,Wire in,"1,500.00"\n2026-10-02,"Office rent, Suite 4",(1800.50)'
    });
    assert.equal(result.status, 201);
    assert.deepEqual(result.data.map(row => [row.description, row.amount]), [['Wire in', 150000], ['Office rent, Suite 4', -180050]]);
    const existing = f.db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE date >= ?').get('2026-10-01').n;
    const invalid = await admin.request('/admin/accounts/1/transactions/bulk', 'POST', {
      rows: '2026-10-03,Valid row,1.00\n2026-10-04,Invalid row,not-money'
    });
    assert.equal(invalid.status, 400);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE date >= ?').get('2026-10-01').n, existing);
    const entries = await admin.request('/admin/accounts/1/transactions/bulk', 'POST', {
      entries: [{ date: '2026-10-05', description: 'Existing format', amount: 100 }]
    });
    assert.equal(entries.status, 201);
    const tooMany = await admin.request('/admin/accounts/1/transactions/bulk', 'POST', {
      rows: Array.from({ length: 2001 }, (_, i) => `2026-10-01,Row ${i + 1},1.00`).join('\n')
    });
    assert.equal(tooMany.status, 400);
  } finally { await f.close(); }
});

test('brand constants: phone number and logo path', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /PHONE_DISPLAY = '\(844\) 842-SVBT'/);
  assert.match(app, /PHONE_HREF = 'tel:\+18448427828'/);
  assert.ok(app.includes('src="/svbt-logo.jpg"'));
  assert.ok(!/824-?SVBT|8247828/i.test(app));
});
