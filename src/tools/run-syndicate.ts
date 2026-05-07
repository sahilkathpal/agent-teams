#!/usr/bin/env npx tsx
/**
 * CLI wrapper for the Distributor tool.
 * Usage: npx tsx src/tools/run-syndicate.ts <draft-json-path> <canonical-url> <playbook-json-path> <output-path>
 *
 * Syndicates content to Dev.to/Hashnode and outputs manual playbook items.
 */
import { readFileSync } from "node:fs";
import { initDb } from "../db/schema.js";
import { runDistributor } from "./distributor.js";
import "dotenv/config";

initDb();

const [draftPath, canonicalUrl, playbookPath, outPath] = process.argv.slice(2);
if (!draftPath || !canonicalUrl || !playbookPath || !outPath) {
  console.error("Usage: run-syndicate.ts <draft-json> <canonical-url> <playbook-json> <output-json>");
  process.exit(1);
}

const draft = JSON.parse(readFileSync(draftPath, "utf-8"));
const playbook = JSON.parse(readFileSync(playbookPath, "utf-8"));

await runDistributor({ draft, canonicalUrl, playbook, outPath });
