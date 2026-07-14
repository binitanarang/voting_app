/* Auto write-back: regenerates data/seed/<competition>.json from the live
   database after every successful admin edit, so the seed file always
   mirrors the current setup and can rebuild it on a fresh machine.

   PINs exist only as hashes in the database, so explicit "pin" fields are
   carried over from the previous file by employee ID; PINs set or reset in
   the app are NOT reflected here (those people fall back to the seed default
   of PIN = employee ID on a reseed). Scores are never part of the seed. */
import fs from 'node:fs';
import path from 'node:path';
import { SEED_DIR } from './paths.js';

export function syncSeedJson(ctx) {
  const { db } = ctx;
  const seedPath = path.join(SEED_DIR, `${ctx.name}.json`);

  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(seedPath, 'utf8')); } catch { /* first write or unreadable — nothing to merge */ }
  const prevPins = new Map(
    [...(previous.judges ?? []), ...(previous.admins ?? [])]
      .filter((p) => p.pin != null)
      .map((p) => [String(p.employeeId), String(p.pin)])
  );

  const criteria = db.prepare('SELECT * FROM criteria ORDER BY position').all();
  const cats = db.prepare('SELECT * FROM categories ORDER BY position').all();
  const panels = db.prepare('SELECT * FROM panels').all();
  const people = db.prepare('SELECT * FROM judges').all();
  const panelName = Object.fromEntries(panels.map((p) => [p.id, p.name]));

  const person = (j) => {
    const p = { employeeId: j.employee_id, name: j.name };
    if (prevPins.has(j.employee_id)) p.pin = prevPins.get(j.employee_id);
    return p;
  };

  const categories = cats.map((c) => {
    const stored = db.prepare('SELECT criterion_id, weight FROM category_weights WHERE category_id = ?').all(c.id);
    const byCriterion = Object.fromEntries(stored.map((w) => [w.criterion_id, w.weight]));
    const weights = criteria.map((cr) => Math.round((byCriterion[cr.id] ?? 0) * 10000) / 100);
    // Rounding drift must not break the seeder's sum-to-100 check.
    const drift = Math.round((100 - weights.reduce((a, b) => a + b, 0)) * 100) / 100;
    if (weights.length && Math.abs(drift) < 1) {
      weights[weights.length - 1] = Math.round((weights[weights.length - 1] + drift) * 100) / 100;
    }
    return {
      name: c.name,
      panel: panels.find((p) => p.category_id === c.id)?.name ?? '',
      weights,
      entries: db.prepare('SELECT * FROM entries WHERE category_id = ? ORDER BY position').all(c.id)
        .map((e) => ({ name: e.name, team: e.team, description: e.description })),
    };
  });

  const out = {
    _readme: 'AUTO-SYNCED from the live database after every admin edit — manual edits to this file are overwritten. "pin" fields are carried over from the previous version of this file; PINs set or reset in the app are not reflected (the database stores only hashes), so those people default back to PIN = employee ID on a reseed. Load with: npm run seed.',
    name: ctx.getSetting('competition_name', ctx.name),
    criteria: criteria.map((c) => c.name),
    categories,
    judges: people.filter((j) => j.role === 'judge').map((j) => ({ ...person(j), panel: panelName[j.panel_id] ?? '' })),
    admins: people.filter((j) => j.role === 'admin').map(person),
  };

  fs.writeFileSync(seedPath, JSON.stringify(out, null, 2) + '\n');
}
