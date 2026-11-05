// Password reset by emailed one-time link. Tokens are 32 random bytes, stored only as a hash, valid
// for 30 minutes and usable once. A completed reset signs the user out everywhere. Requests always
// get the same answer, so the form never reveals whether an email address has an account.
import { randomBytes } from 'node:crypto';
import { hashPassword, publicPasswords, atomic, audit } from './db.js';
import { digest, fail } from './services.js';

const lifetimeMs = 30 * 60 * 1000;
const accepted = 'If that email address has an account, a reset link is on its way. It expires in 30 minutes.';

// Sends through Resend's HTTP API when RESEND_API_KEY and MAIL_FROM are set.
export function resendMailer(env = process.env) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) return null;
  return async ({ to, subject, text }) => {
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text }) });
    if (!response.ok) throw new Error(`Email provider returned ${response.status}.`);
  };
}

function issue(db, userId) {
  const token = randomBytes(32).toString('base64url');
  atomic(db, () => {
    db.prepare('DELETE FROM password_resets WHERE userId=?').run(userId);
    db.prepare('INSERT INTO password_resets(tokenHash,userId,expiresAt) VALUES (?,?,?)').run(digest(token), userId, Date.now() + lifetimeMs);
  });
  return token;
}

export function installPasswordReset(app, db, { origin, limiter, authenticate, accountGuard, email, password, sendMail, ownerOnly }) {
  const link = token => `${origin}/?reset=${token}`;

  app.post('/api/password-reset/request', limiter, (req, res) => {
    const address = email(req.body.email);
    if (!sendMail) fail(503, 'Password reset by email is not set up yet. Contact the site operator.');
    const user = db.prepare('SELECT id,email FROM users WHERE email=?').get(address);
    if (user) {
      const token = issue(db, user.id);
      audit(db, null, 'password-reset.request', user.id);
      // Not awaited, so the response time doesn't reveal whether the address has an account.
      Promise.resolve().then(() => sendMail({ to: user.email, subject: 'Reset your SVBT password', text: `Someone asked to reset the password for this account.\n\nTo choose a new password, open this link within 30 minutes:\n${link(token)}\n\nIf you didn't ask for this, ignore this email; your password stays the same.` }))
        .catch(error => console.error(`Password reset email for user ${user.id} failed: ${error.message}`));
    }
    res.status(202).json({ message: accepted });
  });

  app.post('/api/password-reset/complete', limiter, async (req, res) => {
    const token = req.body.token;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail(400, 'This reset link is not valid. Request a new one.');
    const secret = password(req.body.password, true);
    if (publicPasswords.has(secret)) fail(400, 'Choose a password that has not been published.');
    const row = db.prepare('SELECT * FROM password_resets WHERE tokenHash=? AND expiresAt>?').get(digest(token), Date.now());
    if (!row) fail(400, 'This reset link has expired or was already used. Request a new one.');
    const passwordHash = await authenticate(() => hashPassword(secret), res);
    const user = atomic(db, () => {
      // Consume the token inside the lock so two submissions can't both succeed.
      if (!db.prepare('DELETE FROM password_resets WHERE tokenHash=? AND expiresAt>?').run(digest(token), Date.now()).changes) fail(400, 'This reset link has expired or was already used. Request a new one.');
      db.prepare('UPDATE users SET passwordHash=? WHERE id=?').run(passwordHash, row.userId);
      db.prepare('DELETE FROM sessions WHERE userId=?').run(row.userId);
      audit(db, row.userId, 'password-reset.complete', row.userId);
      return db.prepare('SELECT email FROM users WHERE id=?').get(row.userId);
    });
    accountGuard.clear(user.email.toLowerCase());
    res.json({ message: 'Password updated. Sign in with your new password.' });
  });

  // For when email isn't configured or a customer calls in: the owner gets a one-time link to pass on.
  app.post('/api/admin/users/:id/reset-link', ownerOnly, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || !db.prepare('SELECT id FROM users WHERE id=?').get(id)) fail(404, 'User not found.');
    const token = issue(db, id);
    audit(db, req.user.id, 'password-reset.link', id);
    res.status(201).json({ link: link(token), expiresInMinutes: 30 });
  });
}
