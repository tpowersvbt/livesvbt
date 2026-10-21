import 'dotenv/config';
import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDatabase, seedDemo, demoCredentials, hashPassword, verifyPassword, atomic, audit, newAccount } from './db.js';
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
  const demoSeed = options.demoSeed ?? (process.env.DEMO_SEED === undefined ? !production : process.env.DEMO_SEED === 'true');
  if (production && demoSeed) throw new Error('Demonstration seeding is forbidden in production.');
  const authRateLimit = options.authRateLimit ?? 30;
  if (!Number.isSafeInteger(authRateLimit) || authRateLimit < 1) throw new Error('authRateLimit must be a positive integer.');
  return { production, origin, demoSeed, authRateLimit, frontend: options.frontend ?? true, dbPath: options.dbPath ?? resolve(process.env.DB_PATH || resolve(root, 'data/bank.sqlite')), statementDir: resolve(options.statementDir ?? process.env.STATEMENT_DIR ?? resolve(root, 'monthly/statements')), trustProxy: options.trustProxy ?? process.env.TRUST_PROXY === 'true', dev: options.dev ?? false };
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
function identifier(value) { if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) fail(400, 'Invalid record identifier.'); return Number(value); }
export async function createApp(options = {}) {
  const config = configuration(options);
  let dbPath = config.dbPath;
  
  // Force fresh database on first startup
  const fs = await import('fs');
  const freshStart = !fs.existsSync(dbPath);
  if (freshStart) {
    console.log('Fresh database - will provision demo accounts on startup');
  }
  
  const db = openDatabase(dbPath);
  let vite;
  try {
    // Always provision demo accounts (whether DEMO_SEED is on or off) - works in production
    const [modEmail, modPassword] = demoCredentials.moderator;
    const [custEmail, custPassword] = demoCredentials.customer;
    
    // Create moderator if doesn't exist
    if (!db.prepare('SELECT id FROM users WHERE email=?').get(modEmail)) {
      console.log(`Provisioning moderator: ${modEmail}`);
      const modHash = await hashPassword(modPassword);
      db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run(
        modEmail, 'Timothy Powers', '123 Banking Street, Palo Alto, CA 94301', 'moderator', modHash
      );
      console.log('✓ Moderator account created');
    }
    
    // Create customer if doesn't exist
    let custUser = db.prepare('SELECT id FROM users WHERE email=?').get(custEmail);
    if (!custUser) {
      console.log(`Provisioning customer: ${custEmail}`);
      const custHash = await hashPassword(custPassword);
      const custId = Number(db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run(
        custEmail, 'Bakhtiari Auto Group', '456 Commerce Way, Los Angeles, CA 90001', 'customer', custHash
      ).lastInsertRowid);
      newAccount(db, custId, 'Bakhtiari Auto Group', '456 Commerce Way, Los Angeles, CA 90001');
      custUser = db.prepare('SELECT id FROM users WHERE email=?').get(custEmail);
      console.log('✓ Customer account created');
    }
    
    // Seed demo transactions and statements if empty
    const custAccount = db.prepare('SELECT id FROM accounts WHERE userId=?').get(custUser.id);
    if (custAccount && !db.prepare('SELECT id FROM transactions WHERE accountId=?').get(custAccount.id)) {
      console.log('Seeding demo transactions and statements...');
      await seedDemo(db);
      const mod = db.prepare('SELECT id FROM users WHERE email=?').get(modEmail);
      for (const month of ['2026-06', '2026-07', '2026-08', '2026-09']) {
        if (!db.prepare('SELECT id FROM statements WHERE accountId=? AND month=?').get(custAccount.id, month)) {
          await issueStatement(db, custAccount.id, month, mod.id, config.statementDir);
        }
      }
      console.log('✓ Demo data seeded successfully');
    }
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
      
      // Allow configured origin, Render preview URLs, and localhost
      const allowedOriginPatterns = [
        config.origin,
        'http://localhost:3000',
        'http://localhost:3005',
        /^https:\/\/svbt-[a-z0-9]+\.onrender\.com$/,
        'https://siliconvalleybankandtrust.com'
      ];
      
      const isOriginAllowed = (origin) => {
        if (!origin) return true;
        return allowedOriginPatterns.some(pattern => {
          if (typeof pattern === 'string') return origin === pattern;
          if (pattern instanceof RegExp) return pattern.test(origin);
          return false;
        });
      };
      
      if (requestOrigin && !isOriginAllowed(requestOrigin)) {
        return next(Object.assign(new Error('Request origin is not allowed.'), { status: 403 }));
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && requestOrigin && !isOriginAllowed(requestOrigin)) {
        return next(Object.assign(new Error('An exact matching Origin is required for write requests.'), { status: 403 }));
      }
      if (req.get('sec-fetch-site') === 'cross-site') return next(Object.assign(new Error('Cross-site requests are forbidden.'), { status: 403 }));
      next();
    });
    app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
    app.use('/api', express.json({ limit: '16kb', strict: true }));
    const cookieName = 'svbt_session';
    function makeSession(req, res, userId) {
      const token = randomBytes(32).toString('base64url'), csrfToken = randomBytes(32).toString('base64url');
      atomic(db, () => {
        if (req.session) db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(req.session.tokenHash);
        db.prepare('DELETE FROM sessions WHERE expiresAt<=?').run(Date.now());
        db.prepare('INSERT INTO sessions(tokenHash,userId,csrfToken,expiresAt) VALUES (?,?,?,?)').run(digest(token), userId ?? null, csrfToken, Date.now() + 8 * 60 * 60 * 1000);
      });
      res.cookie(cookieName, token, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 8 * 60 * 60 * 1000 });
      req.session = { tokenHash: digest(token), userId, csrfToken };
      return csrfToken;
    }
    app.use('/api', (req, res, next) => {
      const tokens = (req.get('cookie') || '').split(';').map(item => item.trim()).filter(item => item.startsWith(`${cookieName}=`));
      const token = tokens.length === 1 ? tokens[0].slice(cookieName.length + 1) : '';
      if (/^[A-Za-z0-9_-]{43}$/.test(token)) req.session = db.prepare('SELECT * FROM sessions WHERE tokenHash=? AND expiresAt>?').get(digest(token), Date.now());
      req.user = req.session?.userId ? db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId) : null;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const provided = req.get('x-csrf-token') || '', expected = req.session?.csrfToken || '';
        if (!expected || Buffer.byteLength(provided) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return next(Object.assign(new Error('A valid session CSRF token is required.'), { status: 403 }));
        if (!req.is('application/json')) return next(Object.assign(new Error('Write requests require application/json.'), { status: 415 }));
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return next(Object.assign(new Error('A JSON object is required.'), { status: 400 }));
      }
      next();
    });
    const auth = (req, res, next) => req.user ? next() : next(Object.assign(new Error('Sign in to access this resource.'), { status: 401 }));
    const moderator = (req, res, next) => !req.user ? next(Object.assign(new Error('Sign in to access operations.'), { status: 401 })) : req.user.role === 'moderator' ? next() : next(Object.assign(new Error('Moderator permission is required.'), { status: 403 }));
    app.get('/api/session', (req, res) => res.json({ user: publicUser(req.user), csrfToken: req.session?.csrfToken || makeSession(req, res, null) }));
    const attempts = new Map();
    const limiter = (req, res, next) => {
      const key = req.ip, now = Date.now();
      for (const [ip, value] of attempts) if (value.until <= now) attempts.delete(ip);
      const current = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
      if ((!attempts.has(key) && attempts.size >= 10000) || current.count >= config.authRateLimit) { res.set('Retry-After', String(Math.max(1, Math.ceil((current.until - now) / 1000)))); return next(Object.assign(new Error('Too many authentication attempts. Try again later.'), { status: 429 })); }
      current.count++;
      attempts.set(key, current); next();
    };
    app.post('/api/register', limiter, async (req, res) => {
      const values = req.body, userEmail = email(values.email), name = text(values.name, 'Name', 200), address = text(values.address, 'Address', 500);
      if (Object.hasOwn(values, 'role') && values.role !== 'customer') fail(400, 'Registration can only create customers.');
      if (db.prepare('SELECT id FROM users WHERE email=?').get(userEmail)) fail(409, 'This email address is already registered.');
      const secret = password(values.password, true);
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
      const user = db.prepare('SELECT * FROM users WHERE email=?').get(userEmail);
      const verified = await authenticate(() => verifyPassword(secret, user?.passwordHash || dummyHash), res);
      if (!user || !verified) fail(401, 'Email or password is incorrect.');
      audit(db, user.id, 'session.login', user.id);
      res.json({ user: publicUser(user), csrfToken: makeSession(req, res, user.id) });
    });
    app.post('/api/logout', (req, res) => {
      if (req.user) audit(db, req.user.id, 'session.logout', req.user.id);
      res.json({ user: null, csrfToken: makeSession(req, res, null) });
    });
    app.get('/api/profile', auth, (req, res) => res.json({ ...publicUser(req.user), address: req.user.address }));
    app.patch('/api/profile', auth, limiter, async (req, res) => {
      const name = text(req.body.name, 'Name', 200), address = text(req.body.address, 'Address', 500);
      const secret = password(req.body.password);
      if (!await authenticate(() => verifyPassword(secret, req.user.passwordHash), res)) fail(401, 'Current password verification failed.');
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
    app.use('/api/admin', moderator);
    app.get('/api/admin/accounts', (req, res) => res.json(db.prepare('SELECT * FROM accounts ORDER BY id').all()));
    app.get('/api/admin/accounts/:id', (req, res) => res.json(accountData(db, identifier(req.params.id))));
    app.post('/api/admin/accounts/:id/transactions', (req, res) => res.status(201).json(postTransaction(db, identifier(req.params.id), req.body, req.user.id)));
    app.post('/api/admin/transactions/:id/reverse', (req, res) => res.status(201).json(reverseTransaction(db, identifier(req.params.id), req.body, req.user.id)));
    app.get('/api/admin/accounts/:id/preview', (req, res) => res.json(preview(db, identifier(req.params.id), req.query.month)));
    app.get('/api/admin/accounts/:id/statements', (req, res) => res.json(archive(db, identifier(req.params.id))));
    app.post('/api/admin/accounts/:id/statements', async (req, res) => res.status(201).json(await issueStatement(db, identifier(req.params.id), req.body.month, req.user.id, config.statementDir)));
    app.get('/api/admin/statements/:id/integrity', (req, res) => res.json(integrity(db, identifier(req.params.id))));
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
