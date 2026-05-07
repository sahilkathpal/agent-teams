import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { enqueue } from "./syndication/queue.js";
import { getDb } from "./db/helpers.js";
import { initDb } from "./db/schema.js";
import type { ContentDraft } from "./models/content-draft.js";
import "dotenv/config";

const MAX_BODY_SIZE = 1024 * 1024;
const PORT = Number(process.env.WEBHOOK_PORT ?? "3847");
const RUNS_DIR = resolve(import.meta.dirname, "../data/runs");

interface PublisherOutput {
  plan_id: string;
  action: string;
  title: string;
  slug: string;
  ghost_post_id: string;
  ghost_post_url: string;
  status: string;
  tags: string[];
}

// ── Helpers ─────────────────────────────────────────────────────

function collectBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function verifyGhostSignature(body: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;

  const shaMatch = header.match(/sha256=([0-9a-f]+)/);
  const tMatch = header.match(/t=(\d+)/);
  if (!shaMatch || !tMatch) return false;

  const expectedHex = shaMatch[1];
  const timestamp = Number(tMatch[1]);

  // Replay guard: reject if timestamp is more than 5 minutes off
  if (Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
    console.warn("[webhook] signature timestamp too far from now");
    return false;
  }

  const hmac = createHmac("sha256", secret).update(body + tMatch[1]).digest();
  const expected = Buffer.from(expectedHex, "hex");
  if (hmac.length !== expected.length) return false;

  return timingSafeEqual(hmac, expected);
}

/**
 * Scan recent run directories for a publisher-output.json matching the given ghost_post_id.
 * Returns the directory containing the match and the parsed publisher output.
 */
function findRunDir(ghostPostId: string): { dir: string; publisher: PublisherOutput } | null {
  if (!existsSync(RUNS_DIR)) return null;

  const runs = readdirSync(RUNS_DIR).sort().reverse().slice(0, 20);

  for (const run of runs) {
    const runDir = resolve(RUNS_DIR, run);

    // Check subdirectories (plan-1/, plan-2/, etc.) — creator writes per-plan
    let subs: string[];
    try {
      subs = readdirSync(runDir);
    } catch { continue; }

    for (const sub of subs) {
      const subDir = resolve(runDir, sub);
      const pubPath = resolve(subDir, "publisher-output.json");
      if (!existsSync(pubPath)) continue;

      try {
        const pub = JSON.parse(readFileSync(pubPath, "utf-8")) as PublisherOutput;
        if (pub.ghost_post_id === ghostPostId) {
          return { dir: subDir, publisher: pub };
        }
      } catch { /* not a match */ }
    }

    // Also check root-level publisher-output.json
    const rootPubPath = resolve(runDir, "publisher-output.json");
    if (existsSync(rootPubPath)) {
      try {
        const pub = JSON.parse(readFileSync(rootPubPath, "utf-8")) as PublisherOutput;
        if (pub.ghost_post_id === ghostPostId) {
          return { dir: runDir, publisher: pub };
        }
      } catch { /* not a match */ }
    }
  }

  return null;
}

// ── Request handler ─────────────────────────────────────────────

const inFlight = new Set<string>();

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200).end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.method !== "POST" || req.url !== "/webhook/ghost") {
    res.writeHead(404).end(JSON.stringify({ error: "not found" }));
    return;
  }

  const body = await collectBody(req);

  // Verify signature
  const webhookSecret = process.env.GHOST_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[webhook] GHOST_WEBHOOK_SECRET not set");
    res.writeHead(500).end(JSON.stringify({ error: "webhook secret not configured" }));
    return;
  }

  const sigHeader = req.headers["x-ghost-signature"] as string | undefined;
  if (!verifyGhostSignature(body, sigHeader, webhookSecret)) {
    res.writeHead(401).end(JSON.stringify({ error: "invalid signature" }));
    return;
  }

  // Parse payload
  let payload: { post?: { current?: Record<string, unknown> } };
  try {
    payload = JSON.parse(body);
  } catch {
    res.writeHead(400).end(JSON.stringify({ error: "invalid JSON" }));
    return;
  }

  const post = payload.post?.current;
  if (!post || post.status !== "published") {
    res.writeHead(200).end(JSON.stringify({ status: "ignored", reason: "not a published post" }));
    return;
  }

  const ghostPostId = String(post.id);
  const ghostPostUrl = String(post.url);

  console.log(`[webhook] post.published: ${ghostPostId} → ${ghostPostUrl}`);

  // Update article status in DB
  try {
    const db = getDb();
    const slug = String(post.slug);
    const publishedAt = String(post.published_at ?? new Date().toISOString());
    db.prepare(`UPDATE articles SET status = 'published', published_at = ?, url = ? WHERE slug = ?`)
      .run(publishedAt, ghostPostUrl, slug);
    console.log(`[webhook] marked "${slug}" as published`);
  } catch (err) {
    console.error(`[webhook] status update failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Dedup: already processing
  if (inFlight.has(ghostPostId)) {
    res.writeHead(200).end(JSON.stringify({ status: "in_progress" }));
    return;
  }

  // Find the run directory for this post
  const found = findRunDir(ghostPostId);
  if (!found) {
    console.warn(`[webhook] no run found for ghost_post_id=${ghostPostId} — may be a manually created post`);
    res.writeHead(200).end(JSON.stringify({ status: "ignored", reason: "no matching run found" }));
    return;
  }

  // Read creator output for article content
  const creatorPath = resolve(found.dir, "creator-output.json");
  if (!existsSync(creatorPath)) {
    console.warn(`[webhook] creator-output.json not found in ${found.dir}`);
    res.writeHead(200).end(JSON.stringify({ status: "ignored", reason: "no creator output" }));
    return;
  }

  // Respond 202 immediately — Ghost has a 2s timeout
  inFlight.add(ghostPostId);
  res.writeHead(202).end(JSON.stringify({ status: "accepted", ghost_post_id: ghostPostId }));

  // Enqueue in background
  try {
    const draft = JSON.parse(readFileSync(creatorPath, "utf-8")) as ContentDraft;

    // Read strategist playbook to determine which platforms to syndicate to (per-plan)
    let platforms: string[] = [];
    const strategistPath = resolve(found.dir, "..", "strategist-output.json");
    if (existsSync(strategistPath)) {
      try {
        const strategist = JSON.parse(readFileSync(strategistPath, "utf-8"));
        const plan = (strategist.content_plans as Array<Record<string, unknown>> ?? [])
          .find((p) => p.plan_id === found.publisher.plan_id);
        if (plan) {
          platforms = ((plan.syndication_targets as string[]) ?? []).map((p) => p.toLowerCase());
        }
      } catch {
        console.warn(`[webhook] could not parse strategist output — skipping syndication`);
      }
    } else {
      console.warn(`[webhook] no strategist-output.json found — skipping syndication`);
    }

    if (platforms.length === 0) {
      console.log(`[webhook] no syndication targets for ${found.publisher.slug} — not enqueuing`);
    } else {
      enqueue({
        article_slug: found.publisher.slug,
        ghost_post_id: ghostPostId,
        canonical_url: ghostPostUrl,
        title: draft.title,
        markdown: draft.markdown,
        tags: found.publisher.tags,
        plan_id: found.publisher.plan_id,
        platforms,
      });
    }
  } catch (err) {
    console.error(`[webhook] enqueue failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    inFlight.delete(ghostPostId);
  }
}

// ── Server ──────────────────────────────────────────────────────

initDb();

const server = createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (err) {
    console.error("[webhook] unhandled error:", err);
    if (!res.headersSent) {
      res.writeHead(500).end(JSON.stringify({ error: "internal error" }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`[webhook] listening on port ${PORT}`);
});

function shutdown(signal: string) {
  console.log(`[webhook] ${signal} received, shutting down...`);
  server.close(() => {
    console.log("[webhook] closed");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("[webhook] forced shutdown after timeout");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
