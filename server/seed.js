/* Seeds a competition from data/seed/<competition>.json into
   data/<competition>/ (SQLite, the default) or into the Postgres schema
   "<competition>" (when DATABASE_URL is set) — the seed file's name IS the
   competition's directory/schema and URL path
   (data/seed/ai-day-3.json → data/ai-day-3 → /ai-day-3).

   Interactive (just run `npm run seed`): pick a seed file; if that
   competition already exists you confirm the wipe by retyping its name, and
   a safety export is taken first.

   Scriptable flags:
     --config data/seed/uspb-hackathon.json   which seed file to load
     --reset                                  allow wiping an existing database

   PINs: each judge/admin may set a "pin"; when omitted, the PIN defaults to
   the person's employee ID. */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { ROOT, SEED_DIR, DIR_NAME_RE, competitionDir } from './paths.js';
import { DB_DRIVER, openCompetition, competitionExists, wipeCompetition, closeDbPools } from './db.js';
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

/* ---------- 1. Which seed file (its name = the competition directory) ---------- */

let configPath = flag('config');
if (configPath === true) die('--config needs a file path');
if (!configPath) {
  if (!fs.existsSync(SEED_DIR)) die(`No seed directory yet — create ${path.relative(ROOT, SEED_DIR)}/<competition>.json first.`);
  const options = fs.readdirSync(SEED_DIR).filter((f) => f.endsWith('.json')).sort();
  if (!options.length) die(`No .json files in ${path.relative(ROOT, SEED_DIR)}/.`);
  if (options.length === 1 || !rl) {
    configPath = path.join(SEED_DIR, options[0]);
  } else {
    console.log('Competitions to seed (file name = directory = URL path):');
    for (let i = 0; i < options.length; i++) {
      const dir = path.basename(options[i], '.json');
      const exists = await competitionExists(dir);
      console.log(`  [${i + 1}] ${options[i]} → /${dir}${exists ? '  (EXISTS — reseeding WIPES its scores; a safety export is taken first)' : ''}`);
    }
    const pick = await rl.question(`Which one? [1-${options.length}, default 1] `);
    const n = pick.trim() === '' ? 1 : Number(pick);
    if (!Number.isInteger(n) || n < 1 || n > options.length) die('Invalid choice.');
    configPath = path.join(SEED_DIR, options[n - 1]);
  }
}
const configAbs = path.isAbsolute(configPath) ? configPath : path.join(ROOT, configPath);
if (!fs.existsSync(configAbs)) die(`Seed config not found: ${configPath}`);

const dirName = path.basename(configAbs, '.json');
if (!DIR_NAME_RE.test(dirName)) {
  die(`Seed file name "${dirName}.json" is not a valid competition name — it becomes the directory and URL path, so use lowercase letters, digits, and dashes (e.g. ai-day-3.json).`);
}

const config = JSON.parse(fs.readFileSync(configAbs, 'utf8'));
const competitionName = config.name ?? dirName;
const dataDir = competitionDir(dirName);
const dirLabel = path.relative(ROOT, dataDir);
const dbLabel = DB_DRIVER === 'postgres' ? `Postgres schema "${dirName}"` : dirLabel;
console.log(`Competition: "${competitionName}" → ${dbLabel} → /${dirName}  [${DB_DRIVER}]`);

/* ---------- 2. Wipe confirmation + safety export ---------- */

if (await competitionExists(dirName)) {
  if (!reset && !rl) {
    die(`${dbLabel} already has a database. Re-run with --reset to wipe it (deletes all scores!).`);
  }
  if (!reset) {
    const typed = await rl.question(
      `${dbLabel} already has a database. Wiping deletes ALL its scores.\nType the competition name ("${dirName}") to confirm: `
    );
    if (typed.trim() !== dirName) die('Confirmation did not match — nothing was changed.');
  }

  try {
    const oldCtx = await openCompetition(dirName);
    const { files } = await exportSnapshot(oldCtx, 'pre-reseed');
    await oldCtx.db.close();
    console.log(`Safety export saved to ${dirLabel}/exports/: ${files.join(', ')}`);
  } catch (err) {
    console.warn(`Warning: safety export failed (${err.message}) — continuing with wipe.`);
  }

  await wipeCompetition(dirName);
  console.log(
    DB_DRIVER === 'postgres'
      ? 'Existing schema dropped (exports/ on disk kept).'
      : 'Existing database removed (session-secret and exports/ kept).'
  );
}

rl?.close();

/* ---------- 3. Validate config ---------- */

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
const people = [...judges, ...admins];
const badIds = people.filter((p) => !String(p.employeeId ?? '').trim());
if (badIds.length) die('Every judge/admin needs an employeeId.');
/* PIN defaults to the employee ID when not set. */
const pinFor = (p) => String(p.pin ?? p.employeeId).trim();
const badPins = people.filter((p) => !pinFor(p) || pinFor(p).length > 64);
if (badPins.length) die(`Invalid PINs for: ${badPins.map((p) => p.employeeId).join(', ')}`);

/* ---------- 4. Load ---------- */

const ctx = await openCompetition(dirName);
const { db } = ctx;

await ctx.setSetting('competition_name', competitionName);

const criterionIds = [];
for (let i = 0; i < criteria.length; i++) {
  const { lastInsertRowid } = await db
    .prepare('INSERT INTO criteria (name, position) VALUES (?, ?)')
    .run(criteria[i], i + 1);
  criterionIds.push(Number(lastInsertRowid));
}

const panelIdByName = {};
for (let i = 0; i < categories.length; i++) {
  const cat = categories[i];
  const { lastInsertRowid: catId } = await db
    .prepare('INSERT INTO categories (name, position) VALUES (?, ?)')
    .run(cat.name, i + 1);
  const { lastInsertRowid: panelId } = await db
    .prepare('INSERT INTO panels (name, category_id) VALUES (?, ?)')
    .run(cat.panel, Number(catId));
  panelIdByName[cat.panel] = Number(panelId);

  for (let wi = 0; wi < cat.weights.length; wi++) {
    await db.prepare('INSERT INTO category_weights (category_id, criterion_id, weight) VALUES (?, ?, ?)')
      .run(Number(catId), criterionIds[wi], cat.weights[wi] / 100);
  }
  for (let ei = 0; ei < cat.entries.length; ei++) {
    const e = cat.entries[ei];
    await db.prepare('INSERT INTO entries (category_id, name, description, team, position) VALUES (?, ?, ?, ?, ?)')
      .run(Number(catId), e.name, e.description ?? '', e.team ?? '', ei + 1);
  }
}

const insertJudge = db.prepare(
  'INSERT INTO judges (employee_id, name, pin_hash, panel_id, role) VALUES (?, ?, ?, ?, ?)'
);
for (const j of judges) {
  const panelId = panelIdByName[j.panel];
  if (!panelId) die(`Judge ${j.employeeId}: unknown panel "${j.panel}".`);
  await insertJudge.run(j.employeeId, j.name, hashPin(pinFor(j)), panelId, 'judge');
}
for (const a of admins) {
  await insertJudge.run(a.employeeId, a.name, hashPin(pinFor(a)), null, 'admin');
}

console.log(`\nSeeded "${competitionName}" into ${dbLabel}:`, JSON.stringify({
  categories: categories.length,
  criteria: criteria.length,
  entries: categories.reduce((n, c) => n + c.entries.length, 0),
  judges: judges.length,
  admins: admins.length,
}));
console.log(`\nLive at: http://localhost:3000/${dirName}  (npm start serves every competition)`);

await ctx.db.close();
await closeDbPools();
