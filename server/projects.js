import { atomic, audit } from './db.js';
import { fail, text } from './services.js';

export function initializeProjects(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL,
    description TEXT NOT NULL, privateNotes TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1, published TEXT, publishedAt TEXT,
    updatedAt TEXT NOT NULL, actorId INTEGER NOT NULL REFERENCES users(id)
  )`);
}
function paragraph(value, label, max, optional = false) {
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail(400, `${label} must be ${optional ? 'at most' : 'between 1 and'} ${max} characters.`);
  return value.trim();
}
function current(db, id, version) {
  const row = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  if (!row) fail(404, 'Project not found.');
  if (!Number.isSafeInteger(version) || row.version !== version) fail(409, 'This project changed. Reload it before saving or publishing.');
  return row;
}
export function saveProject(db, id, values, actorId) {
  const title = text(values.title, 'Title', 120);
  const summary = paragraph(values.summary, 'Summary', 400);
  const description = paragraph(values.description, 'Public description', 4000);
  const privateNotes = paragraph(values.privateNotes ?? '', 'Private notes', 3000, true);
  return atomic(db, () => {
    const now = new Date().toISOString();
    if (id) {
      current(db, id, values.version);
      db.prepare('UPDATE projects SET title=?,summary=?,description=?,privateNotes=?,version=version+1,updatedAt=?,actorId=? WHERE id=?').run(title, summary, description, privateNotes, now, actorId, id);
    } else {
      id = Number(db.prepare('INSERT INTO projects(title,summary,description,privateNotes,updatedAt,actorId) VALUES (?,?,?,?,?,?)').run(title, summary, description, privateNotes, now, actorId).lastInsertRowid);
    }
    audit(db, actorId, 'project.save', id);
    return db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  });
}
export function publishProject(db, id, version, publish, actorId) {
  return atomic(db, () => {
    const row = current(db, id, version), now = new Date().toISOString();
    const published = publish ? JSON.stringify({ id: row.id, title: row.title, summary: row.summary, description: row.description }) : null;
    db.prepare('UPDATE projects SET published=?,publishedAt=?,version=version+1,updatedAt=?,actorId=? WHERE id=?').run(published, publish ? now : null, now, actorId, id);
    audit(db, actorId, publish ? 'project.publish' : 'project.unpublish', id);
    return db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  });
}
export function publicProjects(db) {
  return db.prepare('SELECT published,publishedAt FROM projects WHERE published IS NOT NULL ORDER BY publishedAt DESC,id DESC').all().map(row => ({ ...JSON.parse(row.published), publishedAt: row.publishedAt }));
}
