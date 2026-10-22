import { initializeAdministration, provisionHandoverOwner, effectiveUser, installAdministration, siteContent } from './administration.js';
import 'dotenv/config';
import { initializeLeadership, leadership, updateLeadership } from './leadership.js';
import { initializeProjects, saveProject, publishProject, publicProjects } from './projects.js';
import { migrate } from './migrations.js';
import { renderStatement } from './pdf.js';
import { pin, trivialPin, checkPin, savePin, ownAccount, transferRequest, postTransfer, transferSummary } from './transfers.js';

import express from 'express';

import { randomBytes, timingSafeEqual } from 'node:crypto';

import { isIPv4, isIPv6 } from 'node:net';

import { resolve, dirname } from 'node:path';

import { fileURLToPath, pathToFileURL } from 'node:url';

import { openDatabase, seedDemo, hashPassword, verifyPassword, atomic, audit, newAccount, publicPasswords } from './db.js';

import { ensureModerator } from './provision.js';
import { previewImport, postImport, setDemo } from './imports.js';
import { installPasswordReset, resendMailer } from './password-reset.js';

import { digest, fail, text, accountData, postTransaction, reverseTransaction, preview, archive, statement, integrity, issueStatement, saveInvestment } from './services.js';



const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let authenticationActive = 0;

async function authenticate(operation, res) {

  if (authenticationActive >= 2) {

    res.set('Retry-After', '1');

    fail(429, 'Authentication capacity is busy. Try again later.');

  }

  authenticationActive++;

  try { return await operation(); } finally { authenticationActive--; }

}

export function configuration(options = {}) {

  const production = options.production ?? process.env.NODE_ENV === 'production';

  const origin = options.origin ?? process.env.APP_ORIGIN ?? (production ? '' : 'http://localhost:3000');

  let parsed;

  try { parsed = new URL(origin); } catch { throw new Error('APP_ORIGIN must be an explicit valid origin.'); }

  if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol) || (production && parsed.protocol !== 'https:')) throw new Error('APP_ORIGIN must be an exact origin, HTTPS in production.');

  const origins = [...new Set([origin, ...(options.origins ?? (process.env.APP_ORIGINS || '').split(',').filter(Boolean))])];
  for (const allowed of origins) {
    let url;
    try { url = new URL(allowed); } catch { throw new Error('APP_ORIGINS must contain exact valid origins.'); }
    if (url.origin !== allowed || !['http:', 'https:'].includes(url.protocol) || (production && url.protocol !== 'https:')) throw new Error('APP_ORIGINS must contain exact origins, HTTPS in production.');
  }

  const sampleData = options.sampleData ?? process.env.SAMPLE_DATA === 'true';

  const demoSeed = options.demoSeed ?? (process.env.DEMO_SEED === undefined ? !production : process.env.DEMO_SEED === 'true');

  if (production && demoSeed) throw new Error('Demonstration seeding is forbidden in production.');

  const authRateLimit = options.authRateLimit ?? 30;

  if (!Number.isSafeInteger(authRateLimit) || authRateLimit < 1) throw new Error('authRateLimit must be a positive integer.');

  const accountFailureLimit = options.accountFailureLimit ?? 10, sessionRateLimit = options.sessionRateLimit ?? 120;
  if (![accountFailureLimit, sessionRateLimit].every(value => Number.isSafeInteger(value) && value >= 1)) throw new Error('accountFailureLimit and sessionRateLimit must be positive integers.');
  const sessionIdleMs = options.sessionIdleMs ?? Number(process.env.SESSION_IDLE_MINUTES || 30) * 60 * 1000;
  if (!Number.isSafeInteger(sessionIdleMs) || sessionIdleMs < 60 * 1000 || sessionIdleMs > 8 * 60 * 60 * 1000) throw new Error('SESSION_IDLE_MINUTES must be a whole number from 1 to 480.');

  const transferDailyLimit = options.transferDailyLimit ?? Number(process.env.TRANSFER_DAILY_LIMIT_CENTS || 1000000);
  if (!Number.isSafeInteger(transferDailyLimit) || transferDailyLimit < 1 || transferDailyLimit > 100000000000) throw new Error('TRANSFER_DAILY_LIMIT_CENTS must be a positive whole number of cents.');

  return { production, origin, origins, demoSeed, transferDailyLimit, sampleData, authRateLimit, accountFailureLimit, sessionRateLimit, sessionIdleMs, frontend: options.frontend ?? true, dbPath: options.dbPath ?? resolve(process.env.DB_PATH || resolve(root, 'data/bank.sqlite')), statementDir: resolve(options.statementDir ?? process.env.STATEMENT_DIR ?? resolve(root, 'monthly/statements')), trustProxy: options.trustProxy ?? process.env.TRUST_PROXY === 'true', dev: options.dev ?? false };

}

function publicUser(user) { return user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null; }

function email(value) {

  const normalized = text(value, 'Email', 254).toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) fail(400, 'A valid email address is required.');

  return normalized;

}

function password(value, registration = false) {

  if (typeof value !== 'string' || value.length > 1024 || value.length < (registration ? 12 : 1)) fail(400, registration ? 'Password must contain 12–1024 characters.' : 'Password is required.');

  return value;

}

// Rate-limit key: IPv4 address, or the /64 network for IPv6, since one client usually controls a whole /64.
export function clientKey(ip = '') {
  if (ip.startsWith('::ffff:') && isIPv4(ip.slice(7))) return ip.slice(7);
  if (!isIPv6(ip)) return ip;
  const [head, tail = ''] = ip.split('%')[0].split('::');
  const first = head ? head.split(':') : [], last = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...first, ...Array(Math.max(0, 8 - first.length - last.length)).fill('0'), ...last] : first;
  return `${groups.slice(0, 4).map(group => parseInt(group, 16).toString(16)).join(':')}::/64`;
}

function identifier(value) { if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) fail(400, 'Invalid record identifier.'); return Number(value); }

export async function createApp(options = {}) {

  const config = configuration(options);

  const db = openDatabase(config.dbPath);
  initializeAdministration(db);
  initializeProjects(db);
  initializeLeadership(db);
  migrate(db);

  let vite;

  try {

    if (config.production && !config.sampleData && db.prepare("SELECT value FROM metadata WHERE key='demo-seeded'").get()) {

      throw new Error('A demo-seeded database requires SAMPLE_DATA=true for operations review.');

    }

    const moderatorId = await ensureModerator(db);

    if (config.sampleData && !moderatorId) throw new Error('SAMPLE_DATA requires MODERATOR_EMAIL and a provisioned moderator.');

    if (config.demoSeed || config.sampleData) {

      await seedDemo(db, config.sampleData ? { moderatorId, customerPassword: randomBytes(48).toString('hex') } : {});

      const accountId = Number(db.prepare("SELECT value FROM metadata WHERE key='demo-seeded'").get().value);

      const actor = moderatorId || db.prepare("SELECT id FROM users WHERE role='moderator' ORDER BY id LIMIT 1").get().id;

      for (const month of ['2026-06', '2026-07', '2026-08', '2026-09']) {

        if (!db.prepare('SELECT id FROM statements WHERE accountId=? AND month=?').get(accountId, month)) {

          await issueStatement(db, accountId, month, actor, config.statementDir);

        }

      }

    }

    provisionHandoverOwner(db, config.production ? 'tpower@siliconvalleybankandtrust.com' : options.ownerEmail);

    if (!config.demoSeed && !db.prepare("SELECT id FROM users WHERE role='moderator' LIMIT 1").get()) {
      console.warn('No staff account exists and demo seeding is off. Set MODERATOR_EMAIL and MODERATOR_PASSWORD (and MODERATOR_ROLE=owner for full access), then run `npm run create-moderator` from a shell on this server.');
    }

    const publicUser = raw => { const user=effectiveUser(db,raw); return user ? {id:user.id,name:user.name,email:user.email,role:user.role} : null; };
    const dummyHash = await hashPassword(randomBytes(32).toString('hex'));

    const app = express();

    app.disable('x-powered-by');

    if (config.trustProxy) app.set('trust proxy', 1);

    app.use((req, res, next) => {

      res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });

      if (config.production) res.set({ 'Strict-Transport-Security': 'max-age=31536000', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" });

      next();

    });

    app.use('/api', (req, res, next) => {

      res.set('Cache-Control', 'no-store');

      const requestOrigin = req.get('origin');

      

      if (requestOrigin && !config.origins.includes(requestOrigin)) return next(Object.assign(new Error('Request origin is not allowed.'), { status: 403 }));

      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !config.origins.includes(requestOrigin)) return next(Object.assign(new Error('An exact matching Origin is required for write requests.'), { status: 403 }));

      if (req.get('sec-fetch-site') === 'cross-site') return next(Object.assign(new Error('Cross-site requests are forbidden.'), { status: 403 }));

      next();

    });

    app.get('/api/site-content', (req,res)=>res.json(siteContent(db)));

    app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

    app.use('/api', (req, res, next) => express.json({ limit: req.path === '/admin/site-content' ? '128kb' : /^\/admin\/accounts\/\d+\/import(\/preview)?$/.test(req.path) ? '320kb' : /^\/admin\/accounts\/\d+\/statement-notes$/.test(req.path) ? '32kb' : '16kb', strict: true })(req, res, next));

    const cookieName = 'svbt_session';

    const sessionLifetimeMs = 8 * 60 * 60 * 1000, anonymousLifetimeMs = 2 * 60 * 60 * 1000;

    function makeSession(req, res, userId) {

      const token = randomBytes(32).toString('base64url'), csrfToken = randomBytes(32).toString('base64url');

      // Signed-in sessions expire after sessionIdleMs without activity and never outlive 8 hours.
      // Anonymous sessions only carry the sign-in CSRF token, so they are kept short.
      const now = Date.now(), absoluteExpiresAt = now + (userId ? sessionLifetimeMs : anonymousLifetimeMs);

      atomic(db, () => {

        if (req.session) db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(req.session.tokenHash);

        db.prepare('DELETE FROM sessions WHERE expiresAt<=?').run(now);

        db.prepare('INSERT INTO sessions(tokenHash,userId,csrfToken,expiresAt,absoluteExpiresAt) VALUES (?,?,?,?,?)').run(digest(token), userId ?? null, csrfToken, userId ? Math.min(now + config.sessionIdleMs, absoluteExpiresAt) : absoluteExpiresAt, absoluteExpiresAt);

      });

      res.cookie(cookieName, token, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: absoluteExpiresAt - now });

      req.session = { tokenHash: digest(token), userId, csrfToken };

      return csrfToken;

    }

    app.use('/api', (req, res, next) => {

      const tokens = (req.get('cookie') || '').split(';').map(item => item.trim()).filter(item => item.startsWith(`${cookieName}=`));

      const token = tokens.length === 1 ? tokens[0].slice(cookieName.length + 1) : '';

      if (/^[A-Za-z0-9_-]{43}$/.test(token)) req.session = db.prepare('SELECT * FROM sessions WHERE tokenHash=? AND expiresAt>?').get(digest(token), Date.now());

      // Slide the idle deadline on activity, at most once a minute, capped by the absolute expiry.
      if (req.session?.userId && req.session.absoluteExpiresAt) {
        const now = Date.now(), next = Math.min(now + config.sessionIdleMs, req.session.absoluteExpiresAt);
        if (next - req.session.expiresAt >= 60 * 1000) db.prepare('UPDATE sessions SET expiresAt=? WHERE tokenHash=?').run(next, req.session.tokenHash);
      }

      req.user = effectiveUser(db, req.session?.userId ? db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId) : null);

      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {

        const provided = req.get('x-csrf-token') || '', expected = req.session?.csrfToken || '';

        if (!expected || Buffer.byteLength(provided) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return next(Object.assign(new Error('A valid session CSRF token is required.'), { status: 403 }));

        if (!req.is('application/json')) return next(Object.assign(new Error('Write requests require application/json.'), { status: 415 }));

        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return next(Object.assign(new Error('A JSON object is required.'), { status: 400 }));

      }

      next();

    });

    const auth = (req, res, next) => req.user ? next() : next(Object.assign(new Error('Sign in to access this resource.'), { status: 401 }));

    const moderator = (req, res, next) => !req.user ? next(Object.assign(new Error('Sign in to access operations.'), { status: 401 })) : ['moderator','admin','owner'].includes(req.user.role) ? next() : next(Object.assign(new Error('Moderator permission is required.'), { status: 403 }));

    function rateLimit(limit, message) {
      const attempts = new Map();
      return (req, res, next) => {
        const key = clientKey(req.ip), now = Date.now();
        for (const [ip, value] of attempts) if (value.until <= now) attempts.delete(ip);
        const current = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
        if ((!attempts.has(key) && attempts.size >= 10000) || current.count >= limit) { res.set('Retry-After', String(Math.max(1, Math.ceil((current.until - now) / 1000)))); return next(Object.assign(new Error(message), { status: 429 })); }
        current.count++;
        attempts.set(key, current); next();
      };
    }

    const limiter = rateLimit(config.authRateLimit, 'Too many authentication attempts. Try again later.');

    const sessionLimiter = rateLimit(config.sessionRateLimit, 'Too many new sessions. Try again later.');

    app.get('/api/session', (req, res, next) => req.session ? next() : sessionLimiter(req, res, next), (req, res) => res.json({ user: publicUser(req.user), csrfToken: req.session?.csrfToken || makeSession(req, res, null) }));

    // Per-account failed password limit, independent of IP, so guesses spread across many addresses still stop.
    // Unknown emails are tracked the same way so the response never reveals whether an account exists.
    const failures = new Map(), failureWindowMs = 15 * 60 * 1000;
    const accountGuard = {
      check(key, res) {
        const current = failures.get(key), now = Date.now();
        if (current && current.until <= now) failures.delete(key);
        else if (current && current.count >= config.accountFailureLimit) {
          res.set('Retry-After', String(Math.max(1, Math.ceil((current.until - now) / 1000))));
          fail(429, 'Too many failed sign-in attempts for this account. Try again later.');
        }
      },
      failed(key, userId) {
        const now = Date.now();
        if (!failures.has(key) && failures.size >= 50000) failures.delete(failures.keys().next().value);
        const current = failures.get(key) || { count: 0, until: now + failureWindowMs };
        current.count++;
        failures.set(key, current);
        if (current.count === config.accountFailureLimit && userId) audit(db, null, 'session.locked', userId, { failures: current.count });
      },
      clear(key) { failures.delete(key); }
    };

    app.post('/api/register', limiter, async (req, res) => {

      const values = req.body, userEmail = email(values.email), name = text(values.name, 'Name', 200), address = text(values.address, 'Address', 500);

      if (Object.hasOwn(values, 'role') && values.role !== 'customer') fail(400, 'Registration can only create customers.');

      if (db.prepare('SELECT id FROM users WHERE email=?').get(userEmail)) fail(409, 'This email address is already registered.');

      const secret = password(values.password, true);

      if (publicPasswords.has(secret)) fail(400, 'Choose a password that has not been published.');

      const passwordHash = await authenticate(() => hashPassword(secret), res);

      const id = atomic(db, () => {

        if (db.prepare('SELECT id FROM users WHERE email=?').get(userEmail)) fail(409, 'This email address is already registered.');

        const userId = Number(db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run(userEmail, name, address, 'customer', passwordHash).lastInsertRowid);

        const accountId = newAccount(db, userId, name, address);

        audit(db, userId, 'user.register', accountId);

        return userId;

      });

      res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)), csrfToken: makeSession(req, res, id) });

    });

    app.post('/api/login', limiter, async (req, res) => {

      const userEmail = email(req.body.email), secret = password(req.body.password);

      accountGuard.check(userEmail, res);

      const user = db.prepare('SELECT * FROM users WHERE email=?').get(userEmail);

      const verified = await authenticate(() => verifyPassword(secret, user?.passwordHash || dummyHash), res);

      if (!user || !verified) { accountGuard.failed(userEmail, user?.id); fail(401, 'Email or password is incorrect.'); }

      accountGuard.clear(userEmail);

      if (config.production && publicPasswords.has(secret)) {

        console.warn(`Refused sign-in for user ${user.id}: the account uses a published password and must be reset.`);

        fail(401, 'Email or password is incorrect.');

      }

      audit(db, user.id, 'session.login', user.id);

      res.json({ user: publicUser(user), csrfToken: makeSession(req, res, user.id) });

    });

    installPasswordReset(app, db, { origin: config.origin, limiter, authenticate, accountGuard, email, password, sendMail: options.sendMail === undefined ? resendMailer() : options.sendMail, ownerOnly: (req, res, next) => req.user?.role === 'owner' ? next() : next(Object.assign(new Error('Owner permission is required.'), { status: req.user ? 403 : 401 })) });

    app.post('/api/logout', (req, res) => {

      if (req.user) audit(db, req.user.id, 'session.logout', req.user.id);

      res.json({ user: null, csrfToken: makeSession(req, res, null) });

    });

    app.get('/api/profile', auth, (req, res) => res.json({ ...publicUser(req.user), address: req.user.address }));

    app.patch('/api/profile', auth, limiter, async (req, res) => {

      const name = text(req.body.name, 'Name', 200), address = text(req.body.address, 'Address', 500);

      const secret = password(req.body.password);

      const guardKey = req.user.email.toLowerCase();

      accountGuard.check(guardKey, res);

      if (!await authenticate(() => verifyPassword(secret, req.user.passwordHash), res)) { accountGuard.failed(guardKey, req.user.id); fail(401, 'Current password verification failed.'); }

      accountGuard.clear(guardKey);

      atomic(db, () => {

        db.prepare('UPDATE users SET name=?,address=? WHERE id=?').run(name, address, req.user.id);

        db.prepare('UPDATE accounts SET name=?,address=? WHERE userId=?').run(name, address, req.user.id);

        audit(db, req.user.id, 'profile.update', req.user.id, { name, address });

      });

      res.json({ ...publicUser(req.user), name, address });

    });

    app.get('/api/account', auth, (req, res) => {

      const row = db.prepare('SELECT id FROM accounts WHERE userId=?').get(req.user.id);

      if (!row) fail(404, 'No customer account is associated with this user.');

      res.json(accountData(db, row.id));

    });

    // Customer transfers. Setting the PIN needs the account password; sending needs the PIN.
    app.get('/api/transfers', auth, (req, res) => res.json(transferSummary(db, req.user.id, config.transferDailyLimit)));
    app.put('/api/transfer-pin', auth, limiter, async (req, res) => {
      ownAccount(db, req.user.id);
      const secret = password(req.body.password), value = pin(req.body.pin);
      if (trivialPin(value)) fail(400, 'Choose a PIN that is not a repeated digit or a straight sequence.');
      const guardKey = req.user.email.toLowerCase();
      accountGuard.check(guardKey, res);
      if (!await authenticate(() => verifyPassword(secret, req.user.passwordHash), res)) { accountGuard.failed(guardKey, req.user.id); fail(403, 'Current password verification failed.'); }
      accountGuard.clear(guardKey);
      savePin(db, req.user.id, await authenticate(() => hashPassword(value), res));
      res.json(transferSummary(db, req.user.id, config.transferDailyLimit));
    });
    app.post('/api/transfers', auth, async (req, res) => {
      ownAccount(db, req.user.id);
      const request = transferRequest(req.body), value = pin(req.body.pin);
      // The PIN is checked before the recipient is looked up, so account numbers cannot be probed without it.
      await checkPin(db, req.user.id, value, (candidate, hash) => authenticate(() => verifyPassword(candidate, hash), res), res);
      res.status(201).json(postTransfer(db, req.user.id, request, config.transferDailyLimit));
    });
    app.get('/api/leadership', (req, res) => res.json(leadership(db).published));
    app.get('/api/projects', (req, res) => res.json(publicProjects(db)));
    app.use('/api/admin', moderator);
    installAdministration(app, db, authenticate);
    app.get('/api/admin/leadership', (req, res) => res.json(leadership(db)));
    app.put('/api/admin/leadership', (req, res) => res.json(updateLeadership(db, req.body, req.user.id)));
    app.post('/api/admin/leadership/publish', (req, res) => res.json(updateLeadership(db, req.body, req.user.id, true)));
    app.get('/api/admin/projects', (req, res) => res.json(db.prepare('SELECT * FROM projects ORDER BY updatedAt DESC,id DESC').all()));
    app.post('/api/admin/projects', (req, res) => res.status(201).json(saveProject(db, null, req.body, req.user.id)));
    app.put('/api/admin/projects/:id', (req, res) => res.json(saveProject(db, identifier(req.params.id), req.body, req.user.id)));
    app.post('/api/admin/projects/:id/publish', (req, res) => res.json(publishProject(db, identifier(req.params.id), req.body.version, true, req.user.id)));
    app.post('/api/admin/projects/:id/unpublish', (req, res) => res.json(publishProject(db, identifier(req.params.id), req.body.version, false, req.user.id)));

    app.get('/api/admin/accounts', (req, res) => res.json(db.prepare('SELECT * FROM accounts ORDER BY id').all()));

    app.get('/api/admin/accounts/:id', (req, res) => res.json(accountData(db, identifier(req.params.id))));

    app.post('/api/admin/accounts/:id/transactions', (req, res) => res.status(201).json(postTransaction(db, identifier(req.params.id), req.body, req.user.id)));

    app.post('/api/admin/transactions/:id/reverse', (req, res) => res.status(201).json(reverseTransaction(db, identifier(req.params.id), req.body, req.user.id)));

    app.get('/api/admin/accounts/:id/preview', (req, res) => res.json(preview(db, identifier(req.params.id), req.query.month)));

    app.get('/api/admin/accounts/:id/statements', (req, res) => res.json(archive(db, identifier(req.params.id))));

    app.post('/api/admin/accounts/:id/statements', async (req, res) => res.status(201).json(await issueStatement(db, identifier(req.params.id), req.body.month, req.user.id, config.statementDir)));

    const ownerOnly = (req, res, next) => req.user.role === 'owner' ? next() : next(Object.assign(new Error('Owner permission is required.'), { status: 403 }));

    app.put('/api/admin/accounts/:id/demo', ownerOnly, (req, res) => res.json(setDemo(db, identifier(req.params.id), req.body.demo, req.user.id)));

    app.post('/api/admin/accounts/:id/import/preview', ownerOnly, (req, res) => res.json(previewImport(db, identifier(req.params.id), req.body)));

    app.post('/api/admin/accounts/:id/import', ownerOnly, (req, res) => res.status(201).json(postImport(db, identifier(req.params.id), req.body, req.user.id)));

    app.get('/api/admin/statements/:id/integrity', (req, res) => res.json(integrity(db, identifier(req.params.id))));

    app.get('/api/admin/statements/:id/branded-pdf', async (req, res) => {
      const id = identifier(req.params.id), row = statement(db, id);
      if (!integrity(db, id).valid) fail(409, 'Issued statement integrity failed. PDF download is blocked.');
      const pdf = await renderStatement(JSON.parse(row.snapshot), { brandedCopy: true });
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="business-checking-${row.month}-r${row.revision}-branded.pdf"` }).send(pdf);
    });
    app.get('/api/admin/statements/:id/pdf', (req, res) => {

      const id = identifier(req.params.id), row = statement(db, id);

      if (!integrity(db, id).valid) fail(409, 'Issued statement integrity failed. PDF download is blocked.');

      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="business-checking-${row.month}-r${row.revision}.pdf"` }).send(Buffer.from(row.pdf));

    });

    app.get('/api/admin/investments', (req, res) => res.json(db.prepare('SELECT * FROM investments ORDER BY id').all()));

    app.post('/api/admin/investments', (req, res) => res.status(201).json(saveInvestment(db, null, req.body, req.user.id)));

    app.put('/api/admin/investments/:id', (req, res) => res.json(saveInvestment(db, identifier(req.params.id), req.body, req.user.id)));

    app.get('/api/admin/audit', (req, res) => res.json(db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 1000').all().map(row => ({ ...row, details: JSON.parse(row.details) }))));

    app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));

    if (config.frontend && config.dev) {

      const { createServer } = await import('vite');

      vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });

      app.use(vite.middlewares);

    } else if (config.frontend) {

      app.use(express.static(resolve(root, 'dist'), { index: false }));

      app.get('/{*path}', (req, res, next) => res.sendFile(resolve(root, 'dist/index.html'), error => error && next(error)));

    }

    app.use((error, req, res, next) => {

      if (res.headersSent) return next(error);

      const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);

      if (status >= 500) console.error(error);

      res.status(status).json({ error: status >= 500 ? 'The operation could not be completed. Please try again.' : error.type === 'entity.parse.failed' ? 'Malformed JSON request.' : error.message });

    });

    const close = async () => { if (vite) await vite.close(); db.close(); };

    app.locals.db = db; app.locals.config = config; app.locals.close = close;

    return app;

  } catch (error) { if (vite) await vite.close(); db.close(); throw error; }

}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {

  const app = await createApp({ dev: process.argv.includes('--dev') });

  const server = app.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log(`SVBT listening at ${app.locals.config.origin}`));

  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(async () => { await app.locals.close(); process.exit(0); }));

}


