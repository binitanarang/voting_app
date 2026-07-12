# Competition Voting App

Judging app for internal competitions (AI Day, hackathons, …): judges score
entries 1–5 on the competition's criteria from their phones or laptops, and a
live dashboard shows weighted and z-score-normalized results with rankings.
Installable as a PWA; score submissions made offline are queued and synced
when the connection returns. Multiple competitions can run in parallel, each
with its own URL and isolated database.

- **Frontend:** Vite + React SPA styled with the Mara design system
  (`client/src/styles/mara.css`) — no CSS framework.
- **Backend:** Express + SQLite (Node's built-in `node:sqlite`, so there are no
  native-module builds). One process per competition serves both API and SPA.
- **Auth:** employee ID + 4-digit PIN (scrypt-hashed), 7-day session cookie,
  failed attempts rate-limited (5 per 15 minutes per employee ID).

## Quick start

```bash
npm install
npm run seed        # interactive: pick a seed config and a data directory
npm run dev         # API on :3000, Vite dev server on :5173 (proxies /api)
```

Tests (score math — weighting, STANDARDIZE-style z-scores, sd=0 fallback,
tiebreaks): `npm test`

## Competitions and data directories

Each competition = one seed config + one data directory + one server process:

```
seed/competition.json        →  data/default/         →  port 3000
seed/uspb-hackathon.json     →  data/uspb-hackathon/  →  port 3001
```

A data directory is self-contained: `voting.db` (the SQLite database — judges
with hashed PINs, entries, weights, every score), `session-secret` (signs login
cookies), and `exports/` (archives, see below). Copying the directory is a full
backup of that competition.

### Setting up a competition

Copy `seed/competition.json` to `seed/<competition>.json` and edit: the
competition `name` (shown in the app header and login page), category and
criterion names (any number of categories, each with its own judging panel),
per-category weights (percentages summing to 100), entries, and judges with
real employee IDs and PINs. Then run `npm run seed` — it asks which config to
load and whether to reuse an existing data directory (wipe requires retyping
its name, and a safety export is taken first) or create a new one.

Non-interactive form:

```bash
npm run seed -- --config seed/uspb-hackathon.json --dir uspb-hackathon          # new dir
npm run seed -- --config seed/uspb-hackathon.json --dir uspb-hackathon --reset  # wipe + reseed
```

After seeding, everything is editable in the admin UI: entries, judges, PIN
resets, criterion weights, and voting locks. Weights can change mid-event —
results are always computed from raw scores, so nothing goes stale.

### Running one or several

```bash
npm run build                              # build the SPA once (shared by all)
node scripts/start.mjs default 3000        # AI Day 3
node scripts/start.mjs uspb-hackathon 3001 # USPB Analyst Hackathon, in parallel
```

(`DATA_DIR=data/<name> PORT=<port> npm start` does the same thing.) Judges of
each competition use that instance's URL; databases, sessions, and locks are
fully isolated.

## Automatic archives on lock

Whenever an admin **locks** voting (a category or globally), the server writes
two files into that competition's `data/<name>/exports/`:

- `results-lock-<scope>-<timestamp>.csv` — leaderboard plus the raw
  judge × criterion score matrix,
- `snapshot-lock-<scope>-<timestamp>.db` — a complete copy of the database at
  that moment.

The admin's browser also downloads the CSV. Re-locking archives again with a
fresh timestamp; the same archive pair is written automatically before any
reseed wipe (`pre-reseed`), and `DATA_DIR=data/<name> node server/export-cli.js`
takes one manually.

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

## Production on the Mac mini

```bash
npm run build
node scripts/start.mjs default 3000
```

To keep instances running across reboots, use `pm2`
(`pm2 start scripts/start.mjs --name ai-day-3 -- default 3000`) or a launchd
plist per competition. For access from outside the LAN, put the ports behind a
Cloudflare Tunnel or reverse proxy; the app needs no extra configuration.

## Moving to AWS later

The app is a plain Node process with SQLite files, so migration is a copy:

1. Provision a small EC2 instance (or Lightsail) with Node 22+.
2. Copy the repo and the `data/` directory (preserves scores *and* keeps
   judges' sessions valid).
3. `npm install && npm run build`, then start each competition behind
   nginx/ALB with HTTPS terminating at the proxy.

## Rounds (semi-finals → finals)

Rounds are sequential, so treat each as its own seeding of the same directory:
lock voting (auto-archives results + a DB snapshot), then reseed with the
finalist entries — the pre-reseed safety export preserves the previous round
again. Or give each round its own directory (`--dir ai-day-3-finals`) to keep
every round live side by side.
