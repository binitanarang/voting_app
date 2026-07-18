import { Router } from 'express';
import { requireAdmin, hashPin } from '../auth.js';
import { exportSnapshot } from '../export.js';
import { syncSeedJson } from '../seedSync.js';
import { asyncHandler } from '../asyncHandler.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

/* Every successful admin mutation rewrites data/seed/<competition>.json so
   the seed file tracks the live setup. Runs after the response is sent. */
adminRouter.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    res.on('finish', () => {
      if (res.statusCode < 400) {
        syncSeedJson(req.ctx).catch((err) => {
          console.error(`seed sync failed for ${req.ctx.name}: ${err.message}`);
        });
      }
    });
  }
  next();
});

const nextPosition = async (db, table, where = '', params = []) =>
  (await db.prepare(`SELECT COALESCE(MAX(position), 0) + 1 AS p FROM ${table} ${where}`).get(...params)).p;

/* ---------- Entries ---------- */

adminRouter.post('/entries', asyncHandler(async (req, res) => {
  const { db } = req.ctx;
  const { name, description = '', team = '', categoryId } = req.body ?? {};
  if (!name?.trim() || !(await db.prepare('SELECT id FROM categories WHERE id = ?').get(Number(categoryId)))) {
    return res.status(400).json({ error: 'name and valid categoryId required' });
  }
  const { lastInsertRowid } = await db
    .prepare('INSERT INTO entries (category_id, name, description, team, position) VALUES (?, ?, ?, ?, ?)')
    .run(Number(categoryId), name.trim(), String(description), String(team).trim(), await nextPosition(db, 'entries', 'WHERE category_id = ?', [Number(categoryId)]));
  res.json({ id: Number(lastInsertRowid) });
}));

adminRouter.put('/entries/:id', asyncHandler(async (req, res) => {
  const { db } = req.ctx;
  const entry = await db.prepare('SELECT * FROM entries WHERE id = ?').get(Number(req.params.id));
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  const { name = entry.name, description = entry.description, team = entry.team, categoryId = entry.category_id } = req.body ?? {};
  if (!(await db.prepare('SELECT id FROM categories WHERE id = ?').get(Number(categoryId)))) {
    return res.status(400).json({ error: 'Invalid categoryId' });
  }
  await db.prepare('UPDATE entries SET name = ?, description = ?, team = ?, category_id = ? WHERE id = ?')
    .run(String(name).trim(), String(description), String(team).trim(), Number(categoryId), entry.id);
  res.json({ ok: true });
}));

adminRouter.delete('/entries/:id', asyncHandler(async (req, res) => {
  const { db } = req.ctx;
  const id = Number(req.params.id);
  await db.prepare('DELETE FROM scores WHERE entry_id = ?').run(id);
  await db.prepare('DELETE FROM entries WHERE id = ?').run(id);
  res.json({ ok: true });
}));

/* ---------- Judges ---------- */

adminRouter.get('/judges', asyncHandler(async (req, res) => {
  const { db } = req.ctx;
  const judges = await db.prepare(`
    SELECT j.id, j.employee_id, j.name, j.role, j.panel_id, p.name AS panel_name, p.category_id
    FROM judges j LEFT JOIN panels p ON p.id = j.panel_id
    ORDER BY j.role DESC, p.id, j.name
  `).all();
  const criteriaCount = (await db.prepare('SELECT COUNT(*) AS n FROM criteria').get()).n;
  const completion = [];
  for (const j of judges) {
    if (!j.panel_id) {
      completion.push({ ...j, scored: null, total: null });
      continue;
    }
    const total = (await db.prepare('SELECT COUNT(*) AS n FROM entries WHERE category_id = ?').get(j.category_id)).n;
    const scored = (await db.prepare(`
      SELECT COUNT(*) AS n FROM (
        SELECT entry_id FROM scores s JOIN entries e ON e.id = s.entry_id
        WHERE s.judge_id = ? AND e.category_id = ?
        GROUP BY entry_id HAVING COUNT(*) = ?
      ) AS complete_entries
    `).get(j.id, j.category_id, criteriaCount)).n;
    completion.push({ ...j, scored, total });
  }
  res.json({ judges: completion });
}));

adminRouter.post('/judges', asyncHandler(async (req, res) => {
  const { db } = req.ctx;
  // PIN defaults to the employee ID, same as the seeder.
  const { employeeId, name, pin = req.body?.employeeId, panelId = null, role = 'judge' } = req.body ?? {};
  if (!employeeId?.trim() || !name?.trim() || !String(pin ?? '').trim() || String(pin).length > 64) {
    return res.status(400).json({ error: 'employeeId and name required' });
  }
  if (!['judge', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (panelId != null && !(await db.prepare('SELECT id FROM panels WHERE id = ?').get(Number(panelId)))) {
    return res.status(400).json({ error: 'Invalid panelId' });
  }
  try {
    const { lastInsertRowid } = await db
      .prepare('INSERT INTO judges (employee_id, name, pin_hash, panel_id, role) VALUES (?, ?, ?, ?, ?)')
      .run(employeeId.trim().toUpperCase(), name.trim(), hashPin(String(pin)), panelId == null ? null : Number(panelId), role);
    res.json({ id: Number(lastInsertRowid) });
  } catch {
    res.status(400).json({ error: 'Employee ID already exists' });
  }
}));

adminRouter.put('/judges/:id', asyncHandler(async (req, res) => {
  const { db } = req.ctx;
  const judge = await db.prepare('SELECT * FROM judges WHERE id = ?').get(Number(req.params.id));
  if (!judge) return res.status(404).json({ error: 'Judge not found' });
  const { name = judge.name, panelId = judge.panel_id, role = judge.role } = req.body ?? {};
  if (!['judge', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (panelId != null && !(await db.prepare('SELECT id FROM panels WHERE id = ?').get(Number(panelId)))) {
    return res.status(400).json({ error: 'Invalid panelId' });
  }
  await db.prepare('UPDATE judges SET name = ?, panel_id = ?, role = ? WHERE id = ?')
    .run(String(name).trim(), panelId == null ? null : Number(panelId), role, judge.id);
  res.json({ ok: true });
}));

/* PIN reset — also invalidates the judge's existing sessions (token HMAC
   includes pin_hash). */
adminRouter.post('/judges/:id/pin', asyncHandler(async (req, res) => {
  const { db } = req.ctx;
  const { pin } = req.body ?? {};
  if (!String(pin ?? '').trim() || String(pin).length > 64) return res.status(400).json({ error: 'pin required' });
  const r = await db.prepare('UPDATE judges SET pin_hash = ? WHERE id = ?').run(hashPin(String(pin)), Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Judge not found' });
  res.json({ ok: true });
}));

adminRouter.delete('/judges/:id', asyncHandler(async (req, res) => {
  const { db } = req.ctx;
  const id = Number(req.params.id);
  if (req.judge.id === id) return res.status(400).json({ error: 'Cannot delete your own account' });
  await db.prepare('DELETE FROM scores WHERE judge_id = ?').run(id);
  await db.prepare('DELETE FROM judges WHERE id = ?').run(id);
  res.json({ ok: true });
}));

/* ---------- Categories, criteria, weights ---------- */

/* New category ships usable: its own panel and equal weights across all
   criteria, so results math works before the admin fine-tunes anything. */
adminRouter.post('/categories', asyncHandler(async (req, res) => {
  const { db } = req.ctx;
  const { name } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const { lastInsertRowid: catId } = await db
    .prepare('INSERT INTO categories (name, position) VALUES (?, ?)')
    .run(name.trim(), await nextPosition(db, 'categories'));
  const panelCount = (await db.prepare('SELECT COUNT(*) AS n FROM panels').get()).n;
  await db.prepare('INSERT INTO panels (name, category_id) VALUES (?, ?)').run(`Panel ${panelCount + 1}`, Number(catId));
  const criteria = await db.prepare('SELECT id FROM criteria').all();
  for (const cr of criteria) {
    await db.prepare('INSERT INTO category_weights (category_id, criterion_id, weight) VALUES (?, ?, ?)')
      .run(Number(catId), cr.id, 1 / criteria.length);
  }
  res.json({ id: Number(catId) });
}));

/* New criterion starts at weight 0 in every category: sums stay at 100 and
   existing complete ballots become incomplete until judges score it. */
adminRouter.post('/criteria', asyncHandler(async (req, res) => {
  const { db } = req.ctx;
  const { name } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const { lastInsertRowid } = await db
    .prepare('INSERT INTO criteria (name, position) VALUES (?, ?)')
    .run(name.trim(), await nextPosition(db, 'criteria'));
  for (const cat of await db.prepare('SELECT id FROM categories').all()) {
    await db.prepare('INSERT INTO category_weights (category_id, criterion_id, weight) VALUES (?, ?, ?)')
      .run(cat.id, Number(lastInsertRowid), 0);
  }
  res.json({ id: Number(lastInsertRowid) });
}));

/* Deleting a category removes its entries, their scores, its weights, and
   its panel; judges on that panel keep their accounts but become unassigned. */
adminRouter.delete('/categories/:id', asyncHandler(async (req, res) => {
  const { db } = req.ctx;
  const id = Number(req.params.id);
  if (!(await db.prepare('SELECT id FROM categories WHERE id = ?').get(id))) {
    return res.status(404).json({ error: 'Category not found' });
  }
  if ((await db.prepare('SELECT COUNT(*) AS n FROM categories').get()).n <= 1) {
    return res.status(400).json({ error: 'Cannot delete the last category' });
  }
  await db.prepare('DELETE FROM scores WHERE entry_id IN (SELECT id FROM entries WHERE category_id = ?)').run(id);
  await db.prepare('DELETE FROM entries WHERE category_id = ?').run(id);
  await db.prepare('DELETE FROM category_weights WHERE category_id = ?').run(id);
  await db.prepare('UPDATE judges SET panel_id = NULL WHERE panel_id IN (SELECT id FROM panels WHERE category_id = ?)').run(id);
  await db.prepare('DELETE FROM panels WHERE category_id = ?').run(id);
  await db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  res.json({ ok: true });
}));

/* Deleting a criterion drops its scores and rescales the remaining weights
   proportionally so each category still sums to 100. Weighted results are
   unchanged by the rescale (weights are normalized by their sum anyway). */
adminRouter.delete('/criteria/:id', asyncHandler(async (req, res) => {
  const { db } = req.ctx;
  const id = Number(req.params.id);
  if (!(await db.prepare('SELECT id FROM criteria WHERE id = ?').get(id))) {
    return res.status(404).json({ error: 'Criterion not found' });
  }
  if ((await db.prepare('SELECT COUNT(*) AS n FROM criteria').get()).n <= 1) {
    return res.status(400).json({ error: 'Cannot delete the last criterion' });
  }
  await db.prepare('DELETE FROM scores WHERE criterion_id = ?').run(id);
  await db.prepare('DELETE FROM category_weights WHERE criterion_id = ?').run(id);
  await db.prepare('DELETE FROM criteria WHERE id = ?').run(id);
  for (const cat of await db.prepare('SELECT id FROM categories').all()) {
    const rows = await db.prepare('SELECT criterion_id, weight FROM category_weights WHERE category_id = ?').all(cat.id);
    const total = rows.reduce((a, r) => a + r.weight, 0);
    if (total > 0) {
      for (const r of rows) {
        await db.prepare('UPDATE category_weights SET weight = ? WHERE category_id = ? AND criterion_id = ?')
          .run(r.weight / total, cat.id, r.criterion_id);
      }
    }
  }
  res.json({ ok: true });
}));

adminRouter.put('/categories/:id', asyncHandler(async (req, res) => {
  const { db } = req.ctx;
  const { name } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const r = await db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name.trim(), Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Category not found' });
  res.json({ ok: true });
}));

adminRouter.put('/panels/:id', asyncHandler(async (req, res) => {
  const { db } = req.ctx;
  const { name } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const r = await db.prepare('UPDATE panels SET name = ? WHERE id = ?').run(name.trim(), Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Panel not found' });
  res.json({ ok: true });
}));

adminRouter.put('/criteria/:id', asyncHandler(async (req, res) => {
  const { db } = req.ctx;
  const { name } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const r = await db.prepare('UPDATE criteria SET name = ? WHERE id = ?').run(name.trim(), Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Criterion not found' });
  res.json({ ok: true });
}));

/* Body: {weights: {criterionId: percent}} — must cover every criterion and
   sum to 100 (±0.01). Stored as fractions. */
adminRouter.put('/weights/:categoryId', asyncHandler(async (req, res) => {
  const { db } = req.ctx;
  const categoryId = Number(req.params.categoryId);
  if (!(await db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId))) {
    return res.status(404).json({ error: 'Category not found' });
  }
  const weights = req.body?.weights;
  const criteria = (await db.prepare('SELECT id FROM criteria').all()).map((c) => c.id);
  if (!weights || typeof weights !== 'object') return res.status(400).json({ error: 'weights object required' });

  const values = criteria.map((cid) => Number(weights[cid]));
  if (values.some((v) => !Number.isFinite(v) || v < 0)) {
    return res.status(400).json({ error: 'Every criterion needs a non-negative weight' });
  }
  const sum = values.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.01) {
    return res.status(400).json({ error: `Weights must sum to 100% (currently ${sum}%)` });
  }

  const upsert = db.prepare(`
    INSERT INTO category_weights (category_id, criterion_id, weight) VALUES (?, ?, ?)
    ON CONFLICT(category_id, criterion_id) DO UPDATE SET weight = excluded.weight
  `);
  for (let i = 0; i < criteria.length; i++) {
    await upsert.run(categoryId, criteria[i], values[i] / 100);
  }
  res.json({ ok: true });
}));

/* ---------- Voting locks ---------- */

adminRouter.put('/lock', asyncHandler(async (req, res) => {
  const { ctx } = req;
  const { db } = ctx;
  const { categoryId = null, locked } = req.body ?? {};
  if (typeof locked !== 'boolean') return res.status(400).json({ error: 'locked boolean required' });
  let scope = 'global';
  if (categoryId == null) {
    await ctx.setSetting('voting_locked', locked ? '1' : '0');
  } else {
    const cat = await db.prepare('SELECT name FROM categories WHERE id = ?').get(Number(categoryId));
    if (!cat) return res.status(404).json({ error: 'Category not found' });
    await db.prepare('UPDATE categories SET voting_locked = ? WHERE id = ?').run(locked ? 1 : 0, Number(categoryId));
    scope = cat.name;
  }

  // Locking is a decision point — archive results + a DB snapshot automatically.
  let exported = null;
  let exportError = null;
  if (locked) {
    try {
      exported = await exportSnapshot(ctx, `lock-${scope}`);
    } catch (err) {
      exportError = err.message;
    }
  }

  res.json({
    globalLocked: (await ctx.getSetting('voting_locked', '0')) === '1',
    categories: await db.prepare('SELECT id, name, voting_locked FROM categories ORDER BY position').all(),
    exported,
    exportError,
  });
}));
