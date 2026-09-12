import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import * as schema from './schema.js';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export type Db = BetterSQLite3Database<typeof schema>;

export interface OpenDatabase {
    db: Db;
    sqlite: Database.Database;
    close(): void;
}

export function openDatabase(file: string): OpenDatabase {
    const sqlite = new Database(file);
    if (file !== ':memory:') sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle({ client: sqlite, schema });
    migrate(db, { migrationsFolder });
    return { db, sqlite, close: () => sqlite.close() };
}
