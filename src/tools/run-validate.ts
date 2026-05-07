#!/usr/bin/env npx tsx
/**
 * CLI wrapper for the Validator tool.
 * Usage: npx tsx src/tools/run-validate.ts <draft-json-path> <product-context-path> <output-path>
 *
 * Reads a ContentDraft JSON, validates it, writes ValidationResult JSON.
 * Exit code 0 = approved, exit code 1 = rejected, exit code 2 = error.
 */
import { readFileSync } from "node:fs";
import { initDb } from "../db/schema.js";
import { runValidator } from "./validator.js";
import "dotenv/config";

initDb();

const [draftPath, contextPath, outPath] = process.argv.slice(2);
if (!draftPath || !outPath) {
  console.error("Usage: run-validate.ts <draft-json> <context-file> <output-json>");
  process.exit(2);
}

const draft = JSON.parse(readFileSync(draftPath, "utf-8"));
const productContext = contextPath ? readFileSync(contextPath, "utf-8") : "";

const result = await runValidator({ draft, productContext, outPath });

if (!result) {
  console.error("Validation failed to produce output");
  process.exit(2);
}

if (result.verdict === "rejected") {
  process.exit(1);
}
