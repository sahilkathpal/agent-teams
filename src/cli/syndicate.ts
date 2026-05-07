import { dequeue, queueLength, peekQueue } from "../syndication/queue.js";
import { syndicateToDevto, syndicateToHashnode } from "../tools/distributor.js";
import "dotenv/config";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Usage: npm run syndicate -- [options]

  (default)        Drain up to 2 items from the syndication queue
  --limit <n>      Drain up to n items (default: 2)
  --list           Show queue contents without draining
`);
  process.exit(0);
}

// ── List mode ──────────────────────────────────────────────────

if (args.includes("--list")) {
  const items = peekQueue();
  if (items.length === 0) {
    console.log("Syndication queue is empty.");
    process.exit(0);
  }

  console.log(`Syndication queue (${items.length} item(s)):\n`);
  for (const item of items) {
    console.log(`  ${item.article_slug}`);
    console.log(`    Title: ${item.title}`);
    console.log(`    URL: ${item.canonical_url}`);
    console.log(`    Platforms: ${item.platforms.join(", ") || "(none)"}`);
    console.log(`    Enqueued: ${item.enqueued_at}`);
    console.log();
  }
  process.exit(0);
}

// ── Drain mode ─────────────────────────────────────────────────

const limitIdx = args.indexOf("--limit");
const limit = limitIdx !== -1 && args[limitIdx + 1] ? Number(args[limitIdx + 1]) : 2;

const total = queueLength();
if (total === 0) {
  console.log("[syndicate] Queue is empty — nothing to publish.");
  process.exit(0);
}

console.log(`[syndicate] Queue has ${total} item(s) — draining up to ${limit}\n`);

const batch = dequeue(limit);

for (const item of batch) {
  console.log(`[syndicate] Processing: "${item.title}"`);

  const platforms = item.platforms ?? [];
  if (platforms.length === 0) {
    console.log(`  No platforms specified — skipping`);
    continue;
  }

  const tags = item.tags.slice(0, 4).map((t) => t.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20));

  // Dev.to
  if ((platforms.includes("devto") || platforms.includes("dev.to")) && process.env.DEVTO_API_KEY) {
    const result = await syndicateToDevto({
      title: item.title,
      markdown: item.markdown,
      canonicalUrl: item.canonical_url,
      tags,
      description: "",
    });
    if (result.status === "published") {
      console.log(`  Dev.to: ${result.url}`);
    } else {
      console.warn(`  Dev.to failed: ${result.error}`);
    }
  }

  // Hashnode
  if (platforms.includes("hashnode") && process.env.HASHNODE_PAT && process.env.HASHNODE_PUBLICATION_ID) {
    const result = await syndicateToHashnode({
      title: item.title,
      markdown: item.markdown,
      canonicalUrl: item.canonical_url,
      tags,
    });
    if (result.status === "published") {
      console.log(`  Hashnode: ${result.url}`);
    } else {
      console.warn(`  Hashnode failed: ${result.error}`);
    }
  }

  console.log();
}

const remaining = queueLength();
console.log(`[syndicate] Done. ${remaining} item(s) remaining in queue.`);
