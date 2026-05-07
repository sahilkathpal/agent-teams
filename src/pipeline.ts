import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { runMonitor } from "./tools/monitor.js";
import { runStrategist } from "./agents/strategist.js";
import { runResearcher } from "./agents/researcher.js";
import { runCreator } from "./agents/creator.js";
import { trackVersions } from "./meta/version-tracker.js";
import { recordPipelineTrace } from "./meta/trace-recorder.js";
import { loadMemory } from "./meta/working-memory.js";
import { loadContextForRole, loadStrategistContext, loadAllContext, buildContextString } from "./context/load-context.js";
import { fetchBlogIndex } from "./sources/blog-index.js";
import { runScout } from "./agents/scout.js";
import { isAutomated } from "./agents/distribution-registry.js";
import { loadIcebox, saveIcebox, addToIcebox, pruneIcebox } from "./meta/icebox.js";
import { syncArticles } from "./sync/sync-articles.js";
import { sendPipelineReport, type PipelineReport, type StageStatus as ReportStageStatus } from "./notifications/email.js";
import type { CitationScorecard } from "./models/citation-scorecard.js";
import type { StrategistOutput, DistributionTarget } from "./models/content-plan.js";
import type { ContentDraft } from "./models/content-draft.js";
import type { ResearchBrief } from "./models/research-brief.js";
import type { ScoutReport } from "./models/scout-report.js";
import { runPool } from "./utils/pool.js";
import { setRunLogPath, log } from "./utils/run-logger.js";
import "dotenv/config";

// ── Types ────────────────────────────────────────────────────────

export type StageName = "monitor" | "scout" | "strategist" | "researcher" | "creator";
type StageStatus = "pending" | "running" | "done" | "failed" | "skipped";

interface StageState {
  status: StageStatus;
  started_at?: string;
  finished_at?: string;
  error?: string;
  sub_stages?: Record<string, StageState>;
}

interface RunState {
  run_id: string;
  run_dir: string;
  agent_versions: Record<string, string>;
  stages: Record<StageName, StageState>;
}

export interface PipelineOpts {
  otterlyDir: string;
  productContext?: string;
  blogIndex?: string;
  through?: StageName;
  concurrency?: number;
}

/**
 * Pipeline stages. Monitor and scout run in parallel (both are "gather" stages),
 * then strategist, researcher, creator run sequentially.
 */
const STAGE_ORDER: StageName[] = ["monitor", "scout", "strategist", "researcher", "creator"];

// ── State persistence ────────────────────────────────────────────

function stateFilePath(runDir: string): string {
  return resolve(runDir, "run-state.json");
}

function writeState(state: RunState): void {
  writeFileSync(stateFilePath(state.run_dir), JSON.stringify(state, null, 2));
}

function readState(runDir: string): RunState {
  return JSON.parse(readFileSync(stateFilePath(runDir), "utf-8"));
}

function freshState(runId: string, runDir: string, agentVersions: Record<string, string>): RunState {
  return {
    run_id: runId,
    run_dir: runDir,
    agent_versions: agentVersions,
    stages: {
      monitor: { status: "pending" },
      scout: { status: "pending" },
      strategist: { status: "pending" },
      researcher: { status: "pending" },
      creator: { status: "pending" },
    },
  };
}

// ── Pipeline execution ──────────────────────────────────────────

export async function runPipeline(opts: PipelineOpts): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = resolve(import.meta.dirname, "../data/runs", timestamp);
  mkdirSync(runDir, { recursive: true });

  const logsDir = resolve(runDir, "logs");
  mkdirSync(logsDir, { recursive: true });
  setRunLogPath(resolve(runDir, "run.log"));

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Pipeline run: ${timestamp}`);
  console.log("=".repeat(60));

  // Track agent versions
  console.log(`\nChecking agent versions...`);
  const agentVersions = await trackVersions();

  // Sync articles from Ghost into DB + fetch blog index
  console.log(`\nSyncing articles from Ghost...`);
  await syncArticles();
  console.log(`Fetching blog index...`);
  const blogIndex = opts.blogIndex ?? await fetchBlogIndex();

  const state = freshState(timestamp, runDir, agentVersions);
  writeState(state);

  const lastStage = opts.through ?? "creator";
  const lastIdx = STAGE_ORDER.indexOf(lastStage);

  const concurrency = opts.concurrency ?? 2;

  // Shared context built up across stages
  let scorecard: CitationScorecard | null = null;
  let scoutReport: ScoutReport | null = null;
  let strategistOutput: StrategistOutput | null = null;
  const researchBriefs = new Map<string, ResearchBrief>();
  const drafts: ContentDraft[] = [];
  const publishedUrls = new Map<string, string>();
  const costs: Record<string, number> = {};

  // ── Gather phase: monitor + scout in parallel ──────────────────
  const gatherStages = (["monitor", "scout"] as const).filter(
    (s) => STAGE_ORDER.indexOf(s) <= lastIdx,
  );

  if (gatherStages.length > 0) {
    console.log(`\n${"─".repeat(50)}`);
    console.log(`Stage: gather (${gatherStages.join(" + ")})`);
    console.log("─".repeat(50));

    const gatherTasks: Promise<void>[] = [];

    if (gatherStages.includes("monitor")) {
      gatherTasks.push((async () => {
        state.stages.monitor = { status: "running", started_at: new Date().toISOString() };
        writeState(state);
        try {
          scorecard = await runMonitor(opts.otterlyDir);
          writeFileSync(resolve(runDir, "monitor-output.json"), JSON.stringify(scorecard, null, 2));
          state.stages.monitor = { status: "done", finished_at: new Date().toISOString() };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          state.stages.monitor = { status: "failed", error: msg, finished_at: new Date().toISOString() };
          console.error(`  monitor failed: ${msg}`);
          throw err;
        }
        writeState(state);
      })());
    }

    if (gatherStages.includes("scout")) {
      gatherTasks.push((async () => {
        state.stages.scout = { status: "running", started_at: new Date().toISOString() };
        writeState(state);
        log(`[pipeline] stage:scout started`);

        const scoutContext = opts.productContext || loadStrategistContext();
        const scoutOutPath = resolve(runDir, "scout-output.json");

        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const scoutResult = await runScout({ productContext: scoutContext, outPath: scoutOutPath, logPath: resolve(logsDir, "scout.log") });
            costs["scout"] = (costs["scout"] ?? 0) + scoutResult.cost_usd;
            scoutReport = scoutResult.report;
            if (!scoutReport) {
              console.log("  Scout produced no output — strategist will proceed without trending data");
            }
            break;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (attempt < 2) {
              console.warn(`  Scout failed (attempt ${attempt}/2): ${msg} — retrying...`);
            } else {
              console.warn(`  Scout failed after 2 attempts: ${msg}`);
              console.warn("  ⚠️  Strategist will plan without trending signals — freshness scores will be weaker");
              state.stages.scout = { status: "failed", error: msg, finished_at: new Date().toISOString() };
              writeState(state);
              return;
            }
          }
        }

        state.stages.scout = { status: "done", finished_at: new Date().toISOString() };
        log(`[pipeline] stage:scout done`);
        writeState(state);
      })());
    }

    await Promise.all(gatherTasks);
  }

  // ── Sequential stages: strategist → researcher → creator ───────
  const sequentialStages: StageName[] = ["strategist", "researcher", "creator"];

  for (const stage of sequentialStages) {
    if (STAGE_ORDER.indexOf(stage) > lastIdx) break;

    console.log(`\n${"─".repeat(50)}`);
    console.log(`Stage: ${stage}`);
    console.log("─".repeat(50));

    state.stages[stage] = { status: "running", started_at: new Date().toISOString() };
    writeState(state);
    log(`[pipeline] stage:${stage} started`);

    try {
      switch (stage) {
        case "strategist": {
          if (!scorecard) throw new Error("No scorecard found — run Otterly monitoring to establish your target prompt set before running the strategist.");
          const memory = loadMemory();
          const strategistContext = opts.productContext || loadStrategistContext();
          const trendingReport = scoutReport
            ? JSON.stringify(scoutReport, null, 2)
            : "No trending data available — scout did not run or produced no output.";
          const strategistResult = await runStrategist({
            scorecard,
            memory,
            productContext: strategistContext,
            blogIndex,
            trendingReport,
            runId: timestamp,
            outPath: resolve(runDir, "strategist-output.json"),
          });
          costs["strategist"] = (costs["strategist"] ?? 0) + strategistResult.cost_usd;
          strategistOutput = strategistResult.output;
          if (!strategistOutput) throw new Error("Strategist produced no output");
          break;
        }
        case "researcher": {
          if (!strategistOutput) throw new Error("No strategist output — strategist stage must run first");
          const plans = strategistOutput.content_plans;
          state.stages[stage].sub_stages = {};
          for (const plan of plans) {
            state.stages[stage].sub_stages![plan.plan_id] = { status: "pending" };
          }
          writeState(state);

          console.log(`  Running ${plans.length} researchers (concurrency: ${concurrency})...`);
          await runPool(
            plans.map((plan) => async () => {
              const planId = plan.plan_id;
              state.stages[stage].sub_stages![planId] = { status: "running", started_at: new Date().toISOString() };
              writeState(state);
              log(`[pipeline] stage:researcher ${planId} started`);
              try {
                const researcherResult = await runResearcher({
                  contentPlan: plan,
                  domainCitationMap: scorecard?.domain_citation_map,
                  outPath: resolve(runDir, `researcher-output-${planId}.json`),
                  logPath: resolve(logsDir, `researcher-${planId}.log`),
                });
                costs["researcher"] = (costs["researcher"] ?? 0) + researcherResult.cost_usd;
                if (researcherResult.brief) {
                  researchBriefs.set(planId, researcherResult.brief);
                  log(`[pipeline] stage:researcher ${planId} done (${researcherResult.brief.signals.length} signals)`);
                } else {
                  console.log(`  [${planId}] Researcher produced no output — Creator will proceed without research brief`);
                  log(`[pipeline] stage:researcher ${planId} done (no output)`);
                }
                state.stages[stage].sub_stages![planId] = { status: "done", finished_at: new Date().toISOString() };
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                state.stages[stage].sub_stages![planId] = { status: "failed", error: msg, finished_at: new Date().toISOString() };
                log(`[pipeline] stage:researcher ${planId} failed — ${msg.slice(0, 120)}`);
                console.error(`  [${planId}] Researcher failed: ${msg}`);
              }
              writeState(state);
            }),
            concurrency,
          );

          // Stage fails if ALL sub-stages failed
          const subStatuses = Object.values(state.stages[stage].sub_stages!);
          if (subStatuses.length > 0 && subStatuses.every((s) => s.status === "failed")) {
            throw new Error("All researchers failed");
          }
          break;
        }
        case "creator": {
          if (!strategistOutput) throw new Error("No strategist output — strategist stage must run first");
          const plans = strategistOutput.content_plans;
          state.stages[stage].sub_stages = {};
          for (const plan of plans) {
            state.stages[stage].sub_stages![plan.plan_id] = { status: "pending" };
          }
          writeState(state);

          console.log(`  Running ${plans.length} creators (concurrency: ${concurrency})...`);
          await runPool(
            plans.map((plan) => async () => {
              const planId = plan.plan_id;
              state.stages[stage].sub_stages![planId] = { status: "running", started_at: new Date().toISOString() };
              writeState(state);
              try {
                const grassRole = plan.grass_role as "light" | "evaluate" | "integrate" | "execute";
                const roleContext = opts.productContext || loadContextForRole(grassRole);
                const brief = researchBriefs.get(planId);
                const researchContext = brief
                  ? `\n\n## Research Brief\n\n### Key Findings\n${brief.key_findings.map(f => `- ${f}`).join("\n")}\n\n### User Pain Points\n${brief.user_pain_points.map(p => `- ${p}`).join("\n")}\n\n### Quotable Evidence\n${brief.quotable_evidence.map(q => `- "${q.quote}" — ${q.source} (${q.url})`).join("\n")}\n\n### Competitor Content\n${brief.competitor_content.map(c => `- ${c.domain}: ${c.summary}`).join("\n")}\n`
                  : "";

                const planRunDir = resolve(runDir, planId);
                mkdirSync(planRunDir, { recursive: true });

                log(`[pipeline] stage:creator ${planId} started`);
                const result = await runCreator({
                  contentPlan: plan,
                  productContext: roleContext + researchContext,
                  blogIndex,
                  runDir: planRunDir,
                  logPath: resolve(logsDir, `creator-${planId}.log`),
                });

                if (result) {
                  costs["creator"] = (costs["creator"] ?? 0) + result.cost_usd;
                  drafts.push(result.draft);
                  if (result.published_url) publishedUrls.set(planId, result.published_url);
                  console.log(`  [${planId}] Created: "${result.draft.title}"`);
                  log(`[pipeline] stage:creator ${planId} done ("${result.draft.title}")`);
                } else {
                  console.warn(`  [${planId}] Creator produced no output`);
                  log(`[pipeline] stage:creator ${planId} done (no output)`);
                }
                state.stages[stage].sub_stages![planId] = { status: "done", finished_at: new Date().toISOString() };
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                state.stages[stage].sub_stages![planId] = { status: "failed", error: msg, finished_at: new Date().toISOString() };
                log(`[pipeline] stage:creator ${planId} failed — ${msg.slice(0, 120)}`);
                console.error(`  [${planId}] Creator failed: ${msg}`);
              }
              writeState(state);
            }),
            concurrency,
          );

          const subStatuses = Object.values(state.stages[stage].sub_stages!);
          if (subStatuses.length > 0 && subStatuses.every((s) => s.status === "failed")) {
            throw new Error("All creators failed");
          }
          break;
        }
      }

      state.stages[stage].status = "done";
      state.stages[stage].finished_at = new Date().toISOString();
      log(`[pipeline] stage:${stage} done`);
      writeState(state);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state.stages[stage].status = "failed";
      state.stages[stage].error = msg;
      state.stages[stage].finished_at = new Date().toISOString();
      log(`[pipeline] stage:${stage} failed — ${msg.slice(0, 120)}`);
      writeState(state);
      console.error(`\n  Stage ${stage} failed: ${msg}`);
      throw err;
    }
  }

  // Record trace for each produced article
  for (const draft of drafts) {
    const plan = strategistOutput?.content_plans.find((p) => p.plan_id === draft.plan_id);
    recordPipelineTrace({
      runId: timestamp,
      articleSlug: draft.slug,
      topicId: plan?.topic_id || undefined,
      agentVersions: agentVersions,
    });
  }

  // Route non-automated distribution targets to icebox (per-plan)
  if (strategistOutput) {
    const icebox = loadIcebox();
    pruneIcebox(icebox);
    const iceboxItems: Array<{ target: DistributionTarget; runId: string; articleSlug?: string; articleTitle?: string; compositeScore: number }> = [];

    for (const plan of strategistOutput.content_plans) {
      const draft = drafts.find((d) => d.plan_id === plan.plan_id);
      for (const target of plan.distribution_targets) {
        if (!isAutomated(target.platform)) {
          iceboxItems.push({
            target,
            runId: timestamp,
            articleSlug: draft?.slug,
            articleTitle: draft?.title,
            compositeScore: plan.composite_score,
          });
        }
      }
    }

    if (iceboxItems.length > 0) {
      const added = addToIcebox(icebox, iceboxItems);
      saveIcebox(icebox);
      const platforms = iceboxItems.map((i) => i.target.platform);
      const counts = platforms.reduce((acc, p) => { acc[p] = (acc[p] ?? 0) + 1; return acc; }, {} as Record<string, number>);
      const summary = Object.entries(counts).map(([p, n]) => `${p} ×${n}`).join(", ");
      console.log(`  Iceboxed ${added} distribution items (${summary})`);
    }
  }

  // ── Build and send pipeline report ─────────────────────────────
  const totalCost = Object.values(costs).reduce((a, b) => a + b, 0);
  const pipelineDuration = Date.now() - new Date(timestamp.replace(/T/, "T").replace(/-(\d{2})-(\d{2})$/, ":$1:$2")).getTime();

  const stageFailures: Array<{ stage: string; error: string }> = [];
  for (const [stage, info] of Object.entries(state.stages)) {
    if (info.status === "failed" && info.error) {
      stageFailures.push({ stage, error: info.error });
    }
  }

  const reportStages: ReportStageStatus[] = STAGE_ORDER.map((name) => ({
    name,
    status: state.stages[name].status as ReportStageStatus["status"],
    error: state.stages[name].error,
  }));

  const report: PipelineReport = {
    run_id: timestamp,
    duration_ms: pipelineDuration,
    stages: reportStages,
    scorecard,
    scout_summary: scoutReport ? {
      hot_topics: (scoutReport as ScoutReport).hot_topics.length,
      rising_tools: (scoutReport as ScoutReport).rising_tools.length,
      pain_points: (scoutReport as ScoutReport).developer_pain_points.length,
    } : null,
    strategist_summary: strategistOutput ? {
      plans_count: strategistOutput.content_plans.length,
      plans: strategistOutput.content_plans.map((p) => ({
        plan_id: p.plan_id,
        topic: p.topic,
        score: p.composite_score,
        reasoning: p.reasoning,
      })),
      strategy_notes: strategistOutput.strategy_notes,
    } : null,
    researcher_summary: strategistOutput ? {
      completed: researchBriefs.size,
      failed: strategistOutput.content_plans.length - researchBriefs.size,
    } : null,
    creator_summary: drafts.length > 0 || strategistOutput ? {
      articles: drafts.map((d) => ({ title: d.title, slug: d.slug, ghost_url: publishedUrls.get(d.plan_id) })),
      failed: (strategistOutput?.content_plans.length ?? 0) - drafts.length,
    } : null,
    costs,
    total_cost_usd: totalCost,
    stage_failures: stageFailures,
  };

  writeFileSync(resolve(runDir, "report.json"), JSON.stringify(report, null, 2));

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Pipeline complete → ${runDir} (${drafts.length} articles, $${totalCost.toFixed(2)})`);
  console.log("=".repeat(60));

  await sendPipelineReport(report);
}

/**
 * Resume a failed pipeline run from the next incomplete stage.
 */
export async function resumePipeline(runId: string, opts: PipelineOpts): Promise<void> {
  const runsDir = resolve(import.meta.dirname, "../data/runs");
  let runDir: string;

  if (runId) {
    runDir = resolve(runsDir, runId);
  } else {
    const { readdirSync } = await import("node:fs");
    const entries = readdirSync(runsDir).sort().reverse();
    const found = entries.find((e) => existsSync(resolve(runsDir, e, "run-state.json")));
    if (!found) throw new Error("No previous run found to resume.");
    runDir = resolve(runsDir, found);
  }

  if (!existsSync(stateFilePath(runDir))) {
    throw new Error(`No run state found at ${runDir}`);
  }

  const state = readState(runDir);
  console.log(`\nResuming run ${state.run_id} from ${runDir}`);

  for (const [stage, info] of Object.entries(state.stages)) {
    console.log(`  ${stage}: ${info.status}${info.error ? ` (${info.error.slice(0, 80)})` : ""}`);
  }

  const startIdx = STAGE_ORDER.findIndex((s) => state.stages[s].status !== "done" && state.stages[s].status !== "skipped");
  if (startIdx === -1) {
    console.log("\nAll stages complete. Nothing to resume.");
    return;
  }

  console.log(`\nResuming from stage: ${STAGE_ORDER[startIdx]}`);

  const concurrency = opts.concurrency ?? 2;

  // Sync articles + fetch blog index
  console.log(`\nSyncing articles from Ghost...`);
  await syncArticles();
  console.log(`Fetching blog index...`);
  const blogIndex = opts.blogIndex ?? await fetchBlogIndex();

  // Hydrate shared context from previous stage outputs
  const tryLoad = <T>(filename: string): T | null => {
    const path = resolve(runDir, filename);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  };

  let scorecard = tryLoad<CitationScorecard>("monitor-output.json");
  let scoutReport = tryLoad<ScoutReport>("scout-output.json");
  let strategistOutput = tryLoad<StrategistOutput>("strategist-output.json");

  // Load per-plan research briefs
  const researchBriefs = new Map<string, ResearchBrief>();
  if (strategistOutput) {
    for (const plan of strategistOutput.content_plans) {
      const brief = tryLoad<ResearchBrief>(`researcher-output-${plan.plan_id}.json`);
      if (brief) researchBriefs.set(plan.plan_id, brief);
    }
  }

  const drafts: ContentDraft[] = [];
  const publishedUrls = new Map<string, string>();

  // Respect --through
  const lastStage = opts.through ?? "creator";
  const lastIdx = STAGE_ORDER.indexOf(lastStage);

  // ── Gather phase: monitor + scout in parallel (if either needs resuming) ──
  const gatherNeedsResume = ["monitor", "scout"].some(
    (s) => STAGE_ORDER.indexOf(s as StageName) >= startIdx &&
           STAGE_ORDER.indexOf(s as StageName) <= lastIdx &&
           state.stages[s as StageName].status !== "done" &&
           state.stages[s as StageName].status !== "skipped",
  );

  if (gatherNeedsResume) {
    console.log(`\n${"─".repeat(50)}`);
    console.log(`Stage: gather (monitor + scout) (resumed)`);
    console.log("─".repeat(50));

    const gatherTasks: Promise<void>[] = [];

    if (state.stages.monitor.status !== "done" && state.stages.monitor.status !== "skipped" && STAGE_ORDER.indexOf("monitor") <= lastIdx) {
      gatherTasks.push((async () => {
        state.stages.monitor = { status: "running", started_at: new Date().toISOString() };
        writeState(state);
        try {
          scorecard = await runMonitor(opts.otterlyDir);
          writeFileSync(resolve(runDir, "monitor-output.json"), JSON.stringify(scorecard, null, 2));
          state.stages.monitor = { status: "done", finished_at: new Date().toISOString() };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          state.stages.monitor = { status: "failed", error: msg, finished_at: new Date().toISOString() };
          console.error(`  monitor failed: ${msg}`);
          throw err;
        }
        writeState(state);
      })());
    }

    if (state.stages.scout.status !== "done" && state.stages.scout.status !== "skipped" && STAGE_ORDER.indexOf("scout") <= lastIdx) {
      gatherTasks.push((async () => {
        state.stages.scout = { status: "running", started_at: new Date().toISOString() };
        writeState(state);
        try {
          const scoutCtx = opts.productContext || loadStrategistContext();
          const scoutResult = await runScout({
            productContext: scoutCtx,
            outPath: resolve(runDir, "scout-output.json"),
          });
          scoutReport = scoutResult.report;
          state.stages.scout = { status: "done", finished_at: new Date().toISOString() };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          state.stages.scout = { status: "failed", error: msg, finished_at: new Date().toISOString() };
          console.error(`  scout failed: ${msg}`);
          // Non-fatal
        }
        writeState(state);
      })());
    }

    await Promise.all(gatherTasks);
  }

  // ── Sequential stages ──────────────────────────────────────────
  const sequentialStages: StageName[] = ["strategist", "researcher", "creator"];

  for (const stage of sequentialStages) {
    if (STAGE_ORDER.indexOf(stage) > lastIdx) break;
    if (STAGE_ORDER.indexOf(stage) < startIdx) continue;
    if (state.stages[stage].status === "done" || state.stages[stage].status === "skipped") continue;

    console.log(`\n${"─".repeat(50)}`);
    console.log(`Stage: ${stage} (resumed)`);
    console.log("─".repeat(50));

    state.stages[stage] = {
      status: "running",
      started_at: new Date().toISOString(),
      sub_stages: state.stages[stage].sub_stages,
    };
    writeState(state);

    try {
      switch (stage) {
        case "strategist": {
          if (!scorecard) throw new Error("No scorecard found — run Otterly monitoring to establish your target prompt set before running the strategist.");
          const memory = loadMemory();
          const resumeStrategistCtx = opts.productContext || loadStrategistContext();
          const resumeTrendingReport = scoutReport
            ? JSON.stringify(scoutReport, null, 2)
            : "No trending data available — scout did not run or produced no output.";
          const resumeStrategistResult = await runStrategist({
            scorecard,
            memory,
            productContext: resumeStrategistCtx,
            blogIndex,
            trendingReport: resumeTrendingReport,
            runId: state.run_id,
            outPath: resolve(runDir, "strategist-output.json"),
          });
          strategistOutput = resumeStrategistResult.output;
          if (!strategistOutput) throw new Error("Strategist produced no output");
          break;
        }
        case "researcher": {
          if (!strategistOutput) throw new Error("No strategist output");
          const plans = strategistOutput.content_plans;
          const existingSubs = state.stages[stage].sub_stages ?? {};
          if (!state.stages[stage].sub_stages) state.stages[stage].sub_stages = {};
          for (const plan of plans) {
            if (!existingSubs[plan.plan_id] || existingSubs[plan.plan_id].status !== "done") {
              state.stages[stage].sub_stages![plan.plan_id] = { status: "pending" };
            }
          }
          writeState(state);

          const pendingPlans = plans.filter(
            (p) => state.stages[stage].sub_stages![p.plan_id]?.status !== "done",
          );
          console.log(`  Running ${pendingPlans.length} researchers (${plans.length - pendingPlans.length} already done, concurrency: ${concurrency})...`);

          await runPool(
            pendingPlans.map((plan) => async () => {
              const planId = plan.plan_id;
              state.stages[stage].sub_stages![planId] = { status: "running", started_at: new Date().toISOString() };
              writeState(state);
              try {
                const researcherResult = await runResearcher({
                  contentPlan: plan,
                  domainCitationMap: scorecard?.domain_citation_map,
                  outPath: resolve(runDir, `researcher-output-${planId}.json`),
                });
                if (researcherResult.brief) researchBriefs.set(planId, researcherResult.brief);
                else console.log(`  [${planId}] Researcher produced no output — continuing`);
                state.stages[stage].sub_stages![planId] = { status: "done", finished_at: new Date().toISOString() };
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                state.stages[stage].sub_stages![planId] = { status: "failed", error: msg, finished_at: new Date().toISOString() };
                console.error(`  [${planId}] Researcher failed: ${msg}`);
              }
              writeState(state);
            }),
            concurrency,
          );

          const subStatuses = Object.values(state.stages[stage].sub_stages!);
          if (subStatuses.length > 0 && subStatuses.every((s) => s.status === "failed")) {
            throw new Error("All researchers failed");
          }
          break;
        }
        case "creator": {
          if (!strategistOutput) throw new Error("No strategist output");
          const plans = strategistOutput.content_plans;
          const existingSubs = state.stages[stage].sub_stages ?? {};
          if (!state.stages[stage].sub_stages) state.stages[stage].sub_stages = {};
          for (const plan of plans) {
            if (!existingSubs[plan.plan_id] || existingSubs[plan.plan_id].status !== "done") {
              state.stages[stage].sub_stages![plan.plan_id] = { status: "pending" };
            }
          }
          writeState(state);

          const pendingPlans = plans.filter(
            (p) => state.stages[stage].sub_stages![p.plan_id]?.status !== "done",
          );
          console.log(`  Running ${pendingPlans.length} creators (${plans.length - pendingPlans.length} already done, concurrency: ${concurrency})...`);

          await runPool(
            pendingPlans.map((plan) => async () => {
              const planId = plan.plan_id;
              state.stages[stage].sub_stages![planId] = { status: "running", started_at: new Date().toISOString() };
              writeState(state);
              try {
                const grassRole = plan.grass_role as "light" | "evaluate" | "integrate" | "execute";
                const roleContext = opts.productContext || loadContextForRole(grassRole);
                const brief = researchBriefs.get(planId);
                const researchContext = brief
                  ? `\n\n## Research Brief\n\n### Key Findings\n${brief.key_findings.map(f => `- ${f}`).join("\n")}\n\n### User Pain Points\n${brief.user_pain_points.map(p => `- ${p}`).join("\n")}\n\n### Quotable Evidence\n${brief.quotable_evidence.map(q => `- "${q.quote}" — ${q.source} (${q.url})`).join("\n")}\n\n### Competitor Content\n${brief.competitor_content.map(c => `- ${c.domain}: ${c.summary}`).join("\n")}\n`
                  : "";

                const planRunDir = resolve(runDir, planId);
                mkdirSync(planRunDir, { recursive: true });

                const result = await runCreator({
                  contentPlan: plan,
                  productContext: roleContext + researchContext,
                  blogIndex,
                  runDir: planRunDir,
                });

                if (result) {
                  drafts.push(result.draft);
                  if (result.published_url) publishedUrls.set(planId, result.published_url);
                  console.log(`  [${planId}] Created: "${result.draft.title}"`);
                } else {
                  console.warn(`  [${planId}] Creator produced no output`);
                }
                state.stages[stage].sub_stages![planId] = { status: "done", finished_at: new Date().toISOString() };
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                state.stages[stage].sub_stages![planId] = { status: "failed", error: msg, finished_at: new Date().toISOString() };
                console.error(`  [${planId}] Creator failed: ${msg}`);
              }
              writeState(state);
            }),
            concurrency,
          );

          const subStatuses = Object.values(state.stages[stage].sub_stages!);
          if (subStatuses.length > 0 && subStatuses.every((s) => s.status === "failed")) {
            throw new Error("All creators failed");
          }
          break;
        }
      }

      state.stages[stage].status = "done";
      state.stages[stage].finished_at = new Date().toISOString();
      writeState(state);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state.stages[stage].status = "failed";
      state.stages[stage].error = msg;
      state.stages[stage].finished_at = new Date().toISOString();
      writeState(state);
      console.error(`\n  Stage ${stage} failed: ${msg}`);
      throw err;
    }
  }

  // Record trace for each produced article
  for (const draft of drafts) {
    const plan = strategistOutput?.content_plans.find((p) => p.plan_id === draft.plan_id);
    recordPipelineTrace({
      runId: state.run_id,
      articleSlug: draft.slug,
      topicId: plan?.topic_id || undefined,
      agentVersions: state.agent_versions,
    });
  }

  // Route non-automated distribution targets to icebox (per-plan)
  if (strategistOutput) {
    const icebox = loadIcebox();
    pruneIcebox(icebox);
    const iceboxItems: Array<{ target: DistributionTarget; runId: string; articleSlug?: string; articleTitle?: string; compositeScore: number }> = [];

    for (const plan of strategistOutput.content_plans) {
      const draft = drafts.find((d) => d.plan_id === plan.plan_id);
      for (const target of plan.distribution_targets) {
        if (!isAutomated(target.platform)) {
          iceboxItems.push({
            target,
            runId: state.run_id,
            articleSlug: draft?.slug,
            articleTitle: draft?.title,
            compositeScore: plan.composite_score,
          });
        }
      }
    }

    if (iceboxItems.length > 0) {
      const added = addToIcebox(icebox, iceboxItems);
      saveIcebox(icebox);
      const platforms = iceboxItems.map((i) => i.target.platform);
      const counts = platforms.reduce((acc, p) => { acc[p] = (acc[p] ?? 0) + 1; return acc; }, {} as Record<string, number>);
      const summary = Object.entries(counts).map(([p, n]) => `${p} ×${n}`).join(", ");
      console.log(`  Iceboxed ${added} distribution items (${summary})`);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Resume complete → ${runDir} (${drafts.length} articles)`);
  console.log("=".repeat(60));
}
