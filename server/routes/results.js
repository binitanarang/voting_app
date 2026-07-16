import { Router } from 'express';
import { computeResults, resultsToCsv } from '../compute.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';

export const resultsRouter = Router();
resultsRouter.use(requireAuth);

/* Dashboard is visible to all logged-in judges (per user decision). */
resultsRouter.get('/results', asyncHandler(async (req, res) => {
  const data = await req.ctx.loadCompetition();
  res.json({
    generatedAt: new Date().toISOString(),
    globalLocked: (await req.ctx.getSetting('voting_locked', '0')) === '1',
    criteria: data.criteria.map((c) => ({ id: c.id, name: c.name })),
    categories: computeResults(data),
  });
}));

resultsRouter.get('/results.csv', asyncHandler(async (req, res) => {
  const data = await req.ctx.loadCompetition();
  const csv = resultsToCsv(computeResults(data), data.criteria);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.ctx.name}-results.csv"`);
  res.send(csv);
}));
