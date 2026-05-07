import { getDb } from "../db/helpers.js";
import "dotenv/config";

interface GhostPost {
  title: string;
  slug: string;
  url: string;
  published_at: string;
  meta_description: string | null;
  custom_excerpt: string | null;
}

interface GhostResponse {
  posts: GhostPost[];
}

/**
 * Fetch the published post index from Ghost Content API,
 * enriched with geo_targets and format from the local DB.
 * Returns a compact markdown list suitable for injection into agent prompts.
 */
export async function fetchBlogIndex(): Promise<string> {
  const ghostUrl = process.env.GHOST_URL;
  const ghostContentKey = process.env.GHOST_CONTENT_KEY;

  if (!ghostUrl || !ghostContentKey) {
    console.warn("  [blog-index] GHOST_URL or GHOST_CONTENT_KEY not set — skipping blog index");
    return "";
  }

  const base = ghostUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/api/content/posts/`);
  url.searchParams.set("key", ghostContentKey);
  url.searchParams.set("limit", "all");
  url.searchParams.set("fields", "title,slug,url,published_at,meta_description,custom_excerpt");
  url.searchParams.set("order", "published_at desc");

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.warn(`  [blog-index] Ghost Content API error: ${res.status}`);
      return "";
    }

    const data = (await res.json()) as GhostResponse;
    const posts = data.posts;

    if (posts.length === 0) return "";

    console.log(`  [blog-index] ${posts.length} published posts loaded`);

    // Enrich with geo_targets and format from local DB
    let db: ReturnType<typeof getDb> | null = null;
    try { db = getDb(); } catch { /* DB not initialized yet */ }

    const lines = posts.map((p) => {
      const excerpt = p.custom_excerpt ?? p.meta_description ?? "";
      let line = excerpt ? `- [${p.title}](${p.url}) — ${excerpt}` : `- [${p.title}](${p.url})`;

      if (db) {
        const article = db.prepare(
          "SELECT geo_targets, format FROM articles WHERE slug = ?",
        ).get(p.slug) as { geo_targets: string; format: string | null } | undefined;

        if (article) {
          const geoTargets = JSON.parse(article.geo_targets || "[]") as string[];
          if (geoTargets.length > 0 || article.format) {
            const parts: string[] = [];
            if (article.format) parts.push(`format: ${article.format}`);
            if (geoTargets.length > 0) parts.push(`geo_targets: ${JSON.stringify(geoTargets)}`);
            line += ` | ${parts.join(" | ")}`;
          }
        }
      }

      return line;
    });

    return lines.join("\n");
  } catch (err) {
    console.warn(`  [blog-index] Failed to fetch:`, err instanceof Error ? err.message : err);
    return "";
  }
}

/**
 * Fetch a single article's content from Ghost Content API by slug.
 * Returns the plaintext/HTML content, or null if not found.
 */
export async function fetchArticleContent(slug: string): Promise<string | null> {
  const ghostUrl = process.env.GHOST_URL;
  const ghostContentKey = process.env.GHOST_CONTENT_KEY;

  if (!ghostUrl || !ghostContentKey) return null;

  const base = ghostUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/api/content/posts/slug/${slug}/`);
  url.searchParams.set("key", ghostContentKey);
  url.searchParams.set("formats", "plaintext");

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;

    const data = (await res.json()) as { posts: Array<{ plaintext: string | null }> };
    return data.posts[0]?.plaintext ?? null;
  } catch {
    return null;
  }
}
