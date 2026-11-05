import 'dotenv/config';
import { resolve } from 'node:path';
import { openDatabase, hashPassword, atomic, audit, publicPasswords } from './db.js';
import { text } from './services.js';
import { initializeAdministration } from './administration.js';

const email = text(process.env.MODERATOR_EMAIL, 'MODERATOR_EMAIL', 254).toLowerCase();
const password = process.env.MODERATOR_PASSWORD;
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('MODERATOR_EMAIL must be a valid email address.');
if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('MODERATOR_PASSWORD must contain 12–1024 characters.');
if (publicPasswords.has(password)) throw new Error('Provisioning requires a unique password, not a demonstration password.');
const role = process.env.MODERATOR_ROLE || 'moderator';
if (!['moderator', 'owner'].includes(role)) throw new Error('MODERATOR_ROLE must be moderator or owner.');
const name = text(process.env.MODERATOR_NAME || 'Timothy Powers', 'MODERATOR_NAME', 200);
const address = text(process.env.MODERATOR_ADDRESS || 'Silicon Valley, California', 'MODERATOR_ADDRESS', 500);
const passwordHash = await hashPassword(password);
const db = openDatabase(resolve(process.env.DB_PATH || 'data/bank.sqlite'));
initializeAdministration(db);
try {
  const id = atomic(db, () => {
    const existing = db.prepare('SELECT id,role FROM users WHERE email=?').get(email);
    if (existing && process.env.MODERATOR_RESET === 'true') {
      // Owners are stored as moderators with a staff_access row, so a reset rotates the password and leaves the role alone.
    if (existing.role !== 'moderator') throw new Error('This script never escalates customer accounts.');
      db.prepare('UPDATE users SET passwordHash=? WHERE id=?').run(passwordHash, existing.id);
      db.prepare('DELETE FROM sessions WHERE userId=?').run(existing.id);
      audit(db, existing.id, 'moderator.password-reset', existing.id, { email });
      return existing.id;
    }
    if (existing) throw new Error('That email already exists. This script never escalates or overwrites existing users.');
    const userId = Number(db.prepare('INSERT INTO users(email,name,address,role,passwordHash) VALUES (?,?,?,?,?)').run(email, name, address, 'moderator', passwordHash).lastInsertRowid);
    if (role === 'owner') db.prepare("INSERT INTO staff_access(userId,role) VALUES (?,'owner')").run(userId);
    audit(db, userId, 'moderator.provision', userId, { email, role });
    return userId;
  });
  console.log(process.env.MODERATOR_RESET === 'true' ? `Password for ${email} (user ${id}) was reset; its role was not changed.` : `${role === 'owner' ? 'Owner' : 'Moderator'} ${email} provisioned as user ${id}.`);
} finally { db.close(); }
