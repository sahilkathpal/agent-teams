#!/usr/bin/env npx tsx
/**
 * CLI wrapper for Parallel Web search.
 * Usage: npx tsx src/tools/run-search-web.ts "<query>" [--max-results <n>] [--include-domains <d1,d2>] [--exclude-domains <d1,d2>] [--after-date <YYYY-MM-DD>]
 *
 * Prints JSON array of {url, title, domain, excerpts} to stdout.
 */
import { searchWeb } from "../sources/parallel-search.js";
import "dotenv/config";

const args = process.argv.slice(2);

function extractFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) {
    const val = args[idx + 1];
    args.splice(idx, 2);
    return val;
  }
  return undefined;
}

const maxResultsStr = extractFlag("--max-results");
const maxResults = maxResultsStr ? parseInt(maxResultsStr, 10) : 10;

const includeDomainsStr = extractFlag("--include-domains");
const includeDomains = includeDomainsStr ? includeDomainsStr.split(",").map((d) => d.trim()) : undefined;

const excludeDomainsStr = extractFlag("--exclude-domains");
const excludeDomains = excludeDomainsStr ? excludeDomainsStr.split(",").map((d) => d.trim()) : undefined;

const afterDate = extractFlag("--after-date");

const query = args.join(" ");
if (!query) {
  console.error(
    "Usage: run-search-web.ts \"<query>\" [--max-results <n>] [--include-domains <d1,d2>] [--exclude-domains <d1,d2>] [--after-date <YYYY-MM-DD>]",
  );
  process.exit(1);
}

const results = await searchWeb(query, { maxResults, includeDomains, excludeDomains, afterDate });
console.log(JSON.stringify(results, null, 2));
