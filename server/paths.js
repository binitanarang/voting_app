/* Filesystem layout helpers — no SQLite imports, so the seed script can
   inspect/relocate data directories before any database connection opens.

   Layout: one directory per competition under data/, e.g.
     data/default/          voting.db, session-secret, exports/
     data/uspb-hackathon/   voting.db, ...
   Select one with DATA_DIR (absolute, or relative to the repo root). */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_ROOT = path.join(ROOT, 'data');
export const DEFAULT_DATA_DIR = path.join(DATA_ROOT, 'default');

export function resolveDataDir(env = process.env.DATA_DIR) {
  if (!env) return DEFAULT_DATA_DIR;
  return path.isAbsolute(env) ? env : path.resolve(ROOT, env);
}

/* One-time move from the original flat layout (data/voting.db) into
   data/default/. Safe to call repeatedly. */
export function migrateLegacyLayout() {
  const legacy = path.join(DATA_ROOT, 'voting.db');
  if (!fs.existsSync(legacy) || fs.existsSync(path.join(DEFAULT_DATA_DIR, 'voting.db'))) return false;
  fs.mkdirSync(DEFAULT_DATA_DIR, { recursive: true });
  for (const f of ['voting.db', 'voting.db-wal', 'voting.db-shm', 'session-secret']) {
    const src = path.join(DATA_ROOT, f);
    if (fs.existsSync(src)) fs.renameSync(src, path.join(DEFAULT_DATA_DIR, f));
  }
  return true;
}

/* Competition dirs = subdirectories of data/ that contain a voting.db. */
export function listCompetitionDirs() {
  if (!fs.existsSync(DATA_ROOT)) return [];
  return fs
    .readdirSync(DATA_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(DATA_ROOT, d.name, 'voting.db')))
    .map((d) => d.name)
    .sort();
}
