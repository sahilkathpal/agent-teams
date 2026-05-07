#!/usr/bin/env npx tsx
/**
 * CLI wrapper for content extraction via Parallel API.
 * Usage: npx tsx src/tools/run-extract.ts "<url1>" ["<url2>" ...] [--objective "<text>"]
 *
 * Prints JSON array of {url, title, publish_date, excerpts} to stdout.
 * Max 20 URLs per call. On error, prints [] and exits 0.
 */
import { extractContent } from "../sources/parallel-search.js";
import "dotenv/config";

const args = process.argv.slice(2);

const objectiveIdx = args.indexOf("--objective");
let objective: string | undefined;
if (objectiveIdx !== -1 && args[objectiveIdx + 1]) {
  objective = args[objectiveIdx + 1];
  args.splice(objectiveIdx, 2);
}

const urls = args.slice(0, 20);

if (urls.length === 0) {
  console.error("Usage: run-extract.ts <url1> [url2 ...] [--objective <text>]");
  process.exit(1);
}

try {
  const results = await extractContent(urls, { objective });
  console.log(JSON.stringify(results, null, 2));
} catch {
  console.log("[]");
}
