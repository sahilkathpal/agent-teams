import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import "dotenv/config";

const STATIC_DIR = process.env.LLMS_TXT_DIR ?? "/var/www/codeongrass-static";

interface GhostPost {
  title: string;
  slug: string;
  url: string;
  published_at: string;
  meta_description: string | null;
  custom_excerpt: string | null;
  plaintext: string | null;
}

async function fetchAllPosts(fields: string, formats?: string): Promise<GhostPost[]> {
  const ghostUrl = process.env.GHOST_URL;
  const ghostContentKey = process.env.GHOST_CONTENT_KEY;
  if (!ghostUrl || !ghostContentKey) throw new Error("GHOST_URL and GHOST_CONTENT_KEY required");

  const base = ghostUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/api/content/posts/`);
  url.searchParams.set("key", ghostContentKey);
  url.searchParams.set("limit", "all");
  url.searchParams.set("fields", fields);
  if (formats) url.searchParams.set("formats", formats);
  url.searchParams.set("order", "published_at desc");

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Ghost API error: ${res.status}`);

  const data = (await res.json()) as { posts: GhostPost[] };
  return data.posts;
}

/** Generate llms.txt — lightweight index of all articles. */
export async function generateLlmsTxt(): Promise<string> {
  const domain = process.env.SITE_DOMAIN ?? "codeongrass.com";
  const posts = await fetchAllPosts("title,slug,url,published_at,meta_description,custom_excerpt");

  const lines: string[] = [
    `# ${domain}`,
    "",
    "> Technical guides and analysis for AI coding agents — mobile access, session management, multi-agent orchestration, and GEO optimization.",
    "",
  ];

  for (const post of posts) {
    const desc = post.custom_excerpt ?? post.meta_description ?? "";
    lines.push(`- [${post.title}](${post.url}): ${desc}`);
  }

  return lines.join("\n") + "\n";
}

/** Generate llms-full.txt — full article content for each post. */
export async function generateLlmsFullTxt(): Promise<string> {
  const domain = process.env.SITE_DOMAIN ?? "codeongrass.com";
  const posts = await fetchAllPosts("title,slug,url,published_at,meta_description,custom_excerpt", "plaintext");

  const sections: string[] = [
    `# ${domain} — Full Content`,
    "",
    "> Complete article content for AI consumption.",
    "",
  ];

  for (const post of posts) {
    const desc = post.custom_excerpt ?? post.meta_description ?? "";
    sections.push(`---`);
    sections.push(`## ${post.title}`);
    sections.push(`URL: ${post.url}`);
    if (desc) sections.push(`Description: ${desc}`);
    sections.push(`Published: ${post.published_at}`);
    sections.push("");
    sections.push(post.plaintext ?? "(no content)");
    sections.push("");
  }

  return sections.join("\n") + "\n";
}

/** Write llms.txt and llms-full.txt to the static directory. */
export function writeLlmsFiles(llmsTxt: string, llmsFullTxt: string, dir: string = STATIC_DIR): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "llms.txt"), llmsTxt);
  writeFileSync(resolve(dir, "llms-full.txt"), llmsFullTxt);
}

// ── CLI entrypoint ──────────────────────────────────────────────

if (process.argv[1]?.endsWith("generate-llms-txt.ts")) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  console.log("[llms-txt] Generating llms.txt...");
  const llmsTxt = await generateLlmsTxt();
  console.log(`  ${llmsTxt.split("\n").length} lines`);

  console.log("[llms-txt] Generating llms-full.txt...");
  const llmsFullTxt = await generateLlmsFullTxt();
  console.log(`  ${llmsFullTxt.split("\n").length} lines, ${Math.round(llmsFullTxt.length / 1024)}KB`);

  if (dryRun) {
    console.log("\n[llms-txt] Dry run — not writing. Preview (llms.txt first 20 lines):");
    console.log(llmsTxt.split("\n").slice(0, 20).join("\n"));
  } else {
    const dir = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : STATIC_DIR;
    console.log(`[llms-txt] Writing to ${dir}...`);
    writeLlmsFiles(llmsTxt, llmsFullTxt, dir);
    console.log(`  ${dir}/llms.txt`);
    console.log(`  ${dir}/llms-full.txt`);
  }
}
