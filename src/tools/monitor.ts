import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseCitationsCsv, parsePromptsCsv } from "../sources/otterly.js";
import { getDb, upsertPrompt, upsertCitation, upsertCompetitor, slugFromUrl } from "../db/helpers.js";
import { runScorer } from "./scorer.js";
import type { CitationScorecard } from "../models/citation-scorecard.js";

const DOMAIN = process.env.SITE_DOMAIN ?? "codeongrass.com";

/**
 * Monitor agent — ingests Otterly CSV data into SQLite, then runs the scorer.
 * This is the entry point for the feedback loop.
 */
export async function runMonitor(otterlyDir: string): Promise<CitationScorecard> {
  console.log(`[monitor] Ingesting Otterly data from ${otterlyDir}`);

  const files = readdirSync(otterlyDir);

  // Find prompts and citations CSVs
  const promptFiles = files.filter((f) => f.includes("prompts") && f.endsWith(".csv"));
  const citationFiles = files.filter((f) => f.includes("citations") && f.endsWith(".csv"));

  console.log(`  Found ${promptFiles.length} prompt files, ${citationFiles.length} citation files`);

  // Ingest prompts
  for (const file of promptFiles) {
    const rows = parsePromptsCsv(resolve(otterlyDir, file));
    console.log(`  Ingesting ${rows.length} prompts from ${file}`);

    for (const row of rows) {
      // Determine which engines track this prompt based on the file name or data
      const engines = Object.keys(row.competitors).length > 0
        ? ["chatgpt", "perplexity", "copilot", "google_aio"]
        : [];
      upsertPrompt(row.prompt, engines, row.intent_volume_monthly);

      // Ingest competitors
      for (const [name] of Object.entries(row.competitors)) {
        upsertCompetitor(name);
      }
    }
  }

  // Ingest citations
  let citationsIngested = 0;
  for (const file of citationFiles) {
    const rows = parseCitationsCsv(resolve(otterlyDir, file));
    console.log(`  Ingesting ${rows.length} citations from ${file}`);

    for (const row of rows) {
      const promptId = upsertPrompt(row.prompt, [row.service]);
      const articleSlug = slugFromUrl(row.url, DOMAIN);

      upsertCitation({
        prompt_id: promptId,
        engine: row.service,
        url: row.url,
        position: row.position,
        date: row.date,
        domain: row.domain,
        article_slug: articleSlug,
        brand_mentioned: row.my_brand_mentioned ? 1 : 0,
        competitors_mentioned: row.competitors_mentioned,
      });
      citationsIngested++;
    }
  }

  console.log(`  Total citations ingested: ${citationsIngested}`);

  // Run scorer to compute metrics
  console.log(`\n[monitor] Computing scorecard...`);
  const scorecard = await runScorer();

  return scorecard;
}
