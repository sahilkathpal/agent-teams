import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { createHmac } from "node:crypto";
import { runPipeline, resumePipeline, type PipelineOpts, type StageName } from "./pipeline.js";
import { runScorer } from "./tools/scorer.js";
import { runMetaAgent } from "./agents/meta-agent.js";
import { initDb } from "./db/schema.js";
import "dotenv/config";

const STAGES: StageName[] = ["monitor", "scout", "strategist", "researcher", "creator"];

async function validateEnv(through?: StageName): Promise<void> {
  const missing: string[] = [];
  const warnings: string[] = [];
  const connectionErrors: string[] = [];

  // Always needed (blog index + article sync at pipeline start)
  if (!process.env.GHOST_URL) missing.push("GHOST_URL");
  if (!process.env.GHOST_CONTENT_KEY) missing.push("GHOST_CONTENT_KEY");

  const lastIdx = through ? STAGES.indexOf(through) : STAGES.length - 1;

  // Scout/researcher need web search
  if (lastIdx >= STAGES.indexOf("scout")) {
    if (!process.env.PARALLEL_API_KEY) missing.push("PARALLEL_API_KEY");
  }

  // Creator needs publishing (syndication is handled separately via webhook + drain)
  if (lastIdx >= STAGES.indexOf("creator")) {
    if (!process.env.GHOST_ADMIN_KEY) missing.push("GHOST_ADMIN_KEY");
  }

  for (const w of warnings) console.warn(`  Warning: ${w}`);

  if (missing.length > 0) {
    console.error(`\nMissing required environment variables:\n${missing.map((e) => `  - ${e}`).join("\n")}`);
    console.error(`\nSet them in .env or export them. See .env.example for reference.`);
    process.exit(1);
  }

  // Connection checks — verify keys actually work
  console.log("Validating connections...");

  // Ghost Content API (always needed)
  try {
    const base = process.env.GHOST_URL!.replace(/\/+$/, "");
    const url = `${base}/api/content/posts/?key=${process.env.GHOST_CONTENT_KEY}&limit=1&fields=title`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      connectionErrors.push(`Ghost Content API returned ${res.status} — check GHOST_URL and GHOST_CONTENT_KEY`);
    } else {
      console.log("  Ghost Content API: OK");
    }
  } catch (err) {
    connectionErrors.push(`Ghost Content API unreachable — ${err instanceof Error ? err.message : String(err)}`);
  }

  // Ghost Admin API (only if running through creator)
  if (lastIdx >= STAGES.indexOf("creator") && process.env.GHOST_ADMIN_KEY) {
    try {
      const [id, secret] = process.env.GHOST_ADMIN_KEY.split(":");
      if (!id || !secret) {
        connectionErrors.push("GHOST_ADMIN_KEY format invalid — expected {id}:{secret}");
      } else {
        const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT", kid: id })).toString("base64url");
        const now = Math.floor(Date.now() / 1000);
        const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: "/admin/" })).toString("base64url");
        const sig = createHmac("sha256", Buffer.from(secret, "hex")).update(`${header}.${payload}`).digest("base64url");
        const jwt = `${header}.${payload}.${sig}`;

        const base = process.env.GHOST_URL!.replace(/\/+$/, "");
        const res = await fetch(`${base}/api/admin/site/`, {
          headers: { Authorization: `Ghost ${jwt}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          connectionErrors.push(`Ghost Admin API returned ${res.status} — check GHOST_ADMIN_KEY`);
        } else {
          console.log("  Ghost Admin API: OK");
        }
      }
    } catch (err) {
      connectionErrors.push(`Ghost Admin API check failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Parallel Web API (scout/researcher)
  if (lastIdx >= STAGES.indexOf("scout") && process.env.PARALLEL_API_KEY) {
    try {
      const { default: Parallel } = await import("parallel-web");
      const client = new Parallel({ apiKey: process.env.PARALLEL_API_KEY });
      await client.search({ search_queries: ["test"], objective: "test", advanced_settings: { max_results: 1 } });
      console.log("  Parallel Web API: OK");
    } catch (err) {
      connectionErrors.push(`Parallel Web API failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (connectionErrors.length > 0) {
    console.error(`\nConnection validation failed:\n${connectionErrors.map((e) => `  - ${e}`).join("\n")}`);
    process.exit(1);
  }

  console.log("  All checks passed.\n");
}

function usage(): void {
  console.log(`
Usage: npm start -- [options]

Pipeline:
  --otterly <dir>       Path to Otterly CSV exports directory (required for pipeline)
  --context <file>      Path to product context file (optional — uses built-in Grass context if omitted)
  --through <stage>     Run pipeline through this stage: monitor | scout | strategist | researcher | creator
  --concurrency <n>     Max parallel researcher/creator agents per stage (default: 2)
  --resume [run-id]     Resume a failed run (latest if no ID given)

Standalone:
  --score             Run scorer only (compute metrics from existing DB)
  --meta              Run meta-agent analysis
  --meta-out <file>   Output path for meta-agent results

Example:
  npm start -- --otterly ./data/otterly --context ./src/context/grass.md
  npm start -- --score
  npm start -- --meta --meta-out ./data/meta-output.json
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    usage();
    process.exit(0);
  }

  // Initialize database
  initDb();

  // ── Score only ────────────────────────────────────────────────
  if (args.includes("--score")) {
    const scorecard = await runScorer();
    console.log(JSON.stringify(scorecard, null, 2));
    process.exit(0);
  }

  // ── Meta-agent only ───────────────────────────────────────────
  if (args.includes("--meta")) {
    const scorecard = await runScorer();
    const outPath = getArg(args, "--meta-out") ?? resolve("data", "meta-output.json");
    const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

    await runMetaAgent({
      scorecard,
      runId,
      outPath,
    });
    process.exit(0);
  }

  // ── Helper: build pipeline opts + validate env ─────────────────
  function buildOpts(): PipelineOpts {
    const otterlyDir = getArg(args, "--otterly");
    if (!otterlyDir) {
      console.error("Error: --otterly <dir> is required for the pipeline.");
      usage();
      process.exit(1);
    }
    if (!existsSync(otterlyDir)) {
      console.error(`Error: Otterly directory not found: ${otterlyDir}`);
      process.exit(1);
    }

    const contextFile = getArg(args, "--context");
    let productContext = "";
    if (contextFile && existsSync(contextFile)) {
      productContext = readFileSync(contextFile, "utf-8");
    }

    const through = getArg(args, "--through") as StageName | undefined;
    const concurrencyStr = getArg(args, "--concurrency");
    const concurrency = concurrencyStr ? parseInt(concurrencyStr, 10) : undefined;

    return {
      otterlyDir: resolve(otterlyDir),
      productContext,
      through,
      concurrency,
    };
  }

  // ── Resume ────────────────────────────────────────────────────
  if (args.includes("--resume")) {
    const runId = getArg(args, "--resume") ?? "";
    const pipelineOpts = buildOpts();
    await validateEnv(pipelineOpts.through);
    await resumePipeline(runId, pipelineOpts);
    process.exit(0);
  }

  // ── Full pipeline ─────────────────────────────────────────────
  const pipelineOpts = buildOpts();
  await validateEnv(pipelineOpts.through);
  await runPipeline(pipelineOpts);
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
