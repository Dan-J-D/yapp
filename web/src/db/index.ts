import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';
import { config } from '../lib/server/config';

export type DB = BetterSQLite3Database<typeof schema>;

const g = globalThis as unknown as { __yappDb?: DB; __yappSqlite?: Database.Database };

function open(): DB {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  fs.mkdirSync(config.audioDir, { recursive: true });
  const sqlite = new Database(config.dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: config.migrationsDir });
  g.__yappSqlite = sqlite;
  return db;
}

export const db: DB = (g.__yappDb ??= open());
export const sqlite = () => g.__yappSqlite!;
export { schema };
