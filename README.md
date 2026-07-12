# AI Competition Voting App

Judging app for the internal AI competition: judges score entries 1–5 on four
criteria from their phones or laptops, and a live dashboard shows weighted and
z-score-normalized results with rankings. Installable as a PWA; score
submissions made offline are queued and synced when the connection returns.

- **Frontend:** Vite + React SPA styled with the Mara design system
  (`client/src/styles/mara.css`) — no CSS framework.
- **Backend:** Express + SQLite (Node's built-in `node:sqlite`, so there are no
  native-module builds). One process serves both the API and the built SPA.
- **Auth:** employee ID + 4-digit PIN (scrypt-hashed), 7-day session cookie,
  failed attempts rate-limited (5 per 15 minutes per employee ID).

## Quick start

```bash
npm install
npm run seed        # load seed/competition.json into data/voting.db
npm run dev         # API on :3000, Vite dev server on :5173 (proxies /api)
```

Log in at http://localhost:5173 — seeded accounts (placeholders, change before
the event):

| Who | Employee ID | PIN |
| --- | --- | --- |
| Panel 1 judges (Category A) | `EMP001`–`EMP005` | `1001`–`1005` |
| Panel 2 judges (Category B) | `EMP006`–`EMP010` | `1006`–`1010` |
| Admin | `ADMIN` | `9999` |

Tests (score math — weighting, STANDARDIZE-style z-scores, sd=0 fallback,
tiebreaks): `npm test`

## Setting up a real competition

Edit `seed/competition.json`: category and criterion names, per-category weights
(percentages, must sum to 100), the 19 entries with descriptions, and judges
with real employee IDs and PINs. Then:

```bash
npm run seed -- --reset    # DELETES the existing database, including all scores
```

After seeding, everything is also editable in the admin UI (**Admin** tab):
entries, judges, PIN resets, criterion weights, and voting locks (global or
per category). Weights can be changed mid-event — results are always computed
from raw scores, so nothing is lost or goes stale.

## How scoring works

1. Each judge scores each entry 1–5 on each criterion (autosaved per tap).
2. Weighted score per judge per entry = Σ(score × category weight). Entries
   missing any criterion from a judge are flagged incomplete and excluded.
3. Per judge, weighted scores are standardized (Excel `STANDARDIZE`):
   z = (score − judge's mean) / judge's population std dev, across all entries
   that judge scored. A judge whose scores are all identical (sd = 0)
   contributes z = 0 rather than dividing by zero.
4. An entry's normalized score is the mean of its judges' z-scores. Rankings
   sort by normalized score; ties break on average weighted score.

The dashboard (visible to all logged-in judges, refreshes every 10 s) shows the
leaderboard, per-judge progress, and a min–max spread bar per entry; clicking a
row opens the full judge × criterion matrix with each judge's z adjustment.
**Export CSV** downloads the leaderboard plus the raw score matrix.

## Production on the Mac mini

```bash
npm run build     # builds client/dist
PORT=3000 npm start
```

The single Node process serves the SPA and API on one port. To keep it running
across reboots, either `npm install -g pm2 && pm2 start server/index.js --name voting`
or create a launchd plist pointing at `node server/index.js`. For access from
outside the LAN, put it behind a Cloudflare Tunnel or your reverse proxy of
choice; the app itself needs no extra configuration.

All state lives in `data/` (`voting.db` plus the session-secret file) — back it
up by copying that directory.

## Moving to AWS later

The app is a plain Node process with a SQLite file, so migration is a copy:

1. Provision a small EC2 instance (or Lightsail) with Node 22+.
2. Copy the repo and the `data/` directory (this preserves scores *and* keeps
   judges' sessions valid).
3. `npm install && npm run build && PORT=3000 npm start` behind nginx/ALB with
   HTTPS terminating at the proxy.

## Resetting for a new competition

```bash
npm run seed -- --reset
```

Wipes scores, judges, entries, and locks, and reloads `seed/competition.json`.
