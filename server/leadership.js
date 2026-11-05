import { atomic, audit } from './db.js';
import { fail, text } from './services.js';

export const originalBiography = {
  name: 'Tim Power', role: 'Timothy Power — President, as described in the supplied biography', location: 'Alamo, California',
  biography: 'The supplied biography describes Timothy Power as an Alamo-based real estate and banking professional with more than twenty years of industry experience. It states that he obtained a real estate license in 1989, opened Pinnacle Mortgage Bank, Inc. in 1996, and opened an Intero Real Estate Services franchise in 2005.\n\nIt describes a focus on startup technologies, small data centers, REITs, new home builders and commercial construction, with an emphasis on methodical growth, operations and team leadership.',
  sourceNote: 'Source: supplied Timothy Power biography; not independently verified. The handover also uses "Timothy Powers." We retain "Power," the biography\'s primary naming, here. No bank founding date or regulatory status is asserted.'
};
export function initializeLeadership(db) {
  db.exec('CREATE TABLE IF NOT EXISTS leadership(id INTEGER PRIMARY KEY CHECK(id=1), draft TEXT NOT NULL, published TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, reviewedAt TEXT)');
  db.prepare('INSERT OR IGNORE INTO leadership(id,draft,published) VALUES (1,?,?)').run(JSON.stringify(originalBiography),JSON.stringify(originalBiography));
}
export function leadership(db) {
  const row=db.prepare('SELECT * FROM leadership WHERE id=1').get();
  return { draft: JSON.parse(row.draft), published: JSON.parse(row.published), version: row.version, reviewedAt: row.reviewedAt, original: originalBiography };
}
export function updateLeadership(db, values, actorId, publish = false) {
  return atomic(db, () => {
    const row=leadership(db);
    if (row.version !== values.version) fail(409, 'The biography changed. Reload before saving or publishing.');
    if (publish) {
      if (values.reviewed !== true) fail(400, 'Confirm you reviewed the biography for accuracy before publishing.');
      db.prepare('UPDATE leadership SET published=draft,version=version+1,reviewedAt=? WHERE id=1').run(new Date().toISOString());
    } else {
      const biography=values.biography;
      if (typeof biography !== 'string' || !biography.trim() || biography.length > 6000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(biography)) fail(400, 'Biography must be between 1 and 6000 characters.');
      const draft={ name: text(values.name, 'Name', 120), role: text(values.role, 'Role', 200), location: text(values.location, 'Location', 150), biography: biography.trim(), sourceNote: 'Biography supplied and reviewed by site leadership. This is not independent verification of credentials or regulatory status.' };
      db.prepare('UPDATE leadership SET draft=?,version=version+1 WHERE id=1').run(JSON.stringify(draft));
    }
    audit(db,actorId,publish ? 'leadership.publish' : 'leadership.save',1,publish ? { reviewed: true } : {});
    return leadership(db);
  });
}
