#!/usr/bin/env bash
# Starts the app on SQLite (the data/<competition>/voting.db files).
set -euo pipefail
cd "$(dirname "$0")/.."

unset DATABASE_URL   # no DATABASE_URL = SQLite
npm start
