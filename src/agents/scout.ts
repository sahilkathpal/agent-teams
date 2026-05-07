import { writeFileSync } from "node:fs";
import { ScoutReportSchema, type ScoutReport } from "../models/scout-report.js";
import { callClaude, extractJson } from "../claude.js";
import { loadPrompt } from "../prompts/load.js";
import { getAgent } from "./registry.js";

/**
 * Scout agent — searches the web, HN, and Reddit for trending topics
 * in the AI coding tools space. Runs in parallel with the monitor.
 */
export async function runScout(opts: {
  productContext: string;
  outPath: string;
  logPath?: string;
}): Promise<{ report: ScoutReport | null; cost_usd: number }> {
  console.log(`[scout] Scanning for trending topics...`);

  const prompt = loadPrompt("scout", {
    product_context: opts.productContext,
    scouted_at: new Date().toISOString(),
  });

  const def = getAgent("scout");
  const { text, cost_usd } = await callClaude(prompt, def.model, {
    maxTurns: def.maxTurns,
    allowedTools: def.allowedTools,
    timeoutMs: def.timeoutMs,
    logPath: opts.logPath,
  });

  if (!text || text.trim().length === 0) {
    console.warn(`[scout] Claude returned empty response`);
    return { report: null, cost_usd };
  }

  try {
    const parsed = JSON.parse(extractJson(text));
    const report = ScoutReportSchema.parse(parsed);

    console.log(`  Hot topics: ${report.hot_topics.length}`);
    console.log(`  Rising tools: ${report.rising_tools.length}`);
    console.log(`  Pain points: ${report.developer_pain_points.length}`);
    console.log(`  Signals: ${report.raw_signal_count.hn_posts} HN, ${report.raw_signal_count.reddit_posts} Reddit, ${report.raw_signal_count.web_results} web`);

    writeFileSync(opts.outPath, JSON.stringify(report, null, 2));
    return { report, cost_usd };
  } catch (err) {
    console.warn(`[scout] Failed to parse response: ${err instanceof Error ? err.message : String(err)}`);
    console.warn(`  Raw (first 500): ${(text ?? "").slice(0, 500)}`);
    return { report: null, cost_usd };
  }
}
