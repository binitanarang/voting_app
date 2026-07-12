/* Fetch wrapper plus the offline score queue.

   Score writes go through saveScore(). If the network is down the write is
   queued in localStorage (latest value per entry+criterion wins) and replayed
   when the browser comes back online, on app start, and every 20 s. */

const QUEUE_KEY = 'scoreQueue.v1';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
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
    const q = readQueue();
    for (const [entryId, criteria] of Object.entries(q)) {
      try {
        await api(`/api/scores/${entryId}`, { method: 'PUT', body: criteria });
        delete q[entryId];
        writeQueue(q);
      } catch (err) {
        if (err.status === 0) return; // still offline — retry later
        // Rejected by the server (locked, auth, validation): drop it so the
        // queue can't wedge; the UI reflects server state on next load.
        delete q[entryId];
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
  try {
    const res = await api(`/api/scores/${entryId}`, { method: 'PUT', body: { [criterionId]: score } });
    return { status: 'saved', ballot: res.ballot };
  } catch (err) {
    if (err.status === 0) {
      const q = readQueue();
      (q[entryId] ??= {})[criterionId] = score;
      writeQueue(q);
      return { status: 'queued' };
    }
    throw err;
  }
}

window.addEventListener('online', flushQueue);
setInterval(flushQueue, 20_000);
flushQueue();
