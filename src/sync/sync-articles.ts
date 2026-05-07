import { getDb, upsertArticle } from "../db/helpers.js";
import "dotenv/config";

interface GhostPost {
  slug: string;
  url: string;
  title: string;
  published_at: string;
  meta_description: string | null;
  custom_excerpt: string | null;
}

/**
 * Sync published articles from Ghost Content API into the articles table.
 * Preserves geo_targets and format for articles already in the DB (from pipeline runs).
 */
export async function syncArticles(): Promise<number> {
  const ghostUrl = process.env.GHOST_URL;
  const ghostContentKey = process.env.GHOST_CONTENT_KEY;

  if (!ghostUrl || !ghostContentKey) {
    console.warn("[sync-articles] GHOST_URL or GHOST_CONTENT_KEY not set — skipping");
    return 0;
  }

  const base = ghostUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/api/content/posts/`);
  url.searchParams.set("key", ghostContentKey);
  url.searchParams.set("limit", "all");
  url.searchParams.set("fields", "slug,url,title,published_at,meta_description,custom_excerpt");
  url.searchParams.set("order", "published_at desc");

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.warn(`[sync-articles] Ghost API error: ${res.status}`);
      return 0;
    }

    const data = (await res.json()) as { posts: GhostPost[] };
    const db = getDb();
    let synced = 0;

    for (const post of data.posts) {
      // Check if article already exists with geo_targets (from a pipeline run)
      const existing = db.prepare(
        "SELECT geo_targets, format FROM articles WHERE slug = ?",
      ).get(post.slug) as { geo_targets: string; format: string | null } | undefined;

      // Preserve geo_targets and format if already set by pipeline
      upsertArticle({
        slug: post.slug,
        url: post.url,
        title: post.title,
        published_at: post.published_at,
        format: existing?.format ?? undefined,
        geo_targets: existing?.geo_targets ? JSON.parse(existing.geo_targets) : undefined,
        status: "published",
      });
      synced++;
    }

    console.log(`[sync-articles] Synced ${synced} articles from Ghost`);
    return synced;
  } catch (err) {
    console.warn(`[sync-articles] Failed:`, err instanceof Error ? err.message : err);
    return 0;
  }
}

// Run directly
if (process.argv[1]?.endsWith("sync-articles.ts")) {
  import("../db/schema.js").then(({ initDb }) => {
    initDb();
    syncArticles();
  });
}
