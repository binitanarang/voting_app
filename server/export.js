/* Writes a point-in-time archive of one competition into its
   <dataDir>/exports/: the full results CSV (leaderboard + raw score matrix)
   and — on SQLite — a checkpointed copy of the database file. Called
   automatically when voting is locked, before a reseed wipe, or manually via
   export-cli.js. On Postgres only the CSV is written (there is no database
   file to copy; the data lives in the shared Postgres server). */
import fs from 'node:fs';
import path from 'node:path';
import { computeResults, resultsToCsv } from './compute.js';

export async function exportSnapshot(ctx, reason = 'manual') {
  const dir = path.join(ctx.dataDir, 'exports');
  fs.mkdirSync(dir, { recursive: true });
  const slug = String(reason).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'manual';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const data = await ctx.loadCompetition();
  const csvName = `results-${slug}-${stamp}.csv`;
  fs.writeFileSync(path.join(dir, csvName), resultsToCsv(computeResults(data), data.criteria));

  const files = [csvName];
  if (ctx.dbPath) {
    // Fold the WAL into the main file so the copy is a complete database.
    await ctx.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    const dbName = `snapshot-${slug}-${stamp}.db`;
    fs.copyFileSync(ctx.dbPath, path.join(dir, dbName));
    files.push(dbName);
  }

  return { dir, files };
}
