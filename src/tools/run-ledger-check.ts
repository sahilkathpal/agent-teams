#!/usr/bin/env npx tsx
/**
 * Check URL freshness against the seen-URLs ledger (read-only).
 * Usage: npx tsx src/tools/run-ledger-check.ts '<json-array>'
 *
 * Input: JSON array of [{ "url": "...", "score": 42, "num_comments": 10 }, ...]
 * Output: JSON with freshness classification for each URL + summary counts.
 *
 * Does NOT update the ledger — use run-ledger-update.ts to record URLs.
 */
import { loadLedger, classifyUrl } from "../meta/ledger.js";

const input = process.argv[2];
if (!input) {
  console.error('Usage: run-ledger-check.ts \'[{"url":"...","score":42,"num_comments":10},...]\'');
  process.exit(1);
}

let urls: Array<{ url: string; score?: number; num_comments?: number }>;
try {
  urls = JSON.parse(input);
} catch {
  console.error("Error: input must be a valid JSON array");
  process.exit(1);
}

const ledger = loadLedger();

const results = urls.map((item) => {
  const freshness = classifyUrl(item.url, ledger, item.score, item.num_comments);
  const entry = ledger[item.url];
  return {
    url: item.url,
    freshness,
    ...(entry?.first_seen ? { first_seen: entry.first_seen } : {}),
  };
});

const summary = { new: 0, resurfaced: 0, recurring: 0 };
for (const r of results) {
  summary[r.freshness]++;
}

console.log(JSON.stringify({ results, summary }, null, 2));
