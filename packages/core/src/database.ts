import Database from "better-sqlite3";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

export type AppDatabase = Database.Database;

export function resolveDatabasePath(value = process.env.DATABASE_PATH): string {
  return resolve(value || "./data/app.db");
}

export function openDatabase(path = resolveDatabasePath()): AppDatabase {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      original_path TEXT NOT NULL,
      thumbnail_path TEXT,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS asset_analyses (
      asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
      features_json TEXT NOT NULL,
      model_version TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      confidence REAL NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS group_assets (
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      selected INTEGER NOT NULL DEFAULT 1,
      duplicate_of_asset_id TEXT,
      duplicate_reason TEXT,
      PRIMARY KEY (group_id, asset_id)
    );
    CREATE TABLE IF NOT EXISTS group_contexts (
      group_id TEXT PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      context_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS post_proposals (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      caption TEXT NOT NULL,
      hashtags_json TEXT NOT NULL,
      alt_text_json TEXT NOT NULL,
      status TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      confidence REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      locked_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assets_batch ON assets(batch_id);
    CREATE INDEX IF NOT EXISTS idx_groups_batch ON groups(batch_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
  `);
  addColumnIfMissing(db, "group_assets", "selected", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing(db, "group_assets", "duplicate_of_asset_id", "TEXT");
  addColumnIfMissing(db, "group_assets", "duplicate_reason", "TEXT");
}

function addColumnIfMissing(db: AppDatabase, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
