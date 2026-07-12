/* Loads seed/competition.json into a fresh SQLite database.
   Refuses to touch an existing populated DB unless --reset is passed
   (reset deletes ALL data, including scores). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = path.join(root, 'data', 'voting.db');
const reset = process.argv.includes('--reset');

if (fs.existsSync(dbPath)) {
  if (!reset) {
    console.error('Database already exists. Re-run with --reset to wipe it (deletes all scores!):');
    console.error('  npm run seed -- --reset');
    process.exit(1);
  }
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  console.log('Existing database removed.');
}

const config = JSON.parse(fs.readFileSync(path.join(root, 'seed', 'competition.json'), 'utf8'));

// Import after any reset so db.js creates a fresh file.
const { db } = await import('./db.js');
const { hashPin } = await import('./auth.js');

const { criteria, categories, judges, admins = [] } = config;
if (!criteria?.length || !categories?.length || !judges?.length) {
  console.error('competition.json needs criteria, categories, and judges.');
  process.exit(1);
}
for (const cat of categories) {
  if (cat.weights.length !== criteria.length) {
    console.error(`Category "${cat.name}": expected ${criteria.length} weights, got ${cat.weights.length}.`);
    process.exit(1);
  }
  const sum = cat.weights.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.01) {
    console.error(`Category "${cat.name}": weights sum to ${sum}, expected 100.`);
    process.exit(1);
  }
}
const pinProblems = [...judges, ...admins].filter((j) => !/^\d{4}$/.test(String(j.pin)));
if (pinProblems.length) {
  console.error(`PINs must be exactly 4 digits: ${pinProblems.map((j) => j.employeeId).join(', ')}`);
  process.exit(1);
}

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
  if (!panelId) {
    console.error(`Judge ${j.employeeId}: unknown panel "${j.panel}".`);
    process.exit(1);
  }
  insertJudge.run(j.employeeId, j.name, hashPin(String(j.pin)), panelId, 'judge');
}
for (const a of admins) {
  insertJudge.run(a.employeeId, a.name, hashPin(String(a.pin)), null, 'admin');
}

const counts = {
  categories: categories.length,
  criteria: criteria.length,
  entries: categories.reduce((n, c) => n + c.entries.length, 0),
  judges: judges.length,
  admins: admins.length,
};
console.log('Seeded:', JSON.stringify(counts));
console.log(`Database: ${dbPath}`);
