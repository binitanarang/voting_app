/* Per-competition database contexts, on one of two backends:

   - SQLite (default): one data/<name>/voting.db file per competition via
     node:sqlite. Zero setup — what local dev uses.
   - Postgres (when DATABASE_URL is set): one Postgres schema per competition
     in a shared database via pgdb.js — for deployments without a persistent
     filesystem (the AWS container).

   Both expose the identical async context object that request handlers
   receive as req.ctx: db.prepare(sql).get/all/run + exec/close (all async,
   SQLite's sync calls are wrapped), plus the helper methods built in
   makeContext(). openCompetition(name) creates/opens a competition;
   getCompetition(name) is the lazy, cached, request-path entry point — it
   refuses names that don't already have a database. */
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_ROOT, DIR_NAME_RE, competitionDir, listCompetitionDirs } from './paths.js';
import * as pgdb from './pgdb.js';

export { ROOT } from './paths.js';

export const DB_DRIVER = process.env.DATABASE_URL ? 'postgres' : 'sqlite';

/* SQLite DDL. schema.pg.sql is the Postgres translation — keep in lockstep. */
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
    team TEXT NOT NULL DEFAULT '',
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

/* Same async surface as pgdb.makeDb(), over the synchronous node:sqlite. */
function wrapSqliteDb(raw) {
  return {
    prepare(sql) {
      const stmt = raw.prepare(sql);
      return {
        async get(...params) {
          return stmt.get(...params);
        },
        async all(...params) {
          return stmt.all(...params);
        },
        async run(...params) {
          const r = stmt.run(...params);
          return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
        },
      };
    },
    async exec(sql) {
      raw.exec(sql);
    },
    async close() {
      raw.close();
    },
  };
}

/* Helper methods shared by both backends. */
function makeContext({ name, dataDir, dbPath, db, secret, driver }) {
  const getSetting = async (key, fallback = null) => {
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  };

  return {
    name,
    dataDir,
    dbPath, // null on postgres — export.js copies the db file only when set
    db,
    secret,
    driver,
    getSetting,
    async setSetting(key, value) {
      await db
        .prepare(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        )
        .run(key, String(value));
    },
    async votingLocked(categoryId) {
      if ((await getSetting('voting_locked', '0')) === '1') return true;
      const cat = await db.prepare('SELECT voting_locked FROM categories WHERE id = ?').get(categoryId);
      return !!(cat && cat.voting_locked);
    },
    /* Everything compute.js needs, in one snapshot. */
    async loadCompetition() {
      const [categories, criteria, weights, panels, judges, entries, scores] = await Promise.all([
        db.prepare('SELECT * FROM categories ORDER BY position').all(),
        db.prepare('SELECT * FROM criteria ORDER BY position').all(),
        db.prepare('SELECT * FROM category_weights').all(),
        db.prepare('SELECT * FROM panels').all(),
        db.prepare('SELECT id, employee_id, name, panel_id, role FROM judges').all(),
        db.prepare('SELECT * FROM entries ORDER BY position').all(),
        db.prepare('SELECT judge_id, entry_id, criterion_id, score FROM scores').all(),
      ]);
      return { categories, criteria, weights, panels, judges, entries, scores };
    },
  };
}

export async function openCompetition(name, dataDir = competitionDir(name)) {
  if (DB_DRIVER === 'postgres') {
    const { db, secret } = await pgdb.openSchema(name);
    return makeContext({ name, dataDir, dbPath: null, db, secret, driver: 'postgres' });
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'voting.db');
  const raw = new DatabaseSync(dbPath);
  raw.exec(SCHEMA);

  // Databases created before the team column existed get it added in place
  // (CREATE TABLE IF NOT EXISTS never alters an existing table).
  const entryColumns = raw.prepare('PRAGMA table_info(entries)').all();
  if (!entryColumns.some((c) => c.name === 'team')) {
    raw.exec(`ALTER TABLE entries ADD COLUMN team TEXT NOT NULL DEFAULT ''`);
  }

  const secretPath = path.join(dataDir, 'session-secret');
  if (!fs.existsSync(secretPath)) {
    fs.writeFileSync(secretPath, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  const secret = fs.readFileSync(secretPath, 'utf8').trim();

  return makeContext({ name, dataDir, dbPath, db: wrapSqliteDb(raw), secret, driver: 'sqlite' });
}

/* Does this competition already have a database (file or schema)? */
export async function competitionExists(name) {
  if (!DIR_NAME_RE.test(name)) return false;
  if (DB_DRIVER === 'postgres') return pgdb.schemaReady(name);
  return fs.existsSync(path.join(competitionDir(name), 'voting.db'));
}

/* Seed-time reset. SQLite keeps session-secret and exports/, removing only
   the db files; Postgres drops the whole schema (the secret regenerates on
   the next open). */
export async function wipeCompetition(name) {
  if (DB_DRIVER === 'postgres') {
    cache.delete(name);
    await pgdb.dropSchema(name);
    return;
  }
  const dbPath = path.join(competitionDir(name), 'voting.db');
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
}

/* Scripts must call this before exiting — open Postgres pools otherwise keep
   the process alive. No-op on SQLite. */
export async function closeDbPools() {
  if (DB_DRIVER === 'postgres') await pgdb.endAll();
}

/* ---------- Request-path registry ---------- */

const cache = new Map(); // name -> { ctx, ino } (ino is sqlite-only)

export async function getCompetition(name) {
  if (!DIR_NAME_RE.test(name)) return null;

  if (DB_DRIVER === 'postgres') {
    const hit = cache.get(name);
    if (hit) return hit.ctx;
    if (!(await pgdb.schemaReady(name))) return null;
    const ctx = await openCompetition(name);
    cache.set(name, { ctx });
    return ctx;
  }

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
    try {
      await hit.ctx.db.close();
    } catch {
      /* already closed */
    }
  }
  const ctx = await openCompetition(name);
  cache.set(name, { ctx, ino });
  return ctx;
}

export async function listCompetitions() {
  const dirs = DB_DRIVER === 'postgres' ? await pgdb.listSchemas() : listCompetitionDirs();
  const out = [];
  for (const dir of dirs) {
    const ctx = await getCompetition(dir);
    out.push({ dir, name: (await ctx?.getSetting('competition_name', dir)) ?? dir });
  }
  return out;
}
