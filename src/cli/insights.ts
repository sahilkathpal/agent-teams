import { initDb } from "../db/schema.js";
import {
  overview,
  versionPerformance,
  metricTrend,
  attributionReport,
  domainEffectiveness,
  hypothesisReport,
} from "../meta/insights-engine.js";
import { loadMemory } from "../meta/working-memory.js";
import "dotenv/config";

initDb();

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

if (args.includes("--trend")) {
  const metric = getArg("--trend");
  if (!metric) { console.log("Usage: npm run insights -- --trend <metric_name>"); process.exit(1); }

  const days = getArg("--days") ? Number(getArg("--days")) : undefined;
  const points = metricTrend(metric, days);

  console.log(`\nTrend: ${metric}${days ? ` (last ${days} days)` : ""}\n`);
  if (points.length === 0) {
    console.log("  No data points found.");
  } else {
    for (const p of points) console.log(`  ${p.date}  ${p.value}`);
  }

} else if (args.includes("--agent")) {
  const agent = getArg("--agent");
  if (!agent) { console.log("Usage: npm run insights -- --agent <name>"); process.exit(1); }

  const perf = versionPerformance(agent);

  console.log(`\n${agent} version performance:\n`);
  if (perf.length === 0) {
    console.log("  No trace data found for this agent.");
  } else {
    for (const p of perf) {
      console.log(`  v${p.version}  articles: ${p.articles}  cited: ${p.cited} (${p.citation_rate}%)  total_citations: ${p.total_citations}  avg_pos: ${p.avg_position ?? "n/a"}`);
    }
  }

} else if (args.includes("--attribution")) {
  const entries = attributionReport();

  console.log(`\nAttribution Report (cited articles → agent versions):\n`);
  if (entries.length === 0) {
    console.log("  No cited articles with traces found.");
  } else {
    for (const e of entries) {
      console.log(`  ${e.article_slug} (${e.citations_7d} citations)`);
      console.log(`    URL: ${e.article_url}`);
      console.log(`    Run: ${e.run_id}`);
      for (const [agent, ver] of Object.entries(e.agent_versions)) {
        console.log(`    ${agent}: v${ver}`);
      }
      console.log();
    }
  }

} else if (args.includes("--domains")) {
  const domains = domainEffectiveness();

  console.log(`\nDomain Effectiveness (which domains get cited most):\n`);
  console.log(`  ${"Domain".padEnd(30)} Citations  Prompts  Avg Pos`);
  console.log(`  ${"─".repeat(60)}`);
  for (const d of domains) {
    console.log(`  ${d.domain.padEnd(30)} ${String(d.citation_count).padStart(9)}  ${String(d.prompts_cited).padStart(7)}  ${String(d.avg_position).padStart(7)}`);
  }

} else if (args.includes("--hypotheses")) {
  const hyps = hypothesisReport();

  console.log(`\nHypothesis Report:\n`);
  if (hyps.length === 0) {
    console.log("  No hypotheses recorded yet.");
  } else {
    for (const h of hyps) {
      console.log(`  [${h.status}] ${h.hypothesis}`);
      if (h.cycles_remaining > 0) console.log(`    Cycles remaining: ${h.cycles_remaining}`);
      if (h.result_evidence) console.log(`    Evidence: ${h.result_evidence}`);
    }
  }

} else {
  // Overview
  const data = overview();
  const memory = loadMemory();

  console.log(`\n${"=".repeat(50)}`);
  console.log("Agent Teams — GEO Insights");
  console.log("=".repeat(50));

  console.log(`\nData:`);
  console.log(`  Prompts tracked: ${data.prompts_tracked}`);
  console.log(`  Articles: ${data.articles_count}`);
  console.log(`  Citations: ${data.citations_count}`);
  console.log(`  Traces: ${data.traces_count}`);

  console.log(`\nAgent Versions:`);
  for (const [agent, version] of Object.entries(data.agent_versions).sort()) {
    console.log(`  ${agent.padEnd(15)} v${version}`);
  }

  console.log(`\nWorking Memory:`);
  console.log(`  Insights: ${data.memory_summary.insights}`);
  console.log(`  Hypotheses: ${data.memory_summary.hypotheses_total} (${data.memory_summary.hypotheses_testing} testing)`);
  console.log(`  Watch list: ${data.memory_summary.watch_list}`);
  console.log(`  Applied changes: ${data.memory_summary.applied_changes}`);

  if (memory.insights.length > 0) {
    console.log(`\nTop Insights:`);
    const sorted = [...memory.insights].sort((a, b) => b.confidence - a.confidence);
    for (const ins of sorted.slice(0, 5)) {
      console.log(`  [${ins.confidence.toFixed(1)}] ${ins.claim}`);
    }
  }

  if (data.latest_scorecard) {
    const sc = data.latest_scorecard;
    console.log(`\nLatest Scorecard:`);
    console.log(`  Citation coverage: ${sc.citation_coverage_pct}%`);
    console.log(`  SOV: ${sc.position_weighted_sov}%`);
    console.log(`  Median position: ${sc.median_citation_position ?? "n/a"}`);
    console.log(`  Articles cited (7d): ${sc.articles_cited_7d}`);

    const clusters = (sc as Record<string, unknown>).cluster_metrics as Array<Record<string, unknown>> | undefined;
    if (clusters && clusters.length > 0) {
      console.log(`\nCluster Performance:`);
      console.log(`  ${"Cluster".padEnd(25)} Prompts  Coverage  Avg Pos  Share`);
      console.log(`  ${"─".repeat(65)}`);
      for (const c of clusters) {
        console.log(`  ${String(c.cluster).padEnd(25)} ${String(c.prompts).padStart(7)}  ${(String(c.coverage_pct) + "%").padStart(8)}  ${(c.avg_position !== null ? String(c.avg_position) : "-").padStart(7)}  ${(String(c.share_pct) + "%").padStart(5)}`);
      }
    }
  }

  console.log(`\nAvailable subcommands:`);
  console.log(`  --agent <name>       Per-agent version performance`);
  console.log(`  --trend <metric>     Metric trend over time (--days N to limit)`);
  console.log(`  --attribution        Cited articles → agent versions`);
  console.log(`  --domains            Domain citation effectiveness`);
  console.log(`  --hypotheses         Working memory hypothesis status`);
  console.log(`  --clusters           Cluster performance details`);
}
