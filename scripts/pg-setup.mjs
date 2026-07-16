/* Creates the Postgres database and per-competition tables for voting_app.

   Usage:
     DATABASE_URL=postgres://user:pass@host:5432/voting_app npm run pg:setup -- [competition ...]

   - Creates the database named in the URL if it doesn't exist (connects to
     the server's maintenance db "postgres" for that step).
   - For each competition name (default: every data/seed/*.json), creates the
     schema and applies server/schema.pg.sql inside it.
   - Idempotent — everything is IF NOT EXISTS, safe to re-run on deploy.

   Without DATABASE_URL it targets postgres://localhost:5432/voting_app using
   libpq defaults (PGUSER etc.) for credentials.

   The server and seeder pick the same backend the same way: they use
   Postgres whenever DATABASE_URL is set, SQLite otherwise. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_SQL = fs.readFileSync(path.join(ROOT, 'server', 'schema.pg.sql'), 'utf8');
const DIR_NAME_RE = /^[a-z0-9][a-z0-9-]*$/; // mirrors server/paths.js

const die = (msg) => { console.error(msg); process.exit(1); };

const url = new URL(process.env.DATABASE_URL ?? 'postgres://localhost:5432/voting_app');
if (!/^postgres(ql)?:$/.test(url.protocol)) die(`DATABASE_URL must be a postgres:// URL, got ${url.protocol}//`);
const dbName = url.pathname.replace(/^\//, '') || 'voting_app';
if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) die(`Database name "${dbName}" — use lowercase letters, digits, underscores.`);

/* Which competitions get a schema: args, or every seed file. */
let competitions = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!competitions.length) {
  const seedDir = path.join(ROOT, 'data', 'seed');
  competitions = fs.existsSync(seedDir)
    ? fs.readdirSync(seedDir).filter((f) => f.endsWith('.json')).map((f) => path.basename(f, '.json'))
    : [];
}
for (const name of competitions) {
  if (!DIR_NAME_RE.test(name) || name === 'public') {
    die(`"${name}" is not a valid competition name (lowercase letters, digits, dashes; not "public").`);
  }
}

const clientConfig = (database) => ({
  host: url.hostname || undefined,
  port: url.port ? Number(url.port) : undefined,
  user: url.username ? decodeURIComponent(url.username) : undefined,
  password: url.password ? decodeURIComponent(url.password) : undefined,
  database,
});

/* 1. Create the database (from the maintenance db — CREATE DATABASE has no
   IF NOT EXISTS in Postgres). */
const admin = new pg.Client(clientConfig('postgres'));
await admin.connect().catch((err) => die(`Cannot reach Postgres at ${url.hostname || 'localhost'}:${url.port || 5432} — ${err.message}`));
const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
if (exists.rowCount) {
  console.log(`Database "${dbName}" already exists.`);
} else {
  await admin.query(`CREATE DATABASE "${dbName}"`);
  console.log(`Created database "${dbName}".`);
}
await admin.end();

/* 2. Create each competition's schema + tables. */
const client = new pg.Client(clientConfig(dbName));
await client.connect();
for (const name of competitions) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${name}"`);
  await client.query(`SET search_path TO "${name}"`);
  await client.query(SCHEMA_SQL);
  console.log(`Schema "${name}": tables ready.`);
}
await client.end();

if (!competitions.length) {
  console.log('No competitions given and no data/seed/*.json found — database created, no schemas.');
  console.log('Run again with names: npm run pg:setup -- <competition> [...]');
} else {
  console.log(`\nDone. Load data with:\n  DATABASE_URL=<url> npm run seed -- --config data/seed/<competition>.json --reset`);
  console.log('Start the server against Postgres with the same DATABASE_URL.');
}
