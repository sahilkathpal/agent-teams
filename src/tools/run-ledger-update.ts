#!/usr/bin/env npx tsx
/**
 * Record URLs into the seen-URLs ledger.
 * Usage: npx tsx src/tools/run-ledger-update.ts '<json-array>'
 *
 * Input: JSON array of [{ "url": "...", "score": 42, "num_comments": 10, "source": "hn" }, ...]
 * Output: JSON summary of what was added/updated.
 *
 * Use this after checking freshness to persist the URLs you want to track.
 */
import { loadLedger, saveLedger, updateLedger, normalizeUrl } from "../meta/ledger.js";

const input = process.argv[2];
if (!input) {
  console.error('Usage: run-ledger-update.ts \'[{"url":"...","score":42,"source":"hn"},...]\'');
  process.exit(1);
}

let urls: Array<{ url: string; score?: number; num_comments?: number; source: string }>;
try {
  urls = JSON.parse(input);
} catch {
  console.error("Error: input must be a valid JSON array");
  process.exit(1);
}

const ledger = loadLedger();
const sizeBefore = Object.keys(ledger).length;

// Count new vs updated
let added = 0;
let updated = 0;
for (const item of urls) {
  const key = normalizeUrl(item.url);
  if (ledger[key]) updated++;
  else added++;
}

updateLedger(ledger, urls);
saveLedger(ledger);

console.log(JSON.stringify({ added, updated, total: Object.keys(ledger).length }, null, 2));
