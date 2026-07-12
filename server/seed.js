/* Seeds a competition into its own data directory. The directory name is
   also the competition's URL path: data/ai-day-3 → http://host:3000/ai-day-3

   Interactive (just run `npm run seed`): pick a seed config from seed/*.json,
   then pick an existing competition directory to wipe-and-reseed (confirmed by
   retyping its name; a safety export is taken first) or name a new one.

   Scriptable flags:
     --config seed/uspb-hackathon.json   which seed file to load
     --dir uspb-hackathon                target data/<name>
     --reset                             allow wiping an existing database
*/
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { ROOT, DIR_NAME_RE, competitionDir, listCompetitionDirs } from './paths.js';
import { openCompetition } from './db.js';
import { exportSnapshot } from './export.js';
import { hashPin } from './auth.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : (args[i + 1]?.startsWith('--') ? true : args[i + 1] ?? true);
};
const reset = args.includes('--reset');
const interactive = process.stdin.isTTY && process.stdout.isTTY;
const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;

const die = (msg) => { console.error(msg); process.exit(1); };

/* ---------- 1. Which seed config ---------- */

let configPath = flag('config');
if (configPath === true) die('--config needs a file path');
if (!configPath) {
  const seedDir = path.join(ROOT, 'seed');
  const options = fs.readdirSync(seedDir).filter((f) => f.endsWith('.json')).sort();
  if (!options.length) die('No .json files in seed/.');
  if (options.length === 1 || !rl) {
    configPath = path.join('seed', options[0]);
  } else {
    console.log('Seed configs:');
    options.forEach((f, i) => console.log(`  [${i + 1}] seed/${f}`));
    const pick = await rl.question(`Which config? [1-${options.length}, default 1] `);
    const n = pick.trim() === '' ? 1 : Number(pick);
    if (!Number.isInteger(n) || n < 1 || n > options.length) die('Invalid choice.');
    configPath = path.join('seed', options[n - 1]);
  }
}
const configAbs = path.isAbsolute(configPath) ? configPath : path.join(ROOT, configPath);
if (!fs.existsSync(configAbs)) die(`Seed config not found: ${configPath}`);
const config = JSON.parse(fs.readFileSync(configAbs, 'utf8'));
const competitionName = config.name ?? path.basename(configAbs, '.json');
console.log(`Competition: "${competitionName}" (${path.relative(ROOT, configAbs)})`);

/* ---------- 2. Which data directory (= URL path) ---------- */

let dirName = flag('dir');
if (dirName === true) die('--dir needs a directory name');
const existing = listCompetitionDirs();

if (!dirName) {
  if (!rl) die('Non-interactive run: pass --dir <name> (and --reset to wipe an existing one).');
  console.log('\nWhere should this competition live? (directory name = URL path)');
  existing.forEach((d, i) =>
    console.log(`  [${i + 1}] data/${d} → /${d}  (EXISTS — reseeding WIPES its scores; a safety export is taken first)`));
  console.log(`  [${existing.length + 1}] Create a new competition directory`);
  const pick = await rl.question(`Choose [1-${existing.length + 1}] `);
  const n = Number(pick);
  if (!Number.isInteger(n) || n < 1 || n > existing.length + 1) die('Invalid choice.');
  if (n <= existing.length) {
    dirName = existing[n - 1];
  } else {
    dirName = (await rl.question('New directory name (lowercase, e.g. uspb-hackathon): ')).trim();
  }
}
if (!DIR_NAME_RE.test(dirName)) {
  die(`"${dirName}" is not a valid name — it becomes the URL path, so use lowercase letters, digits, and dashes (e.g. ai-day-3).`);
}

const dataDir = competitionDir(dirName);
const dbPath = path.join(dataDir, 'voting.db');
const dirLabel = path.relative(ROOT, dataDir);

/* ---------- 3. Wipe confirmation + safety export ---------- */

if (fs.existsSync(dbPath)) {
  if (!reset && !rl) {
    die(`${dirLabel} already has a database. Re-run with --reset to wipe it (deletes all scores!).`);
  }
  if (!reset) {
    const typed = await rl.question(
      `${dirLabel} already has a database. Wiping deletes ALL its scores.\nType the directory name ("${dirName}") to confirm: `
    );
    if (typed.trim() !== dirName) die('Confirmation did not match — nothing was changed.');
  }

  try {
    const oldCtx = openCompetition(dirName);
    const { files } = exportSnapshot(oldCtx, 'pre-reseed');
    oldCtx.db.close();
    console.log(`Safety export saved to ${dirLabel}/exports/: ${files.join(', ')}`);
  } catch (err) {
    console.warn(`Warning: safety export failed (${err.message}) — continuing with wipe.`);
  }

  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  console.log('Existing database removed (session-secret and exports/ kept).');
}

rl?.close();

/* ---------- 4. Validate config ---------- */

const { criteria, categories, judges, admins = [] } = config;
if (!criteria?.length || !categories?.length || !judges?.length) {
  die('Seed config needs criteria, categories, and judges.');
}
for (const cat of categories) {
  if (cat.weights.length !== criteria.length) {
    die(`Category "${cat.name}": expected ${criteria.length} weights, got ${cat.weights.length}.`);
  }
  const sum = cat.weights.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.01) die(`Category "${cat.name}": weights sum to ${sum}, expected 100.`);
}
const pinProblems = [...judges, ...admins].filter((j) => !/^\d{4}$/.test(String(j.pin)));
if (pinProblems.length) die(`PINs must be exactly 4 digits: ${pinProblems.map((j) => j.employeeId).join(', ')}`);

/* ---------- 5. Load ---------- */

const ctx = openCompetition(dirName);
const { db } = ctx;

ctx.setSetting('competition_name', competitionName);

const criterionIds = criteria.map((name, i) => {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO criteria (name, position) VALUES (?, ?)')
    .run(name, i + 1);
  return Number(lastInsertRowid);
});

const panelIdByName = {};
categories.forEach((cat, i) => {
  const { lastInsertRowid: catId } = db
    .prepare('INSERT INTO categories (name, position) VALUES (?, ?)')
    .run(cat.name, i + 1);
  const { lastInsertRowid: panelId } = db
    .prepare('INSERT INTO panels (name, category_id) VALUES (?, ?)')
    .run(cat.panel, Number(catId));
  panelIdByName[cat.panel] = Number(panelId);

  cat.weights.forEach((pct, wi) => {
    db.prepare('INSERT INTO category_weights (category_id, criterion_id, weight) VALUES (?, ?, ?)')
      .run(Number(catId), criterionIds[wi], pct / 100);
  });
  cat.entries.forEach((e, ei) => {
    db.prepare('INSERT INTO entries (category_id, name, description, position) VALUES (?, ?, ?, ?)')
      .run(Number(catId), e.name, e.description ?? '', ei + 1);
  });
});

const insertJudge = db.prepare(
  'INSERT INTO judges (employee_id, name, pin_hash, panel_id, role) VALUES (?, ?, ?, ?, ?)'
);
for (const j of judges) {
  const panelId = panelIdByName[j.panel];
  if (!panelId) die(`Judge ${j.employeeId}: unknown panel "${j.panel}".`);
  insertJudge.run(j.employeeId, j.name, hashPin(String(j.pin)), panelId, 'judge');
}
for (const a of admins) {
  insertJudge.run(a.employeeId, a.name, hashPin(String(a.pin)), null, 'admin');
}

console.log(`\nSeeded "${competitionName}" into ${dirLabel}:`, JSON.stringify({
  categories: categories.length,
  criteria: criteria.length,
  entries: categories.reduce((n, c) => n + c.entries.length, 0),
  judges: judges.length,
  admins: admins.length,
}));
console.log(`\nLive at: http://localhost:3000/${dirName}  (npm start serves every competition)`);
