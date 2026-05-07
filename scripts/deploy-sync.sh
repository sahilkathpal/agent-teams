#!/bin/bash
# Scrape Otterly CSVs locally and upload to server.
#
# Usage: ./scripts/deploy-sync.sh
#
# Requires Chrome to be open and logged into app.otterly.ai.

set -e

cd "$(dirname "$0")/.."

SERVER="root@gtm.codeongrass.com"
REMOTE_DIR="/opt/agent-teams/data/otterly-exports"

echo "$(date): Starting Otterly sync..."

# Run the scraper locally
npm run sync

# Find the latest CSVs
LATEST_PROMPTS=$(ls -t data/otterly-exports/prompts-*.csv 2>/dev/null | head -1)
LATEST_CITATIONS=$(ls -t data/otterly-exports/citations-*.csv 2>/dev/null | head -1)

if [ -z "$LATEST_PROMPTS" ] || [ -z "$LATEST_CITATIONS" ]; then
  echo "Error: No CSV files found in data/otterly-exports/"
  exit 1
fi

echo "Uploading to server..."
echo "  $LATEST_PROMPTS"
echo "  $LATEST_CITATIONS"

ssh "$SERVER" "mkdir -p $REMOTE_DIR"
scp "$LATEST_PROMPTS" "$LATEST_CITATIONS" "$SERVER:$REMOTE_DIR/"

echo "$(date): Sync complete. CSVs uploaded to $SERVER:$REMOTE_DIR/"
echo ""
echo "To run the pipeline on the server:"
echo "  ssh $SERVER 'source /root/.nvm/nvm.sh && cd /opt/agent-teams && npm start -- --otterly ./data/otterly-exports'"
