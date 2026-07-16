#!/usr/bin/env bash
# One-shot smoke test of the Postgres backend:
#   creates the database + tables, seeds a competition, starts the server,
#   and checks login/ballot/results over HTTP. SQLite data/ is not touched
#   (the --reset only wipes the Postgres copy of the seeded competition).
#
# Usage:
#   scripts/pg-test.sh                          # uses data/seed/ai-day-3.json
#   scripts/pg-test.sh data/seed/other.json     # test a different competition
#   DATABASE_URL=postgres://... scripts/pg-test.sh   # non-local Postgres
set -euo pipefail
cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-postgres://localhost:5432/voting_app}"
SEED="${1:-data/seed/ai-day-3.json}"
COMP=$(basename "$SEED" .json)
PORT=3999

echo "1/4 Creating database + tables..."
npm run pg:setup --silent -- "$COMP"

echo "2/4 Seeding $COMP into Postgres..."
node server/seed.js --config "$SEED" --reset >/dev/null

echo "3/4 Starting server on :$PORT..."
PORT=$PORT node server/index.js >/tmp/pg-test-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 2
grep -q '\[postgres\]' /tmp/pg-test-server.log || { echo "FAIL: server did not start on postgres:"; cat /tmp/pg-test-server.log; exit 1; }

echo "4/4 Hitting the API..."
fail=0
check() { # label, expected substring, response
  if [[ "$3" == *"$2"* ]]; then echo "  ok: $1"; else echo "  FAIL: $1 — got: $3"; fail=1; fi
}

B="http://localhost:$PORT/$COMP/api"
JUDGE=$(node -e "console.log(require('./$SEED').judges[0].employeeId)")
PIN=$(node -e "const j=require('./$SEED').judges[0]; console.log(j.pin ?? j.employeeId)")
COOKIES=$(mktemp)
LOGIN_BODY=$(printf '{"employeeId":"%s","pin":"%s"}' "$JUDGE" "$PIN")

COMPETITIONS=$(curl -s "http://localhost:$PORT/api/competitions")
LOGIN=$(curl -s -c "$COOKIES" -X POST "$B/login" -H 'content-type: application/json' -d "$LOGIN_BODY")
BALLOT=$(curl -s -b "$COOKIES" "$B/ballot")
RESULTS=$(curl -s -b "$COOKIES" "$B/results")
rm -f "$COOKIES"

check "competition listed"   "\"$COMP\""   "$COMPETITIONS"
check "judge login ($JUDGE)" '"user"'      "$LOGIN"
check "ballot loads"         '"entries"'   "$BALLOT"
check "results load"         '"categories"' "$RESULTS"

echo
if [[ $fail == 0 ]]; then
  echo "PASS — Postgres backend works."
  echo "To click around yourself:  DATABASE_URL=$DATABASE_URL npm start   → http://localhost:3000/$COMP"
else
  echo "FAILED — see above."
  exit 1
fi
