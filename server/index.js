import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { ROOT, DATA_DIR, getSetting } from './db.js';
import { attachJudge, requireAuth, handleLogin, handleLogout, publicJudge } from './auth.js';
import { judgeRouter } from './routes/judge.js';
import { resultsRouter } from './routes/results.js';
import { adminRouter } from './routes/admin.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(attachJudge);

/* Public: which competition this instance serves (shown on the login page). */
app.get('/api/config', (_req, res) => res.json({ name: getSetting('competition_name', 'Competition') }));

app.post('/api/login', handleLogin);
app.post('/api/logout', handleLogout);
app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicJudge(req.judge) }));

app.use('/api', judgeRouter);
app.use('/api', resultsRouter);
app.use('/api/admin', adminRouter);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

/* Production: serve the built SPA. In dev, Vite serves the client and
   proxies /api here. */
const dist = path.join(ROOT, 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  const name = getSetting('competition_name', 'Competition');
  console.log(`"${name}" on http://localhost:${port} · data: ${path.relative(ROOT, DATA_DIR)}${fs.existsSync(dist) ? '' : ' (API only — run client dev server)'}`);
});
