#!/usr/bin/env npx tsx
/**
 * Print ledger statistics (read-only).
 * Usage: npx tsx src/tools/run-ledger-stats.ts
 *
 * Output: JSON with total entries, age distribution, and top sources.
 */
import { loadLedger } from "../meta/ledger.js";

const ledger = loadLedger();
const entries = Object.values(ledger);

const now = Date.now();
const ageBuckets = { last_24h: 0, last_7d: 0, last_30d: 0, older: 0 };
const sources: Record<string, number> = {};

for (const entry of entries) {
  const age = now - new Date(entry.last_seen).getTime();
  if (age < 24 * 60 * 60 * 1000) ageBuckets.last_24h++;
  else if (age < 7 * 24 * 60 * 60 * 1000) ageBuckets.last_7d++;
  else if (age < 30 * 24 * 60 * 60 * 1000) ageBuckets.last_30d++;
  else ageBuckets.older++;

  sources[entry.source] = (sources[entry.source] || 0) + 1;
}

console.log(JSON.stringify({
  total: entries.length,
  age_distribution: ageBuckets,
  by_source: sources,
}, null, 2));
