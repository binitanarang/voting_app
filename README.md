# Competition Voting App

Judging app for internal competitions (AI Day, hackathons, …): judges score
entries 1–5 on the competition's criteria from their phones or laptops, and a
live dashboard shows weighted and z-score-normalized results with rankings.
Installable as a PWA; score submissions made offline are queued and synced
when the connection returns.

One server hosts any number of competitions in parallel. **A competition's URL
path is its data directory name:**

```
http://host:3000/ai-day-3        ↔  data/ai-day-3/
http://host:3000/uspb-hackathon  ↔  data/uspb-hackathon/
http://host:3000/                →  landing page listing competitions
```

- **Frontend:** Vite + React SPA styled with the Mara design system
  (`client/src/styles/mara.css`) — no CSS framework.
- **Backend:** Express + SQLite (Node's built-in `node:sqlite`, so there are no
  native-module builds). One process serves every competition and the SPA.
- **Auth:** employee ID + 4-digit PIN (scrypt-hashed), 7-day session cookie
  scoped to the competition's path, failed attempts rate-limited (5 per
  15 minutes per employee ID). Sessions, judges, and locks are fully isolated
  per competition.

## Quick start

```bash
npm install
npm run seed        # interactive: pick a seed config and a directory name
npm run dev         # API on :3000, Vite dev server on :5173 (proxies the API)
```

Then open `http://localhost:5173/<directory-name>/`.

Tests (score math — weighting, STANDARDIZE-style z-scores, sd=0 fallback,
tiebreaks): `npm test`

## Setting up a competition

Copy `seed/competition.json` to `seed/<competition>.json` and edit: the
competition `name` (shown in the app header and login page), category and
criterion names (any number of categories, each with its own judging panel),
per-category weights (percentages summing to 100), entries, and judges with
real employee IDs and PINs. Then run `npm run seed` — it asks which config to
load and which directory to use: reuse an existing one (wipe requires retyping
its name, and a safety export is taken first) or create a new one. The
directory name becomes the URL path, so it must be lowercase letters, digits,
and dashes (e.g. `ai-day-3`).

Non-interactive form:

```bash
npm run seed -- --config seed/uspb-hackathon.json --dir uspb-hackathon          # new
npm run seed -- --config seed/uspb-hackathon.json --dir uspb-hackathon --reset  # wipe + reseed
```

New competitions are served immediately — no restart needed. (Reseeding an
existing competition is also picked up automatically.)

After seeding, everything is editable in the admin UI: entries, judges, PIN
resets, criterion weights, and voting locks. Weights can change mid-event —
results are always computed from raw scores, so nothing goes stale.

## Automatic archives on lock

Whenever an admin **locks** voting (a category or globally), the server writes
two files into that competition's `data/<name>/exports/`:

- `results-lock-<scope>-<timestamp>.csv` — leaderboard plus the raw
  judge × criterion score matrix,
- `snapshot-lock-<scope>-<timestamp>.db` — a complete copy of the database at
  that moment.

The admin's browser also downloads the CSV. Re-locking archives again with a
fresh timestamp; the same archive pair is written automatically before any
reseed wipe (`pre-reseed`), and `node server/export-cli.js <name>` takes one
manually.

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
PORT=3000 npm start     # one process, every competition
```

Keep it running across reboots with `pm2 start server/index.js --name voting`
or a launchd plist. For access from outside the LAN, put the one port behind a
Cloudflare Tunnel or reverse proxy — judges get
`https://your-tunnel/ai-day-3`, `https://your-tunnel/uspb-hackathon`, etc.

Each `data/<name>/` directory is a self-contained competition (`voting.db`,
`session-secret`, `exports/`). Copying it is a full backup.

## Moving to AWS later

The app is a plain Node process with SQLite files, so migration is a copy:

1. Provision a small EC2 instance (or Lightsail) with Node 22+.
2. Copy the repo and the `data/` directory (preserves scores *and* keeps
   judges' sessions valid).
3. `npm install && npm run build && PORT=3000 npm start` behind nginx/ALB with
   HTTPS terminating at the proxy.

## Rounds (semi-finals → finals)

Rounds are sequential, so treat each as its own seeding of the same directory:
lock voting (auto-archives results + a DB snapshot), then reseed with the
finalist entries — the pre-reseed safety export preserves the previous round
again. Or give each round its own directory/URL (`--dir ai-day-3-finals`) to
keep every round live side by side.
