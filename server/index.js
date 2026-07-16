import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { ROOT, DB_DRIVER, getCompetition, listCompetitions } from './db.js';
import { attachJudge, requireAuth, handleLogin, handleLogout, publicJudge } from './auth.js';
import { asyncHandler } from './asyncHandler.js';
import { judgeRouter } from './routes/judge.js';
import { resultsRouter } from './routes/results.js';
import { adminRouter } from './routes/admin.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json());

/* Public: competitions on this server, for the landing page. */
app.get('/api/competitions', asyncHandler(async (_req, res) => res.json({ competitions: await listCompetitions() })));

/* Per-competition API — the URL path segment IS the data directory name
   (SQLite) or schema name (Postgres): /ai-day-3/api/... → data/ai-day-3/ */
const api = express.Router();
api.get('/config', asyncHandler(async (req, res) => res.json({ name: await req.ctx.getSetting('competition_name', req.ctx.name) })));
api.post('/login', handleLogin);
api.post('/logout', handleLogout);
api.get('/me', requireAuth, asyncHandler(async (req, res) => res.json({ user: await publicJudge(req.ctx, req.judge) })));
api.use(judgeRouter);
api.use(resultsRouter);
api.use('/admin', adminRouter);
api.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use(
  '/:comp/api',
  asyncHandler(async (req, res, next) => {
    const ctx = await getCompetition(req.params.comp);
    if (!ctx) return res.status(404).json({ error: `No competition at /${req.params.comp}` });
    req.ctx = ctx;
    next();
  }),
  attachJudge,
  api
);

/* Production: serve the built SPA. Assets use absolute /assets/... paths, so
   one static mount serves every competition; any other GET falls back to the
   SPA shell, which reads the competition from its URL. In dev, Vite serves
   the client and proxies both /api and /:comp/api here. */
const dist = path.join(ROOT, 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => {
    if (/\/api(\/|$)/.test(req.path)) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(dist, 'index.html'));
  });
}

/* Rejected async handlers land here via asyncHandler. */
app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error' });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, async () => {
  const comps = await listCompetitions();
  console.log(`Voting server on http://localhost:${port} [${DB_DRIVER}]${fs.existsSync(dist) ? '' : ' (API only — run client dev server)'}`);
  if (comps.length) {
    for (const c of comps) console.log(`  /${c.dir}  →  "${c.name}"`);
  } else {
    console.log('  no competitions yet — run: npm run seed');
  }
});
