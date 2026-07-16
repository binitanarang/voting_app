/* Postgres backend, active when DATABASE_URL is set (see db.js).

   One competition = one Postgres schema in the shared database, mirroring
   the SQLite one-directory-per-competition layout. Each schema gets its own
   small pool whose connections pin search_path to that schema, so every
   query in the app can keep using unqualified table names.

   makeDb() returns an object with the same shape as the SQLite wrapper in
   db.js — prepare(sql).get/all/run and exec/close, all async — translating
   SQLite's `?` placeholders to Postgres's $1..$n on the way through. */
import pg from 'pg';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR_NAME_RE } from './paths.js';

/* COUNT(*)/MAX() arrive as BIGINT, which node-postgres returns as strings;
   parse to Number so arithmetic like `panelCount + 1` doesn't concatenate.
   Nothing this app counts approaches 2^53. */
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export const SCHEMA_SQL = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.pg.sql'),
  'utf8'
);

/* Competition names become schema identifiers, so hold them to the same rule
   as directory names, minus names Postgres already owns. */
function assertSchemaName(name) {
  if (!DIR_NAME_RE.test(name) || name === 'public') {
    throw new Error(`Invalid competition schema name: ${name}`);
  }
}

/* schema -> Pool with search_path pinned; '' -> base pool for admin queries
   (schema existence, create/drop) that must not be schema-scoped. */
const pools = new Map();

function poolFor(schema = '') {
  let p = pools.get(schema);
  if (!p) {
    if (schema) assertSchemaName(schema);
    p = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: schema ? 5 : 2,
      ...(schema ? { options: `-c search_path="${schema}"` } : {}),
    });
    // An idle client losing its connection emits 'error' on the pool; without
    // a listener that takes down the whole process.
    p.on('error', (err) => console.error(`pg pool error (${schema || 'base'}): ${err.message}`));
    pools.set(schema, p);
  }
  return p;
}

const qmarkToDollar = (sql) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

/* SQLite hands back lastInsertRowid on every INSERT; Postgres needs an
   explicit RETURNING. These are the tables with a generated id whose call
   sites actually read it. */
const ID_INSERT_RE = /^\s*INSERT\s+INTO\s+(categories|criteria|panels|judges|entries)\b/i;

export function makeDb(schema) {
  const q = (sql, params = []) => poolFor(schema).query(qmarkToDollar(sql), params);
  return {
    prepare(sql) {
      return {
        async get(...params) {
          return (await q(sql, params)).rows[0];
        },
        async all(...params) {
          return (await q(sql, params)).rows;
        },
        async run(...params) {
          const withId = ID_INSERT_RE.test(sql) && !/\bRETURNING\b/i.test(sql);
          const r = await q(withId ? `${sql} RETURNING id` : sql, params);
          return { changes: r.rowCount ?? 0, lastInsertRowid: withId ? r.rows[0]?.id : undefined };
        },
      };
    },
    async exec(sql) {
      await poolFor(schema).query(sql);
    },
    async close() {
      const p = pools.get(schema);
      if (p) {
        pools.delete(schema);
        await p.end();
      }
    },
  };
}

/* Create-or-open: schema + tables (all IF NOT EXISTS), plus the session
   secret, which lives in settings here — Postgres deployments are exactly
   the ones without a persistent disk for a session-secret file. */
export async function openSchema(name) {
  assertSchemaName(name);
  await poolFor().query(`CREATE SCHEMA IF NOT EXISTS "${name}"`);
  const db = makeDb(name);
  await db.exec(SCHEMA_SQL);

  let row = await db.prepare('SELECT value FROM settings WHERE key = ?').get('session_secret');
  if (!row) {
    // ON CONFLICT DO NOTHING + re-read keeps concurrent first opens agreeing.
    await db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING')
      .run('session_secret', crypto.randomBytes(32).toString('hex'));
    row = await db.prepare('SELECT value FROM settings WHERE key = ?').get('session_secret');
  }
  return { db, secret: row.value };
}

/* A competition exists once its schema has been set up with tables. */
export async function schemaReady(name) {
  const r = await poolFor().query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'settings'`,
    [name]
  );
  return r.rowCount > 0;
}

export async function listSchemas() {
  const r = await poolFor().query(
    `SELECT table_schema AS name FROM information_schema.tables WHERE table_name = 'settings' ORDER BY 1`
  );
  return r.rows.map((x) => x.name).filter((n) => DIR_NAME_RE.test(n) && n !== 'public');
}

export async function dropSchema(name) {
  assertSchemaName(name);
  const p = pools.get(name);
  if (p) {
    pools.delete(name);
    await p.end();
  }
  await poolFor().query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
}

/* Scripts (seed, export-cli) must end every pool or the process never exits. */
export async function endAll() {
  const open = [...pools.values()];
  pools.clear();
  await Promise.all(open.map((p) => p.end()));
}
