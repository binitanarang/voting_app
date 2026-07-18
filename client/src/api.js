/* Fetch wrapper plus the offline score queue.

   The first URL path segment is the competition (and its data directory on
   the server): /ai-day-3/dashboard → API calls go to /ai-day-3/api/...
   At the root (no segment) only the public /api/competitions endpoint is used.

   Score writes go through saveScore(). If the network is down the write is
   queued in localStorage (latest value per entry+criterion wins, keyed by the
   full URL so parallel competitions never mix) and replayed when the browser
   comes back online, on app start, and every 20 s. */

const QUEUE_KEY = 'scoreQueue.v2';

const seg = window.location.pathname.split('/')[1] ?? '';
export const COMPETITION = seg;
export const API_BASE = seg ? `/${seg}` : '';
export const apiUrl = (path) => API_BASE + path;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(url, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'offline'); // network failure
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data;
}

/* Competition-scoped call: api('/api/ballot') → GET /<comp>/api/ballot */
export const api = (path, opts) => request(apiUrl(path), opts);
/* Server-global call (landing page): apiGlobal('/api/competitions') */
export const apiGlobal = (path, opts) => request(path, opts);

/* ---------- Offline queue ---------- */

const listeners = new Set();
export function onQueueChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY)) ?? {};
  } catch {
    return {};
  }
}
function writeQueue(q) {
  if (Object.keys(q).length) localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  else localStorage.removeItem(QUEUE_KEY);
  for (const cb of listeners) cb(queueSize());
}
export function queueSize() {
  return Object.values(readQueue()).reduce((n, m) => n + Object.keys(m).length, 0);
}

let flushing = false;
export async function flushQueue() {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    const q = readQueue(); // { "/<comp>/api/scores/<entryId>": {criterionId: score} }
    for (const [url, criteria] of Object.entries(q)) {
      try {
        await request(url, { method: 'PUT', body: criteria });
        delete q[url];
        writeQueue(q);
      } catch (err) {
        if (err.status === 0) return; // still offline — retry later
        // Rejected by the server (locked, auth, validation): drop it so the
        // queue can't wedge; the UI reflects server state on next load.
        delete q[url];
        writeQueue(q);
      }
    }
  } finally {
    flushing = false;
  }
}

/* Returns 'saved' | 'queued'. Throws ApiError for real rejections (locked,
   logged out, validation) so the UI can tell the judge. */
export async function saveScore(entryId, criterionId, score) {
  const url = apiUrl(`/api/scores/${entryId}`);
  try {
    await request(url, { method: 'PUT', body: { [criterionId]: score } });
    return { status: 'saved' };
  } catch (err) {
    if (err.status === 0) {
      const q = readQueue();
      (q[url] ??= {})[criterionId] = score;
      writeQueue(q);
      return { status: 'queued' };
    }
    throw err;
  }
}

window.addEventListener('online', flushQueue);
setInterval(flushQueue, 20_000);
flushQueue();
