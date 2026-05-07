#!/bin/bash
# Daily Otterly sync — downloads CSVs and ingests into DB.
# Requires Chrome to be open and logged into app.otterly.ai.
#
# Schedule with cron:
#   0 6 * * * cd /path/to/agent-teams && ./scripts/daily-sync.sh >> data/logs/sync.log 2>&1

set -e

cd "$(dirname "$0")/.."

echo "$(date): Starting daily Otterly sync"

# Ensure Chrome is running (macOS)
if [[ "$OSTYPE" == "darwin"* ]]; then
  open -a "Google Chrome" 2>/dev/null || true
  sleep 2
fi

# Run full sync (scrape + ingest)
npx tsx src/cli/sync.ts

echo "$(date): Daily sync complete"
