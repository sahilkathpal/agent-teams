import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import { upsertArticle } from "../db/helpers.js";
import type { ContentDraft } from "../models/content-draft.js";
import type { ContentPlan } from "../models/content-plan.js";
import "dotenv/config";

// ── Ghost JWT auth ──────────────────────────────────────────────────

function makeGhostJwt(adminKey: string): string {
  const [id, secret] = adminKey.split(":");
  if (!id || !secret) throw new Error("GHOST_ADMIN_KEY must be in id:secret format");

  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT", kid: id })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: "/admin/" })).toString("base64url");
  const signature = createHmac("sha256", Buffer.from(secret, "hex"))
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

function ghostApiBase(): string {
  return (process.env.GHOST_URL ?? "").replace(/\/+$/, "");
}

// ── Markdown → Lexical ──────────────────────────────────────────────

function markdownToLexical(markdown: string): string {
  const card = {
    root: {
      children: [
        {
          type: "markdown",
          version: 1,
          markdown,
        },
      ],
      direction: null,
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  };
  return JSON.stringify(card);
}

function stripLeadingH1(markdown: string): string {
  return markdown.replace(/^# .+\n+/, "");
}

function buildTags(draft: ContentDraft): Array<{ name: string }> {
  const tags: string[] = [];
  if (draft.format) tags.push(draft.format);
  tags.push("#pipeline");
  if (draft.intent_mode) tags.push(`#${draft.intent_mode.toLowerCase()}`);
  return tags.map((name) => ({ name }));
}

// ── Ghost API helpers ───────────────────────────────────────────────

/** Look up a Ghost post by slug, returns { id, updated_at } or null. */
async function findGhostPost(slug: string, jwt: string): Promise<{ id: string; updated_at: string } | null> {
  const url = `${ghostApiBase()}/api/admin/posts/slug/${slug}/`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Ghost ${jwt}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { posts: Array<{ id: string; updated_at: string }> };
    return data.posts[0] ?? null;
  } catch {
    return null;
  }
}

// ── Publisher output ────────────────────────────────────────────────

export interface PublisherOutput {
  plan_id: string;
  action: "created" | "updated";
  title: string;
  slug: string;
  ghost_post_id: string;
  ghost_post_url: string;
  status: string;
  created_at: string;
  tags: string[];
}

// ── Publisher agent ─────────────────────────────────────────────────

/**
 * Publisher agent — creates new Ghost drafts or updates existing published posts.
 */
export async function runPublisher(opts: {
  draft: ContentDraft;
  contentPlan?: ContentPlan;
  outPath: string;
}): Promise<PublisherOutput | null> {
  const ghostUrl = process.env.GHOST_URL;
  const ghostAdminKey = process.env.GHOST_ADMIN_KEY;

  if (!ghostUrl || !ghostAdminKey) {
    console.warn("[publisher] GHOST_URL or GHOST_ADMIN_KEY not set — skipping publish");
    return null;
  }

  const jwt = makeGhostJwt(ghostAdminKey);
  const cleanMarkdown = stripLeadingH1(opts.draft.markdown);
  const lexical = markdownToLexical(cleanMarkdown);
  const tags = buildTags(opts.draft);

  const isRefresh = opts.contentPlan?.action === "refresh" && opts.contentPlan?.refresh_target;

  if (isRefresh) {
    return await updateExistingPost(opts, jwt, lexical, tags);
  } else {
    return await createNewDraft(opts, jwt, lexical, tags);
  }
}

/** Create a new Ghost draft post. */
async function createNewDraft(
  opts: { draft: ContentDraft; outPath: string },
  jwt: string,
  lexical: string,
  tags: Array<{ name: string }>,
): Promise<PublisherOutput | null> {
  console.log(`[publisher] Creating new draft: "${opts.draft.title}"`);

  const apiUrl = `${ghostApiBase()}/api/admin/posts/`;
  const body = {
    posts: [{
      title: opts.draft.title,
      slug: opts.draft.slug,
      lexical,
      meta_description: opts.draft.meta_description,
      og_title: opts.draft.title,
      og_description: opts.draft.meta_description,
      twitter_title: opts.draft.title,
      twitter_description: opts.draft.meta_description,
      tags,
      status: "draft",
    }],
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Ghost ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[publisher] Ghost API error ${response.status}: ${errText.slice(0, 300)}`);
    return null;
  }

  const data = (await response.json()) as { posts: Array<{ id: string; url: string; slug: string }> };
  const post = data.posts[0];

  upsertArticle({
    slug: post.slug,
    url: post.url,
    title: opts.draft.title,
    published_at: new Date().toISOString(),
    format: opts.draft.format,
    geo_targets: opts.draft.geo_targets,
    status: "draft",
  });

  console.log(`  Draft created: ${post.url}`);
  console.log(`  Ghost ID: ${post.id}`);

  const output: PublisherOutput = {
    plan_id: opts.draft.plan_id,
    action: "created",
    title: opts.draft.title,
    slug: post.slug,
    ghost_post_id: post.id,
    ghost_post_url: post.url,
    status: "draft",
    created_at: new Date().toISOString(),
    tags: tags.map((t) => t.name),
  };

  writeFileSync(opts.outPath, JSON.stringify(output, null, 2));
  return output;
}

/** Update an existing published Ghost post in-place. */
async function updateExistingPost(
  opts: { draft: ContentDraft; contentPlan?: ContentPlan; outPath: string },
  jwt: string,
  lexical: string,
  tags: Array<{ name: string }>,
): Promise<PublisherOutput | null> {
  const slug = opts.contentPlan?.refresh_target?.slug ?? opts.draft.slug;
  console.log(`[publisher] Updating existing post: "${slug}"`);

  // Look up the existing post to get its ID and updated_at (required for PUT)
  const existing = await findGhostPost(slug, jwt);
  if (!existing) {
    console.warn(`[publisher] Could not find existing post with slug "${slug}" — falling back to new draft`);
    return await createNewDraft(opts, jwt, lexical, tags);
  }

  const apiUrl = `${ghostApiBase()}/api/admin/posts/${existing.id}/`;
  const updateTitle = opts.contentPlan?.refresh_target?.update_title === true;
  const postPayload: Record<string, unknown> = {
    lexical,
    meta_description: opts.draft.meta_description,
    og_description: opts.draft.meta_description,
    twitter_description: opts.draft.meta_description,
    tags,
    updated_at: existing.updated_at,
  };
  if (updateTitle) {
    postPayload.title = opts.draft.title;
    postPayload.og_title = opts.draft.title;
    postPayload.twitter_title = opts.draft.title;
  }
  const body = { posts: [postPayload] };

  const response = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      Authorization: `Ghost ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[publisher] Ghost update error ${response.status}: ${errText.slice(0, 300)}`);
    return null;
  }

  const data = (await response.json()) as { posts: Array<{ id: string; url: string; slug: string; status: string }> };
  const post = data.posts[0];

  upsertArticle({
    slug: post.slug,
    url: post.url,
    title: opts.draft.title,
    published_at: new Date().toISOString(),
    format: opts.draft.format,
    geo_targets: opts.draft.geo_targets,
    status: "published",
  });

  console.log(`  Post updated in-place: ${post.url}`);
  console.log(`  Status remains: ${post.status}`);

  const output: PublisherOutput = {
    plan_id: opts.draft.plan_id,
    action: "updated",
    title: opts.draft.title,
    slug: post.slug,
    ghost_post_id: post.id,
    ghost_post_url: post.url,
    status: post.status,
    created_at: new Date().toISOString(),
    tags: tags.map((t) => t.name),
  };

  writeFileSync(opts.outPath, JSON.stringify(output, null, 2));
  return output;
}
