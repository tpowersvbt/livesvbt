import { hashPassword, atomic, audit, publicPasswords } from './db.js';

export async function ensureModerator(db) {
  const email = process.env.MODERATOR_EMAIL?.trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('MODERATOR_EMAIL must be a valid email.');
  const existing = db.prepare('SELECT id,role FROM users WHERE email=?').get(email);
  if (existing) {
    if (existing.role !== 'moderator') throw new Error('MODERATOR_EMAIL belongs to a customer. Account privileges were not changed.');
    return existing.id;
  }
  const password = process.env.MODERATOR_PASSWORD;
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024 || publicPasswords.has(password)) {
    throw new Error('Set MODERATOR_PASSWORD to a unique password of 12-1024 characters.');
  }
  const hash = await hashPassword(password);
  return atomic(db, () => {
    const id = Number(db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run(email, process.env.MODERATOR_NAME || 'Timothy Powers', process.env.MODERATOR_ADDRESS || 'Silicon Valley, California', 'moderator', hash).lastInsertRowid);
    audit(db, id, 'moderator.provision', id, { email });
    return id;
  });
}
