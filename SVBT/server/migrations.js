// Versioned schema changes. The CREATE TABLE IF NOT EXISTS statements in db.js and the
// initialize* functions describe the original schema; editing them does not change a database
// that already exists. Every later change to tables, columns, indexes or triggers goes here as a
// new entry with the next version number, and is never edited after it has been deployed.
// The applied version is kept in SQLite's PRAGMA user_version.
export const migrations = [
  { version: 1, name: 'baseline', up() {} },
  {
    version: 2,
    name: 'ledger-value-guards',
    up(db) {
      // The API already validates these; the triggers stop any other writer (a script, a shell
      // session, a future code path) from recording an entry the statement logic cannot read.
      db.exec(`CREATE TRIGGER IF NOT EXISTS valid_transaction_date BEFORE INSERT ON transactions
          WHEN typeof(NEW.date)!='text' OR NEW.date IS NOT date(NEW.date) OR NEW.date<'1900-01-01'
          BEGIN SELECT RAISE(ABORT,'Invalid ledger date'); END;
        CREATE TRIGGER IF NOT EXISTS valid_statement_closing BEFORE INSERT ON statements
          WHEN typeof(NEW.closing)!='integer'
          BEGIN SELECT RAISE(ABORT,'Statement closing balance must be integer cents'); END;`);
      const invalid = db.prepare("SELECT count(*) n FROM transactions WHERE typeof(date)!='text' OR date IS NOT date(date) OR date<'1900-01-01'").get().n;
      if (invalid) console.warn(`Ledger check: ${invalid} existing transaction(s) have an invalid date. They were left unchanged.`);
    }
  },
  {
    version: 3,
    name: 'session-expiry-and-ledger-requests',
    up(db) {
      // Sessions slide on activity (idle timeout) but never past absoluteExpiresAt. Databases that
      // ran the sessions change before migrations existed already have the column and the table.
      if (!db.prepare("SELECT 1 FROM pragma_table_info('sessions') WHERE name='absoluteExpiresAt'").get()) db.exec('ALTER TABLE sessions ADD COLUMN absoluteExpiresAt INTEGER');
      db.exec('CREATE TABLE IF NOT EXISTS ledger_requests(requestId TEXT PRIMARY KEY, actorId INTEGER NOT NULL REFERENCES users(id), accountId INTEGER NOT NULL REFERENCES accounts(id), requestHash TEXT NOT NULL, transactionId INTEGER NOT NULL REFERENCES transactions(id))');
    }
  },
  {
    version: 4,
    name: 'demo-accounts-and-imports',
    up(db) {
      // Demo accounts hold demonstration figures; their statement PDFs are always stamped as samples.
      db.exec(`ALTER TABLE accounts ADD COLUMN demo INTEGER NOT NULL DEFAULT 0 CHECK(demo IN (0,1));
        CREATE TABLE imports(id INTEGER PRIMARY KEY, accountId INTEGER NOT NULL REFERENCES accounts(id), actorId INTEGER NOT NULL REFERENCES users(id), fileHash TEXT NOT NULL, rowCount INTEGER NOT NULL, firstTransactionId INTEGER NOT NULL REFERENCES transactions(id), lastTransactionId INTEGER NOT NULL REFERENCES transactions(id), closing INTEGER NOT NULL, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(accountId,fileHash));
        CREATE TRIGGER immutable_imports_update BEFORE UPDATE ON imports BEGIN SELECT RAISE(ABORT,'Immutable imports'); END;
        CREATE TRIGGER immutable_imports_delete BEFORE DELETE ON imports BEGIN SELECT RAISE(ABORT,'Immutable imports'); END;
        CREATE TRIGGER demo_stays_on_after_import BEFORE UPDATE OF demo ON accounts WHEN NEW.demo=0 AND EXISTS(SELECT 1 FROM imports WHERE accountId=NEW.id) BEGIN SELECT RAISE(ABORT,'Account holds imported demonstration data'); END;`);
    }
  },
  {
    version: 5,
    name: 'customer-transfers',
    up(db) {
      // PIN failures and locks live in the database so they survive a restart.
      db.exec(`CREATE TABLE transfer_pins(userId INTEGER PRIMARY KEY REFERENCES users(id), pinHash TEXT NOT NULL, failedCount INTEGER NOT NULL DEFAULT 0, lockedUntil INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE transfers(id INTEGER PRIMARY KEY, fromAccountId INTEGER NOT NULL REFERENCES accounts(id), toAccountId INTEGER NOT NULL REFERENCES accounts(id),
          amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0 AND amount<=100000000000), description TEXT NOT NULL, date TEXT NOT NULL,
          debitId INTEGER NOT NULL UNIQUE REFERENCES transactions(id), creditId INTEGER NOT NULL UNIQUE REFERENCES transactions(id),
          requestId TEXT NOT NULL UNIQUE, requestHash TEXT NOT NULL, actorId INTEGER NOT NULL REFERENCES users(id),
          createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), CHECK(fromAccountId!=toAccountId));
        CREATE INDEX transfers_from_date ON transfers(fromAccountId,date);
        CREATE INDEX transfers_to ON transfers(toAccountId);
        CREATE TRIGGER valid_transfer BEFORE INSERT ON transfers WHEN
          NOT EXISTS(SELECT 1 FROM transactions WHERE id=NEW.debitId AND accountId=NEW.fromAccountId AND amount=-NEW.amount AND date=NEW.date)
          OR NOT EXISTS(SELECT 1 FROM transactions WHERE id=NEW.creditId AND accountId=NEW.toAccountId AND amount=NEW.amount AND date=NEW.date)
          BEGIN SELECT RAISE(ABORT,'Transfer entries do not match'); END;
        CREATE TRIGGER immutable_transfers_update BEFORE UPDATE ON transfers BEGIN SELECT RAISE(ABORT,'Immutable transfers'); END;
        CREATE TRIGGER immutable_transfers_delete BEFORE DELETE ON transfers BEGIN SELECT RAISE(ABORT,'Immutable transfers'); END;`);
    }
  },
  {
    version: 6,
    name: 'password-resets',
    up(db) {
      db.exec(`CREATE TABLE password_resets(tokenHash TEXT PRIMARY KEY, userId INTEGER NOT NULL REFERENCES users(id), expiresAt INTEGER NOT NULL);
        CREATE INDEX password_resets_user ON password_resets(userId);`);
    }
  }
];

export const schemaVersion = migrations.at(-1).version;

export function migrate(db, list = migrations) {
  const latest = list.at(-1).version;
  const applied = () => db.prepare('PRAGMA user_version').get().user_version;
  if (applied() > latest) {
    console.warn(`Database schema version ${applied()} is newer than this code (${latest}). No migrations were run.`);
    return applied();
  }
  for (const migration of list) {
    if (migration.version <= applied()) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      // Another process may have applied it while this one waited for the write lock.
      if (migration.version > applied()) {
        migration.up(db);
        db.exec(`PRAGMA user_version=${Number(migration.version)}`);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Schema migration ${migration.version} (${migration.name}) failed: ${error.message}`, { cause: error });
    }
  }
  return applied();
}
