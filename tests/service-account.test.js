import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { effectiveUser } from '../server/administration.js';

test('disabled internal identities cannot become authenticated users', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE staff_access(userId INTEGER PRIMARY KEY, role TEXT NOT NULL)');
    const service = {
      id: 42,
      email: 'internal-settlement@svbt.invalid',
      passwordHash: 'disabled:service-identity',
      role: 'customer',
    };
    assert.equal(effectiveUser(db, service), null);
    assert.equal(effectiveUser(db, { ...service, passwordHash: 'changed' }), null);
    assert.equal(effectiveUser(db, { ...service, email: 'another@example.invalid' }), null);
    assert.equal(effectiveUser(db, null), null);
    const normal = { id: 43, email: 'customer@example.test', passwordHash: 'hash', role: 'customer' };
    assert.equal(effectiveUser(db, normal).role, 'customer');
  } finally {
    db.close();
  }
});
