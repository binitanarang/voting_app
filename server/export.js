/* Writes a point-in-time archive of the competition into <DATA_DIR>/exports/:
   the full results CSV (leaderboard + raw score matrix) and a checkpointed
   copy of the SQLite database. Called automatically when voting is locked,
   before a reseed wipe (via export-cli.js), or manually. */
import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR, DB_PATH, loadCompetition } from './db.js';
import { computeResults, resultsToCsv } from './compute.js';

export function exportSnapshot(reason = 'manual') {
  const dir = path.join(DATA_DIR, 'exports');
  fs.mkdirSync(dir, { recursive: true });
  const slug = String(reason).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'manual';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const data = loadCompetition();
  const csvName = `results-${slug}-${stamp}.csv`;
  fs.writeFileSync(path.join(dir, csvName), resultsToCsv(computeResults(data), data.criteria));

  // Fold the WAL into the main file so the copy is a complete database.
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  const dbName = `snapshot-${slug}-${stamp}.db`;
  fs.copyFileSync(DB_PATH, path.join(dir, dbName));

  return { dir, files: [csvName, dbName] };
}
