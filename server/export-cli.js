/* Manual archive of one competition:
     node server/export-cli.js <competition-dir> [reason]
   e.g. node server/export-cli.js ai-day-3 end-of-event
   Works on both backends: set DATABASE_URL to export from Postgres. */
import { getCompetition, closeDbPools } from './db.js';
import { exportSnapshot } from './export.js';

const [name, reason = 'manual'] = process.argv.slice(2);
const ctx = name ? await getCompetition(name) : null;
if (!ctx) {
  console.error('Usage: node server/export-cli.js <competition-dir> [reason]');
  process.exit(1);
}
console.log(JSON.stringify(await exportSnapshot(ctx, reason)));
await ctx.db.close();
await closeDbPools();
