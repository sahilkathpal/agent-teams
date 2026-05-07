import { parsePromptsCsv, parseCitationsCsv } from "../sources/otterly.js";
import { getDb, upsertPrompt, upsertCitation, slugFromUrl, upsertCompetitor } from "../db/helpers.js";

const OTTERLY_ENGINES = ["chatgpt", "perplexity", "google_aio", "copilot"];
const DOMAIN = process.env.SITE_DOMAIN ?? "codeongrass.com";

/**
 * Sync Otterly CSV exports into SQLite.
 */
export async function syncOtterly(opts: {
  promptsCsv?: string;
  citationsCsv?: string;
}): Promise<{ promptsIngested: number; citationsIngested: number }> {
  const db = getDb();
  let promptsIngested = 0;
  let citationsIngested = 0;

  // Sync prompts
  if (opts.promptsCsv) {
    console.log(`[sync-otterly] Parsing prompts CSV: ${opts.promptsCsv}`);
    const prompts = parsePromptsCsv(opts.promptsCsv);
    console.log(`  Found ${prompts.length} prompt rows`);

    for (const row of prompts) {
      upsertPrompt(row.prompt, OTTERLY_ENGINES, row.intent_volume_monthly);
      promptsIngested++;

      for (const name of Object.keys(row.competitors)) {
        upsertCompetitor(name);
      }
    }
    console.log(`  Upserted ${promptsIngested} prompts`);
  }

  // Sync citations
  if (opts.citationsCsv) {
    console.log(`[sync-otterly] Parsing citations CSV: ${opts.citationsCsv}`);
    const citations = parseCitationsCsv(opts.citationsCsv);
    console.log(`  Found ${citations.length} citation rows`);

    for (const row of citations) {
      const promptRow = db.prepare(
        "SELECT prompt_id FROM prompts WHERE prompt_text = ?",
      ).get(row.prompt) as { prompt_id: number } | undefined;

      if (!promptRow) {
        // Auto-create prompt if not found (citation references an untracked prompt)
        const promptId = upsertPrompt(row.prompt, [row.service]);
        upsertCitation({
          prompt_id: promptId,
          engine: row.service,
          url: row.url,
          position: row.position,
          date: row.date,
          domain: row.domain,
          article_slug: slugFromUrl(row.url, DOMAIN),
          brand_mentioned: row.my_brand_mentioned ? 1 : 0,
          competitors_mentioned: row.competitors_mentioned,
        });
      } else {
        upsertCitation({
          prompt_id: promptRow.prompt_id,
          engine: row.service,
          url: row.url,
          position: row.position,
          date: row.date,
          domain: row.domain,
          article_slug: slugFromUrl(row.url, DOMAIN),
          brand_mentioned: row.my_brand_mentioned ? 1 : 0,
          competitors_mentioned: row.competitors_mentioned,
        });
      }
      citationsIngested++;
    }
    console.log(`  Upserted ${citationsIngested} citations`);
  }

  // Summary
  const promptTotal = db.prepare("SELECT count(*) as n FROM prompts").get() as { n: number };
  const citationTotal = db.prepare("SELECT count(*) as n FROM citations").get() as { n: number };
  console.log(`[sync-otterly] DB totals: ${promptTotal.n} prompts, ${citationTotal.n} citations`);

  return { promptsIngested, citationsIngested };
}
