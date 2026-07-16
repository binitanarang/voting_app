# Deploying voting_app (AWS container + Postgres)

The app is a single Node process serving the API and the built web app. On
the container it stores everything in Postgres — nothing needs a persistent
disk. (Without `DATABASE_URL` it falls back to local SQLite files; that mode
is for local dev, not the container.)

## Requirements

- Node 22.5+
- Network access from the container to the Postgres server
- A Postgres user that can create the `voting_app` database — or create the
  empty database beforehand and grant the user rights on it

## Configuration

One environment variable on the container:

```
DATABASE_URL=postgres://<user>:<password>@<postgres-host>:5432/voting_app
```

`PORT` is optional (default 3000).

## Deploy / start

From the repo root:

```bash
npm install
npm run build
npm run pg:setup        # creates database + tables; idempotent — run on every deploy
npm start               # logs "[postgres]" on startup
```

## One-time data load

First deploy only (or to reset an event — it wipes that competition's scores,
after writing a safety CSV export):

```bash
npm run seed -- --config data/seed/ai-day-3.json --reset
```

Each seed file in `data/seed/` is one competition; the file name is the URL
path (`ai-day-3.json` → `https://<host>/ai-day-3`).

## Exposure & health

- Put the one port behind your usual HTTPS proxy/ALB.
- Health check: `GET /api/competitions` returns JSON.

## Notes

- All scores/judges/settings live in Postgres (one schema per competition).
  The container's disk is only used for best-effort CSV archives in
  `data/<competition>/exports/` — treat the dashboard's results.csv download
  as the real archive.
- Seed JSONs in git are the source of truth for competition setup.
