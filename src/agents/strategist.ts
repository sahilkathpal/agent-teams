import { readFileSync, writeFileSync } from "node:fs";
import { StrategistOutputSchema, type StrategistOutput } from "../models/content-plan.js";
import { callClaude, extractJson } from "../claude.js";
import { loadPrompt } from "../prompts/load.js";
import { getAgent } from "./registry.js";
import { loadTopics, saveTopics, upsertTopicFromStrategist } from "../meta/topics.js";
import type { CitationScorecard } from "../models/citation-scorecard.js";
import type { WorkingMemory } from "../models/working-memory.js";

/**
 * Strategist agent — analyzes the citation landscape and produces
 * a content plan + distribution playbook.
 */
export async function runStrategist(opts: {
  scorecard: CitationScorecard;
  memory: WorkingMemory;
  productContext: string;
  blogIndex: string;
  trendingReport: string;
  runId: string;
  outPath: string;
}): Promise<{ output: StrategistOutput | null; cost_usd: number }> {
  console.log(`[strategist] Analyzing citation landscape...`);

  // Prepare memory insights for injection
  const memoryInsights = opts.memory.insights.length > 0
    ? opts.memory.insights
        .filter((i) => i.confidence > 0.3)
        .map((i) => `- ${i.claim} (confidence: ${i.confidence})`)
        .join("\n")
    : "No insights yet — this is the first cycle.";

  // Load topic registry
  const topicRegistry = loadTopics();
  const topicRegistryJson = topicRegistry.topics.length > 0
    ? JSON.stringify(topicRegistry.topics.map((t) => ({
        id: t.id,
        label: t.label,
        rationale: t.rationale,
        subreddits: t.subreddits,
      })), null, 2)
    : "No topics yet — this is the first cycle.";

  const prompt = loadPrompt("strategist", {
    run_id: opts.runId,
    analyzed_at: new Date().toISOString(),
    product_context: opts.productContext,
    scorecard_json: JSON.stringify(opts.scorecard, null, 2),
    memory_insights: memoryInsights,
    blog_index: opts.blogIndex || "No existing posts yet.",
    trending_report: opts.trendingReport,
    topic_registry_json: topicRegistryJson,
  });

  const def = getAgent("strategist");
  const { text, cost_usd } = await callClaude(prompt, def.model, { maxTurns: def.maxTurns, allowedTools: def.allowedTools, timeoutMs: def.timeoutMs });

  if (!text || text.trim().length === 0) {
    console.warn(`[strategist] Claude returned empty response`);
    return { output: null, cost_usd };
  }

  try {
    const parsed = JSON.parse(extractJson(text));
    const output = StrategistOutputSchema.parse(parsed);

    console.log(`  Content plans: ${output.content_plans.length}`);
    for (const plan of output.content_plans) {
      const s = plan.scores;
      console.log(`    [${plan.plan_id}] "${plan.topic}" (${plan.format}, score: ${plan.composite_score}/50, topic: ${plan.topic_id || "unassigned"})`);
      console.log(`      demand=${s.demand} proximity=${s.proximity} proof=${s.proof} freshness=${s.freshness} defensibility=${s.defensibility}`);
    }
    const totalSyndication = output.content_plans.reduce((n, p) => n + p.syndication_targets.length, 0);
    const totalDistribution = output.content_plans.reduce((n, p) => n + p.distribution_targets.length, 0);
    console.log(`  Distribution: ${totalSyndication} syndication targets, ${totalDistribution} manual targets across ${output.content_plans.length} plans`);
    console.log(`  Strategy notes: ${output.strategy_notes.length}`);

    // Upsert topics into registry
    if (output.topic_upserts.length > 0) {
      for (const upsert of output.topic_upserts) {
        upsertTopicFromStrategist(topicRegistry, upsert);
        console.log(`  [topics] ${upsert.is_new ? "Created" : "Updated"} topic: ${upsert.id}`);
      }
      saveTopics(topicRegistry);
    }

    writeFileSync(opts.outPath, JSON.stringify(output, null, 2));
    return { output, cost_usd };
  } catch (err) {
    console.warn(`[strategist] Failed to parse response: ${err instanceof Error ? err.message : String(err)}`);
    console.warn(`  Raw (first 500): ${(text ?? "").slice(0, 500)}`);
    return { output: null, cost_usd };
  }
}
