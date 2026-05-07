import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ContentDraftSchema, type ContentDraft } from "../models/content-draft.js";
import { callClaude } from "../claude.js";
import { loadPrompt } from "../prompts/load.js";
import { getAgent } from "./registry.js";
import type { ContentPlan } from "../models/content-plan.js";

/**
 * Creator agent — a multi-turn agent with tool access.
 *
 * Writes GEO-optimized content, then uses Bash tools to:
 * 1. Save the draft to disk
 * 2. Run the validator tool
 * 3. If rejected, revise and re-validate (up to maxRetries)
 * 4. Publish as a Ghost draft
 * 5. Syndicate to Dev.to/Hashnode
 *
 * Returns the final draft (parsed from the file the agent wrote).
 */
export async function runCreator(opts: {
  contentPlan: ContentPlan;
  productContext: string;
  blogIndex: string;
  runDir: string;
  logPath?: string;
}): Promise<{ draft: ContentDraft; published_url?: string; cost_usd: number } | null> {
  console.log(`[creator] Starting: "${opts.contentPlan.topic}"`);

  const draftPath = resolve(opts.runDir, "creator-output.json");
  const draftMdPath = resolve(opts.runDir, "creator-output.md");
  const validatorOutPath = resolve(opts.runDir, "validator-output.json");
  const publisherOutPath = resolve(opts.runDir, "publisher-output.json");
  const distributorOutPath = resolve(opts.runDir, "distributor-output.json");

  // Build the context file for the validator to read
  const contextPath = resolve(opts.runDir, "_product-context.md");
  writeFileSync(contextPath, opts.productContext);

  // Build distribution playbook path if strategist output exists
  const strategistPath = resolve(opts.runDir, "strategist-output.json");

  const isRefresh = opts.contentPlan.action === "refresh";
  const refreshSlug = opts.contentPlan.refresh_target?.slug;

  const prompt = loadPrompt("creator", {
    plan_id: opts.contentPlan.plan_id ?? "",
    content_plan_json: JSON.stringify(opts.contentPlan, null, 2),
    product_context: opts.productContext,
    blog_index: opts.blogIndex || "No existing posts yet.",
    grass_role: opts.contentPlan.grass_role,
    intent_mode: opts.contentPlan.intent_mode,
    voice_type: opts.contentPlan.voice_type,
    format: opts.contentPlan.format,
    action: opts.contentPlan.action ?? "create",
    refresh_reason: opts.contentPlan.refresh_target?.reason ?? "",
    existing_article_markdown: "",
    if_refresh: isRefresh ? "true" : "",
    created_at: new Date().toISOString(),

    // Tool paths for the agent to use
    draft_path: draftPath,
    draft_md_path: draftMdPath,
    validator_out_path: validatorOutPath,
    context_path: contextPath,
    publisher_out_path: publisherOutPath,
    distributor_out_path: distributorOutPath,
    strategist_path: strategistPath,
    refresh_slug: refreshSlug ?? "",
    run_dir: opts.runDir,
  });

  const def = getAgent("creator");
  const { text, cost_usd } = await callClaude(prompt, def.model, {
    maxTurns: def.maxTurns,
    allowedTools: def.allowedTools,
    timeoutMs: def.timeoutMs,
    logPath: opts.logPath,
  });

  // Read the draft from disk (the agent should have written it)
  if (!existsSync(draftPath)) {
    console.warn(`[creator] Agent did not write draft to ${draftPath}`);
    console.warn(`  Final response (first 300): ${(text ?? "").slice(0, 300)}`);
    return null;
  }

  try {
    const raw = JSON.parse(readFileSync(draftPath, "utf-8"));
    const draft = ContentDraftSchema.parse(raw);

    console.log(`  Title: "${draft.title}"`);
    console.log(`  Word count: ${draft.word_count}`);
    console.log(`  GEO targets: ${draft.geo_targets.length}`);

    // Check if publisher output exists
    let published_url: string | undefined;
    if (existsSync(publisherOutPath)) {
      const pubOut = JSON.parse(readFileSync(publisherOutPath, "utf-8"));
      published_url = pubOut.ghost_post_url;
      console.log(`  Published: ${published_url}`);
    }

    return { draft, published_url, cost_usd };
  } catch (err) {
    console.warn(`[creator] Failed to parse draft from disk: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
