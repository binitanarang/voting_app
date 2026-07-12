/* Filesystem layout helpers — no SQLite imports, so scripts can inspect
   data directories before any database connection opens.

   Layout: one directory per competition under data/, named exactly like the
   competition's URL path:
     data/ai-day-3/         →  http://host:3000/ai-day-3
     data/uspb-hackathon/   →  http://host:3000/uspb-hackathon
   Each contains voting.db, session-secret, and exports/. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_ROOT = path.join(ROOT, 'data');

/* Directory name == URL path segment, so it must be URL-safe. */
export const DIR_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function competitionDir(name) {
  return path.join(DATA_ROOT, name);
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
