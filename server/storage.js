import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const databasePath = () => resolve(process.env.DB_PATH || resolve(root, 'data/bank.sqlite'));

// Used only by executable production entry points, before opening or migrating a database.
export function assertProductionPaths() {
  if (process.env.NODE_ENV !== 'production') return;
  if (!process.env.DB_PATH || !isAbsolute(process.env.DB_PATH)) throw new Error('Production DB_PATH must be explicit and absolute.');
  if (!process.env.STATEMENT_DIR || !isAbsolute(process.env.STATEMENT_DIR)) throw new Error('Production STATEMENT_DIR must be explicit and absolute.');
}
export function assertProductionStorage() {
  assertProductionPaths();
  if (process.env.NODE_ENV !== 'production') return;
  if (!existsSync(databasePath())) throw new Error('Production database is missing. Restore an approved backup or provision a reviewed database before startup.');
}
