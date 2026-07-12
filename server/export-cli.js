/* Manual archive of one competition:
     node server/export-cli.js <competition-dir> [reason]
   e.g. node server/export-cli.js ai-day-3 end-of-event */
import fs from 'node:fs';
import path from 'node:path';
import { competitionDir } from './paths.js';
import { openCompetition } from './db.js';
import { exportSnapshot } from './export.js';

const [name, reason = 'manual'] = process.argv.slice(2);
if (!name || !fs.existsSync(path.join(competitionDir(name), 'voting.db'))) {
  console.error('Usage: node server/export-cli.js <competition-dir> [reason]');
  process.exit(1);
}
const ctx = openCompetition(name);
console.log(JSON.stringify(exportSnapshot(ctx, reason)));
ctx.db.close();
