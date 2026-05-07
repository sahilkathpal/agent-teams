import { writeFileSync } from "node:fs";
import { MetaAgentOutputSchema, type MetaAgentOutput } from "../models/change-proposal.js";
import { callClaude, extractJson } from "../claude.js";
import { loadPrompt } from "../prompts/load.js";
import { getAgent } from "./registry.js";
import { loadMemory, saveMemory, applyMetaAgentUpdates, expireStaleInsights } from "../meta/working-memory.js";
import { getAllTraces } from "../meta/trace-recorder.js";
import { getAgentHistory } from "../meta/version-tracker.js";
import { getDb, recordProposals } from "../db/helpers.js";
import { getTrackedPrompts, getUntrackedGeoTargets, getStalePrompts } from "../sync/prompt-manager.js";
import { loadIcebox, getChannelSummary } from "../meta/icebox.js";
import { loadTopics } from "../meta/topics.js";
import type { Topic } from "../meta/topics.js";
import type { CitationScorecard } from "../models/citation-scorecard.js";

interface TopicMetric {
  topic_id: string;
  label: string;
  articles_count: number;
  articles_cited: number;
  citation_count: number;
  coverage_pct: number;
}

function computeTopicMetrics(topics: Topic[]): TopicMetric[] {
  const db = getDb();

  // Get all citations grouped by article_slug for efficient lookup
  const citationsBySlug = db.prepare(
    "SELECT article_slug, COUNT(*) as cnt FROM citations WHERE article_slug IS NOT NULL GROUP BY article_slug",
  ).all() as Array<{ article_slug: string; cnt: number }>;
  const citationMap = new Map(citationsBySlug.map((r) => [r.article_slug, r.cnt]));

  return topics.map((topic) => {
    const traceRows = db.prepare(
      "SELECT DISTINCT article_slug FROM traces WHERE topic_id = ? AND article_slug IS NOT NULL",
    ).all(topic.id) as Array<{ article_slug: string }>;

    const articleSlugs = traceRows.map((r) => r.article_slug);
    const articles_count = articleSlugs.length;

    if (articles_count === 0) {
      return { topic_id: topic.id, label: topic.label, articles_count: 0, articles_cited: 0, citation_count: 0, coverage_pct: 0 };
    }

    const citation_count = articleSlugs.reduce((sum, slug) => sum + (citationMap.get(slug) ?? 0), 0);
    const articles_cited = articleSlugs.filter((slug) => citationMap.has(slug)).length;
    const coverage_pct = Math.round((articles_cited / articles_count) * 100);

    return { topic_id: topic.id, label: topic.label, articles_count, articles_cited, citation_count, coverage_pct };
  });
}

/**
 * Meta-Agent — analyzes performance across cycles and proposes improvements.
 */
export async function runMetaAgent(opts: {
  scorecard: CitationScorecard;
  runId: string;
  outPath: string;
}): Promise<MetaAgentOutput | null> {
  console.log(`[meta-agent] Analyzing performance...`);

  // Load working memory
  const memory = loadMemory();
  expireStaleInsights(memory);

  // Get trace history
  const traces = getAllTraces();

  // Get version history for key agents
  const agents = ["monitor", "strategist", "creator", "validator", "meta-agent"];
  const versionsMap: Record<string, Array<{ version: string; changed_at: string; change_summary: string }>> = {};
  for (const agent of agents) {
    versionsMap[agent] = getAgentHistory(agent);
  }

  // Get historical scorecards
  const db = getDb();
  const historicalScorecards = db.prepare(`
    SELECT scorecard_id, scored_at, data FROM scorecards
    ORDER BY scored_at DESC
    LIMIT 10
  `).all() as Array<{ scorecard_id: string; scored_at: string; data: string }>;

  // Get distribution icebox summary
  const icebox = loadIcebox();
  const iceboxSummary = getChannelSummary(icebox);

  // Compute topic performance metrics
  const topicRegistry = loadTopics();
  const topicMetrics = computeTopicMetrics(topicRegistry.topics);

  // Get prompt curation data
  const trackedPrompts = getTrackedPrompts();
  const untrackedGeoTargets = getUntrackedGeoTargets();
  const stalePrompts = getStalePrompts(30);

  const prompt = loadPrompt("meta-agent", {
    run_id: opts.runId,
    analyzed_at: new Date().toISOString(),
    domain: opts.scorecard.domain,
    scorecard_json: JSON.stringify(opts.scorecard, null, 2),
    historical_scorecards_json: JSON.stringify(
      historicalScorecards.map((s) => ({
        scorecard_id: s.scorecard_id,
        scored_at: s.scored_at,
        ...JSON.parse(s.data),
      })),
      null,
      2,
    ),
    traces_json: JSON.stringify(traces.slice(0, 50), null, 2),
    versions_json: JSON.stringify(versionsMap, null, 2),
    working_memory_json: JSON.stringify(memory, null, 2),
    max_prompts: String(Number(process.env.MAX_TRACKED_PROMPTS ?? "15")),
    current_prompt_count: String(trackedPrompts.length),
    tracked_prompts: trackedPrompts.length > 0
      ? trackedPrompts.map((p) => `- "${p.prompt_text}" [cluster: ${p.cluster ?? "unassigned"}] (volume: ${p.intent_volume_monthly}, source: ${p.source})`).join("\n")
      : "No prompts currently tracked.",
    cluster_metrics: opts.scorecard.cluster_metrics.length > 0
      ? opts.scorecard.cluster_metrics.map((c) => `- ${c.cluster}: ${c.prompts} prompts, ${c.coverage_pct}% coverage, avg pos ${c.avg_position ?? "-"}, share ${c.share_pct}%`).join("\n")
      : "No clusters defined yet — assign clusters to prompts.",
    untracked_geo_targets: untrackedGeoTargets.length > 0
      ? untrackedGeoTargets.map((t) => `- "${t}"`).join("\n")
      : "All geo_targets are already tracked.",
    stale_prompts: stalePrompts.length > 0
      ? stalePrompts.map((p) => `- "${p.prompt_text}"`).join("\n")
      : "No stale prompts found.",
    icebox_summary: iceboxSummary,
    topic_metrics_json: topicMetrics.length > 0
      ? JSON.stringify(topicMetrics, null, 2)
      : "No topics tracked yet — topic registry is empty.",
  });

  const def = getAgent("meta-agent");
  const { text } = await callClaude(prompt, def.model, { maxTurns: def.maxTurns, allowedTools: def.allowedTools, timeoutMs: def.timeoutMs });

  try {
    const parsed = JSON.parse(extractJson(text));
    const output = MetaAgentOutputSchema.parse(parsed);

    console.log(`  Proposals: ${output.proposals.length}`);
    console.log(`  Prompt updates: +${output.prompt_updates.add.length} add, -${output.prompt_updates.retire.length} retire`);
    console.log(`  Memory updates: +${output.memory_updates.add_insights.length} insights, ${output.memory_updates.hypothesis_results.length} hypothesis results`);
    console.log(`  Strategy notes: ${output.strategy_notes.length}`);

    // Record proposals in DB
    if (output.proposals.length > 0) {
      recordProposals(opts.runId, output.proposals);
      console.log(`  Proposals recorded in DB.`);
    }

    // Apply memory updates
    applyMetaAgentUpdates(memory, output);
    saveMemory(memory);
    console.log(`  Working memory updated and saved.`);

    writeFileSync(opts.outPath, JSON.stringify(output, null, 2));
    return output;
  } catch (err) {
    console.warn(`[meta-agent] Failed to parse response: ${err instanceof Error ? err.message : String(err)}`);
    console.warn(`  Raw (first 500): ${text.slice(0, 500)}`);
    return null;
  }
}
