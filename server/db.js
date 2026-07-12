import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const DB_PATH = path.join(DATA_DIR, 'voting.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    voting_locked INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS criteria (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    position INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS category_weights (
    category_id INTEGER NOT NULL REFERENCES categories(id),
    criterion_id INTEGER NOT NULL REFERENCES criteria(id),
    weight REAL NOT NULL CHECK (weight >= 0),
    PRIMARY KEY (category_id, criterion_id)
  );

  CREATE TABLE IF NOT EXISTS panels (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS judges (
    id INTEGER PRIMARY KEY,
    employee_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    panel_id INTEGER REFERENCES panels(id),
    role TEXT NOT NULL DEFAULT 'judge' CHECK (role IN ('judge','admin'))
  );

  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scores (
    judge_id INTEGER NOT NULL REFERENCES judges(id),
    entry_id INTEGER NOT NULL REFERENCES entries(id),
    criterion_id INTEGER NOT NULL REFERENCES criteria(id),
    score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (judge_id, entry_id, criterion_id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    employee_id TEXT NOT NULL,
    attempted_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts (employee_id, attempted_at);
`);

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

export function votingLocked(categoryId) {
  if (getSetting('voting_locked', '0') === '1') return true;
  const cat = db.prepare('SELECT voting_locked FROM categories WHERE id = ?').get(categoryId);
  return !!(cat && cat.voting_locked);
}

/* Everything compute.js needs, in one snapshot. */
export function loadCompetition() {
  return {
    categories: db.prepare('SELECT * FROM categories ORDER BY position').all(),
    criteria: db.prepare('SELECT * FROM criteria ORDER BY position').all(),
    weights: db.prepare('SELECT * FROM category_weights').all(),
    panels: db.prepare('SELECT * FROM panels').all(),
    judges: db.prepare('SELECT id, employee_id, name, panel_id, role FROM judges').all(),
    entries: db.prepare('SELECT * FROM entries ORDER BY position').all(),
    scores: db.prepare('SELECT judge_id, entry_id, criterion_id, score FROM scores').all(),
  };
}
