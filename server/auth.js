import crypto from 'node:crypto';

const SESSION_DAYS = 7;
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPin(pin, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(pin, salt, 32);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

/* Token = judgeId.expiry.hmac, signed with the competition's own secret.
   The judge's pin_hash is mixed into the HMAC so a PIN reset invalidates
   existing sessions for that judge. */
function sign(ctx, payload, pinHash) {
  return crypto.createHmac('sha256', ctx.secret).update(`${payload}|${pinHash}`).digest('hex');
}

export function makeToken(ctx, judge) {
  const payload = `${judge.id}.${Date.now() + SESSION_DAYS * 86400_000}`;
  return `${payload}.${sign(ctx, payload, judge.pin_hash)}`;
}

export function judgeFromToken(ctx, token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [id, expires, sig] = parts;
  if (Number(expires) < Date.now()) return null;
  const judge = ctx.db.prepare('SELECT * FROM judges WHERE id = ?').get(Number(id));
  if (!judge) return null;
  const expected = sign(ctx, `${id}.${expires}`, judge.pin_hash);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return judge;
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/* Requires req.ctx (set by the competition resolver in index.js). */
export function attachJudge(req, _res, next) {
  req.judge = judgeFromToken(req.ctx, parseCookies(req).session);
  next();
}

export function requireAuth(req, res, next) {
  if (!req.judge) return res.status(401).json({ error: 'Not logged in' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.judge) return res.status(401).json({ error: 'Not logged in' });
  if (req.judge.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

export function publicJudge(ctx, judge) {
  const panel = judge.panel_id
    ? ctx.db.prepare('SELECT p.id, p.name, p.category_id FROM panels p WHERE p.id = ?').get(judge.panel_id)
    : null;
  return {
    id: judge.id,
    employeeId: judge.employee_id,
    name: judge.name,
    role: judge.role,
    panel,
  };
}

/* Cookies are scoped to /<competition>, so sessions in parallel competitions
   on the same host never collide. */
const cookiePath = (ctx) => `/${ctx.name}`;
const sessionCookie = (ctx, token) =>
  `session=${token}; Path=${cookiePath(ctx)}; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;

export function handleLogin(req, res) {
  const ctx = req.ctx;
  const employeeId = String(req.body?.employeeId ?? '').trim();
  const pin = String(req.body?.pin ?? '').trim();
  if (!employeeId || !pin || pin.length > 64) {
    return res.status(400).json({ error: 'Employee ID and PIN required' });
  }

  const cutoff = Date.now() - ATTEMPT_WINDOW_MS;
  ctx.db.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').run(cutoff);
  const { n } = ctx.db
    .prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE employee_id = ? AND attempted_at >= ?')
    .get(employeeId, cutoff);
  if (n >= MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  }

  const judge = ctx.db.prepare('SELECT * FROM judges WHERE employee_id = ?').get(employeeId);
  if (!judge || !verifyPin(pin, judge.pin_hash)) {
    ctx.db.prepare('INSERT INTO login_attempts (employee_id, attempted_at) VALUES (?, ?)').run(employeeId, Date.now());
    return res.status(401).json({ error: 'Invalid employee ID or PIN' });
  }

  ctx.db.prepare('DELETE FROM login_attempts WHERE employee_id = ?').run(employeeId);
  res.setHeader('Set-Cookie', sessionCookie(ctx, makeToken(ctx, judge)));
  res.json({ user: publicJudge(ctx, judge) });
}

export function handleLogout(req, res) {
  res.setHeader('Set-Cookie', `session=; Path=${cookiePath(req.ctx)}; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
}
