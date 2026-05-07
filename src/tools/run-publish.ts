#!/usr/bin/env npx tsx
/**
 * CLI wrapper for the Publisher tool.
 * Usage: npx tsx src/tools/run-publish.ts <draft-json-path> <output-path> [--refresh-slug <slug>]
 *
 * Creates a Ghost draft (or updates existing post if --refresh-slug provided).
 * Prints the Ghost URL on success.
 */
import { readFileSync } from "node:fs";
import { initDb } from "../db/schema.js";
import { runPublisher } from "./publisher.js";
import "dotenv/config";

initDb();

const args = process.argv.slice(2);
const draftPath = args[0];
const outPath = args[1];

if (!draftPath || !outPath) {
  console.error("Usage: run-publish.ts <draft-json> <output-json> [--refresh-slug <slug>]");
  process.exit(1);
}

const refreshIdx = args.indexOf("--refresh-slug");
const refreshSlug = refreshIdx !== -1 ? args[refreshIdx + 1] : undefined;

const draft = JSON.parse(readFileSync(draftPath, "utf-8"));

const contentPlan = refreshSlug
  ? { action: "refresh" as const, refresh_target: { slug: refreshSlug, url: "", reason: "" } } as any
  : undefined;

const result = await runPublisher({ draft, contentPlan, outPath });

if (!result) {
  console.error("Publishing failed");
  process.exit(1);
}

console.log(result.ghost_post_url);
