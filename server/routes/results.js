import { Router } from 'express';
import { db, loadCompetition, getSetting } from '../db.js';
import { computeResults, resultsToCsv } from '../compute.js';
import { requireAuth } from '../auth.js';

export const resultsRouter = Router();
resultsRouter.use(requireAuth);

/* Dashboard is visible to all logged-in judges (per user decision). */
resultsRouter.get('/results', (_req, res) => {
  const data = loadCompetition();
  res.json({
    generatedAt: new Date().toISOString(),
    globalLocked: getSetting('voting_locked', '0') === '1',
    criteria: data.criteria.map((c) => ({ id: c.id, name: c.name })),
    categories: computeResults(data),
  });
});

resultsRouter.get('/results.csv', (_req, res) => {
  const data = loadCompetition();
  const csv = resultsToCsv(computeResults(data), data.criteria);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="competition-results.csv"');
  res.send(csv);
});
