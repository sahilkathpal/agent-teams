/**
 * Nightly job — runs after daily Otterly sync.
 *
 * 1. Drain the syndication queue (publish to dev.to, hashnode)
 * 2. Generate and write llms.txt + llms-full.txt to static dir
 *
 * Schedule with cron (after daily-sync.sh):
 *   30 6 * * * cd /path/to/agent-teams && npx tsx scripts/nightly.ts >> data/logs/nightly.log 2>&1
 */

import { dequeue, queueLength } from "../src/syndication/queue.js";
import { syndicateToDevto, syndicateToHashnode } from "../src/tools/distributor.js";
import { generateLlmsTxt, generateLlmsFullTxt, writeLlmsFiles } from "../src/sync/generate-llms-txt.js";
import "dotenv/config";

const SYNDICATE_BATCH_SIZE = 5;

// ── 1. Drain syndication queue ──────────────────────────────────

async function drainSyndicationQueue(): Promise<void> {
  const total = queueLength();
  if (total === 0) {
    console.log("[nightly] Syndication queue empty — nothing to drain.");
    return;
  }

  console.log(`[nightly] Draining syndication queue (${total} item(s))...`);
  const batch = dequeue(SYNDICATE_BATCH_SIZE);

  for (const item of batch) {
    console.log(`  Processing: "${item.title}"`);
    const platforms = item.platforms ?? [];

    if (platforms.length === 0) {
      console.log(`    No platforms — skipping`);
      continue;
    }

    const tags = item.tags.slice(0, 4).map((t) => t.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20));

    if ((platforms.includes("devto") || platforms.includes("dev.to")) && process.env.DEVTO_API_KEY) {
      const result = await syndicateToDevto({
        title: item.title,
        markdown: item.markdown,
        canonicalUrl: item.canonical_url,
        tags,
        description: "",
      });
      console.log(result.status === "published" ? `    Dev.to: ${result.url}` : `    Dev.to failed: ${result.error}`);
    }

    if (platforms.includes("hashnode") && process.env.HASHNODE_PAT && process.env.HASHNODE_PUBLICATION_ID) {
      const result = await syndicateToHashnode({
        title: item.title,
        markdown: item.markdown,
        canonicalUrl: item.canonical_url,
        tags,
      });
      console.log(result.status === "published" ? `    Hashnode: ${result.url}` : `    Hashnode failed: ${result.error}`);
    }
  }

  const remaining = queueLength();
  console.log(`[nightly] Syndication done. ${remaining} item(s) remaining.`);
}

// ── 2. Generate & write llms.txt ────────────────────────────────

async function updateLlmsTxt(): Promise<void> {
  const dir = process.env.LLMS_TXT_DIR ?? "/var/www/codeongrass-static";

  console.log("[nightly] Generating llms.txt...");
  const llmsTxt = await generateLlmsTxt();
  console.log(`  ${llmsTxt.split("\n").length} lines`);

  console.log("[nightly] Generating llms-full.txt...");
  const llmsFullTxt = await generateLlmsFullTxt();
  console.log(`  ${llmsFullTxt.split("\n").length} lines, ${Math.round(llmsFullTxt.length / 1024)}KB`);

  console.log(`[nightly] Writing to ${dir}...`);
  writeLlmsFiles(llmsTxt, llmsFullTxt, dir);
  console.log(`  ${dir}/llms.txt`);
  console.log(`  ${dir}/llms-full.txt`);
}

// ── Main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n[nightly] ${new Date().toISOString()}\n`);

  try {
    await drainSyndicationQueue();
  } catch (err) {
    console.error(`[nightly] Syndication failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    await updateLlmsTxt();
  } catch (err) {
    console.error(`[nightly] llms.txt failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log(`\n[nightly] Done.`);
}

main().catch((err) => {
  console.error("[nightly] Fatal:", err);
  process.exit(1);
});
