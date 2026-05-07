#!/usr/bin/env npx tsx
/**
 * CLI wrapper for Hacker News Algolia search.
 * Usage: npx tsx src/tools/run-search-hn.ts <query> [--days-back <n>] [--max-results <n>]
 *
 * Prints JSON array of {title, url, points, num_comments, created_at, objectID} to stdout.
 */
import { searchHN } from "../sources/hackernews.js";

const args = process.argv.slice(2);

function extractFlag(flag: string, defaultVal: number): number {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) {
    const val = parseInt(args[idx + 1], 10);
    args.splice(idx, 2);
    return val;
  }
  return defaultVal;
}

const daysBack = extractFlag("--days-back", 7);
const hitsPerPage = extractFlag("--max-results", 15);

const query = args.join(" ");
if (!query) {
  console.error("Usage: run-search-hn.ts <query> [--days-back <n>] [--max-results <n>]");
  process.exit(1);
}

const results = await searchHN(query, { daysBack, hitsPerPage, sortByDate: false });
console.log(JSON.stringify(results, null, 2));
