import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';

export const judgeRouter = Router();
judgeRouter.use(requireAuth);

async function ballotFor(ctx, judge) {
  if (!judge.panel_id) return null;
  const { db } = ctx;
  const panel = await db.prepare('SELECT * FROM panels WHERE id = ?').get(judge.panel_id);
  const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(panel.category_id);
  const criteria = await db.prepare('SELECT * FROM criteria ORDER BY position').all();
  const entries = await db
    .prepare('SELECT * FROM entries WHERE category_id = ? ORDER BY position')
    .all(category.id);
  const scores = await db
    .prepare('SELECT entry_id, criterion_id, score FROM scores WHERE judge_id = ?')
    .all(judge.id);

  const byEntry = {};
  for (const s of scores) (byEntry[s.entry_id] ??= {})[s.criterion_id] = s.score;

  const withScores = entries.map((e) => {
    const mine = byEntry[e.id] ?? {};
    return {
      id: e.id,
      name: e.name,
      description: e.description,
      team: e.team,
      scores: mine,
      scoredCriteria: Object.keys(mine).length,
      complete: criteria.every((c) => mine[c.id] != null),
    };
  });

  return {
    panel: { id: panel.id, name: panel.name },
    category: { id: category.id, name: category.name },
    criteria: criteria.map((c) => ({ id: c.id, name: c.name })),
    locked: await ctx.votingLocked(category.id),
    entries: withScores,
    progress: {
      scored: withScores.filter((e) => e.complete).length,
      total: withScores.length,
    },
  };
}

judgeRouter.get('/ballot', asyncHandler(async (req, res) => {
  const ballot = await ballotFor(req.ctx, req.judge);
  if (!ballot) return res.status(403).json({ error: 'No panel assigned to this account' });
  res.json(ballot);
}));

/* Autosave: body is a partial map {criterionId: score}. Upserts each pair. */
judgeRouter.put('/scores/:entryId', asyncHandler(async (req, res) => {
  const { ctx, judge } = req;
  const { db } = ctx;
  if (!judge.panel_id) return res.status(403).json({ error: 'No panel assigned to this account' });

  const entry = await db.prepare('SELECT * FROM entries WHERE id = ?').get(Number(req.params.entryId));
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  const panel = await db.prepare('SELECT * FROM panels WHERE id = ?').get(judge.panel_id);
  if (entry.category_id !== panel.category_id) {
    return res.status(403).json({ error: 'Entry is not assigned to your panel' });
  }
  if (await ctx.votingLocked(entry.category_id)) {
    return res.status(403).json({ error: 'Scoring is closed', locked: true });
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length) {
    return res.status(400).json({ error: 'Expected {criterionId: score}' });
  }
  const validCriteria = new Set((await db.prepare('SELECT id FROM criteria').all()).map((c) => c.id));
  const pairs = [];
  for (const [cid, val] of Object.entries(body)) {
    const criterionId = Number(cid);
    if (!validCriteria.has(criterionId)) return res.status(400).json({ error: `Unknown criterion ${cid}` });
    if (!Number.isInteger(val) || val < 1 || val > 5) {
      return res.status(400).json({ error: 'Scores must be integers 1–5' });
    }
    pairs.push([criterionId, val]);
  }

  const upsert = db.prepare(`
    INSERT INTO scores (judge_id, entry_id, criterion_id, score, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(judge_id, entry_id, criterion_id)
    DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at
  `);
  const now = new Date().toISOString();
  for (const [criterionId, val] of pairs) {
    await upsert.run(judge.id, entry.id, criterionId, val, now);
  }

  #res.json({ ok: true, ballot: await ballotFor(ctx, judge) });
  res.json({ ok: true });
}));

judgeRouter.get('/meta', asyncHandler(async (req, res) => {
  const { db } = req.ctx;
  res.json({
    categories: await db.prepare('SELECT id, name, position, voting_locked FROM categories ORDER BY position').all(),
    criteria: await db.prepare('SELECT id, name, position FROM criteria ORDER BY position').all(),
    panels: await db.prepare('SELECT * FROM panels').all(),
    weights: await db.prepare('SELECT * FROM category_weights').all(),
    globalLocked: (await req.ctx.getSetting('voting_locked', '0')) === '1',
  });
}));
