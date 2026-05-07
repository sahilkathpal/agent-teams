import { readFileSync, existsSync } from "node:fs";
import { ResearchBriefSchema, type ResearchBrief } from "../models/research-brief.js";
import { callClaude } from "../claude.js";
import { loadPrompt } from "../prompts/load.js";
import { getAgent } from "./registry.js";
import { loadTopics, getTopicById } from "../meta/topics.js";
import type { ContentPlan } from "../models/content-plan.js";
import type { PromptCitation } from "../models/citation-scorecard.js";

/**
 * Researcher agent — Claude drives its own search strategy via bash tool calls.
 * Writes the research brief JSON to opts.outPath when done.
 */
export async function runResearcher(opts: {
  contentPlan: ContentPlan;
  domainCitationMap?: PromptCitation[];
  outPath: string;
  logPath?: string;
}): Promise<{ brief: ResearchBrief | null; cost_usd: number }> {
  const plan = opts.contentPlan;
  console.log(`[researcher] Researching: "${plan.topic}"`);

  // ── Resolve subreddits ───────────────────────────────────────────

  const fallbackSubreddits = ["ClaudeCode", "ChatGPTCoding", "LocalLLaMA", "coding"];
  let subreddits = fallbackSubreddits;
  if (plan.topic_id) {
    const registry = loadTopics();
    const topic = getTopicById(registry, plan.topic_id);
    if (topic && topic.subreddits.length > 0) {
      subreddits = topic.subreddits;
      console.log(`  Using topic subreddits for "${plan.topic_id}": ${subreddits.slice(0, 3).join(", ")}`);
    }
  }

  // ── Resolve competitor domains ───────────────────────────────────

  const siteDomain = process.env.SITE_DOMAIN ?? "codeongrass.com";
  const competitorDomains: string[] = [];

  if (opts.domainCitationMap) {
    const relevantPrompts = opts.domainCitationMap.filter((p) =>
      plan.geo_targets.some((t) => p.prompt_text.toLowerCase().includes(t.toLowerCase().slice(0, 20))),
    );
    const seen = new Set<string>();
    for (const p of relevantPrompts) {
      for (const d of p.top_domains.slice(0, 3)) {
        if (d.domain !== siteDomain && !seen.has(d.domain)) {
          seen.add(d.domain);
          competitorDomains.push(d.domain);
        }
      }
    }
  }

  // ── Load skill file ──────────────────────────────────────────────

  const searchToolsSkill = readFileSync(
    new URL("../tools/tools.md", import.meta.url),
    "utf-8",
  );

  // ── Build prompt and call Claude ─────────────────────────────────

  const prompt = loadPrompt("researcher", {
    plan_id: plan.plan_id,
    topic: plan.topic,
    angle: plan.angle,
    geo_targets: plan.geo_targets.join("\n- "),
    subreddits: subreddits.join(", "),
    competitor_domains: competitorDomains.join("\n"),
    out_path: opts.outPath,
    tools: searchToolsSkill,
    researched_at: new Date().toISOString(),
  });

  const def = getAgent("researcher");
  const { cost_usd } = await callClaude(prompt, def.model, { maxTurns: def.maxTurns, allowedTools: def.allowedTools, timeoutMs: def.timeoutMs, logPath: opts.logPath });

  // ── Read and validate output from disk ───────────────────────────

  if (!existsSync(opts.outPath)) {
    console.warn(`[researcher] Output file not found at ${opts.outPath}`);
    return { brief: null, cost_usd };
  }

  try {
    const raw = readFileSync(opts.outPath, "utf-8");
    const parsed = JSON.parse(raw);
    const brief = ResearchBriefSchema.parse(parsed);

    console.log(`  Signals: ${brief.signals.length}`);
    console.log(`  Key findings: ${brief.key_findings.length}`);
    console.log(`  Pain points: ${brief.user_pain_points.length}`);
    console.log(`  Quotable evidence: ${brief.quotable_evidence.length}`);
    console.log(`  Competitor content: ${brief.competitor_content.length}`);

    return { brief, cost_usd };
  } catch (err) {
    console.warn(`[researcher] Failed to parse research brief: ${err instanceof Error ? err.message : String(err)}`);
    return { brief: null, cost_usd };
  }
}
