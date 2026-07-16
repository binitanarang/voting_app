#!/usr/bin/env bash
# Starts the app on Postgres. Uses your local Postgres unless a DATABASE_URL
# is already set (e.g. the office AWS one):
#   scripts/start-postgres.sh
#   DATABASE_URL=postgres://user:pass@host:5432/voting_app scripts/start-postgres.sh
set -euo pipefail
cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-postgres://localhost:5432/voting_app}"

# Make sure the database and tables exist (idempotent, quick).
npm run pg:setup --silent

# Remind if Postgres has no data yet.
echo "Tip: to (re)load a competition into Postgres:"
echo "  DATABASE_URL=$DATABASE_URL npm run seed -- --config data/seed/ai-day-3.json --reset"
echo

npm start
