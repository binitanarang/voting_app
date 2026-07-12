/* Per-competition database contexts.

   openCompetition(name) creates/opens data/<name>/ and returns a context
   object (db connection + helpers) that request handlers receive as req.ctx.
   getCompetition(name) is the lazy, cached, request-path entry point — it
   refuses names without an existing database and transparently reopens a
   competition whose database file was replaced by a reseed. */
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_ROOT, DIR_NAME_RE, competitionDir, listCompetitionDirs } from './paths.js';

export { ROOT } from './paths.js';

const SCHEMA = `
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
`;

export function openCompetition(name, dataDir = competitionDir(name)) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'voting.db');
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);

  const secretPath = path.join(dataDir, 'session-secret');
  if (!fs.existsSync(secretPath)) {
    fs.writeFileSync(secretPath, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  const secret = fs.readFileSync(secretPath, 'utf8').trim();

  const getSetting = (key, fallback = null) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  };

  return {
    name,
    dataDir,
    dbPath,
    db,
    secret,
    getSetting,
    setSetting(key, value) {
      db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run(key, String(value));
    },
    votingLocked(categoryId) {
      if (getSetting('voting_locked', '0') === '1') return true;
      const cat = db.prepare('SELECT voting_locked FROM categories WHERE id = ?').get(categoryId);
      return !!(cat && cat.voting_locked);
    },
    /* Everything compute.js needs, in one snapshot. */
    loadCompetition() {
      return {
        categories: db.prepare('SELECT * FROM categories ORDER BY position').all(),
        criteria: db.prepare('SELECT * FROM criteria ORDER BY position').all(),
        weights: db.prepare('SELECT * FROM category_weights').all(),
        panels: db.prepare('SELECT * FROM panels').all(),
        judges: db.prepare('SELECT id, employee_id, name, panel_id, role FROM judges').all(),
        entries: db.prepare('SELECT * FROM entries ORDER BY position').all(),
        scores: db.prepare('SELECT judge_id, entry_id, criterion_id, score FROM scores').all(),
      };
    },
  };
}

/* ---------- Request-path registry ---------- */

const cache = new Map(); // name -> { ctx, ino }

export function getCompetition(name) {
  if (!DIR_NAME_RE.test(name)) return null;
  const dbPath = path.join(DATA_ROOT, name, 'voting.db');
  if (!fs.existsSync(dbPath)) {
    cache.delete(name);
    return null;
  }
  // A reseed replaces the db file; a changed inode means our handle is stale.
  const ino = fs.statSync(dbPath).ino;
  const hit = cache.get(name);
  if (hit && hit.ino === ino) return hit.ctx;
  if (hit) {
    try { hit.ctx.db.close(); } catch { /* already closed */ }
  }
  const ctx = openCompetition(name);
  cache.set(name, { ctx, ino });
  return ctx;
}

export function listCompetitions() {
  return listCompetitionDirs().map((dir) => ({
    dir,
    name: getCompetition(dir)?.getSetting('competition_name', dir) ?? dir,
  }));
}
