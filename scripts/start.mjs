/* Launch one competition instance:
     node scripts/start.mjs <competition-dir> [port]
   e.g.
     node scripts/start.mjs default 3000
     node scripts/start.mjs uspb-hackathon 3001
   Run one per competition (different ports) for parallel events. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [name, port = '3000'] = process.argv.slice(2);

if (!name) {
  const dataRoot = path.join(ROOT, 'data');
  const dirs = fs.existsSync(dataRoot)
    ? fs.readdirSync(dataRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && fs.existsSync(path.join(dataRoot, d.name, 'voting.db')))
        .map((d) => d.name)
    : [];
  console.error('Usage: node scripts/start.mjs <competition-dir> [port]');
  console.error(dirs.length ? `Available competitions: ${dirs.join(', ')}` : 'No competitions found — run: npm run seed');
  process.exit(1);
}

const dataDir = path.isAbsolute(name) || name.includes('/') ? name : path.join('data', name);
if (!fs.existsSync(path.join(ROOT, dataDir, 'voting.db'))) {
  console.error(`No database at ${dataDir}/voting.db — seed it first: npm run seed -- --config seed/<file>.json --dir ${name}`);
  process.exit(1);
}

spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  env: { ...process.env, DATA_DIR: dataDir, PORT: port },
  stdio: 'inherit',
  cwd: ROOT,
});
