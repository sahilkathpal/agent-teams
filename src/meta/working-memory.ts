import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { WorkingMemorySchema, type WorkingMemory, type Insight, type Hypothesis } from "../models/working-memory.js";
import type { MetaAgentOutput } from "../models/change-proposal.js";

const MEMORY_PATH = resolve(import.meta.dirname, "../../data/meta-memory.json");

/** Create a fresh empty working memory. */
function emptyMemory(): WorkingMemory {
  return {
    insights: [],
    hypotheses: [],
    watch_list: [],
    applied_changes: [],
    last_updated: new Date().toISOString(),
  };
}

/** Load working memory from disk. Creates empty file if missing. */
export function loadMemory(): WorkingMemory {
  if (!existsSync(MEMORY_PATH)) {
    const empty = emptyMemory();
    saveMemory(empty);
    return empty;
  }

  try {
    const raw = JSON.parse(readFileSync(MEMORY_PATH, "utf-8"));
    return WorkingMemorySchema.parse(raw);
  } catch (err) {
    console.warn(`  [memory] Failed to parse meta-memory.json, starting fresh:`, err);
    const empty = emptyMemory();
    saveMemory(empty);
    return empty;
  }
}

/** Save working memory to disk. */
export function saveMemory(memory: WorkingMemory): void {
  memory.last_updated = new Date().toISOString();
  writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2));
}

/** Generate a short ID for memory items. */
function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}`;
}

/** Add a new insight. */
export function addInsight(
  memory: WorkingMemory,
  claim: string,
  evidence: string,
  confidence: number,
  runId: string,
): Insight {
  const insight: Insight = {
    id: genId("ins"),
    claim,
    evidence,
    confidence,
    first_observed: new Date().toISOString(),
    last_verified: new Date().toISOString(),
    evidence_runs: [runId],
  };
  memory.insights.push(insight);
  return insight;
}

/** Update an existing insight's confidence and evidence. */
export function updateInsight(
  memory: WorkingMemory,
  claim: string,
  newConfidence: number,
  newEvidence?: string,
  runId?: string,
): boolean {
  const insight = memory.insights.find((i) => i.claim === claim);
  if (!insight) return false;

  insight.confidence = newConfidence;
  insight.last_verified = new Date().toISOString();
  if (newEvidence) insight.evidence = newEvidence;
  if (runId && !insight.evidence_runs.includes(runId)) {
    insight.evidence_runs.push(runId);
  }
  return true;
}

/** Retire an insight (remove it). */
export function retireInsight(memory: WorkingMemory, claim: string): boolean {
  const idx = memory.insights.findIndex((i) => i.claim === claim);
  if (idx === -1) return false;
  memory.insights.splice(idx, 1);
  return true;
}

/**
 * Decay confidence of insights not verified recently.
 * Reduces confidence by `decayRate` for each cycle since last verified.
 */
export function expireStaleInsights(memory: WorkingMemory, maxAgeDays: number = 30, decayRate: number = 0.1): void {
  const now = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  memory.insights = memory.insights.filter((insight) => {
    const age = now - new Date(insight.last_verified).getTime();
    if (age > maxAgeMs) {
      console.log(`  [memory] Expiring stale insight: "${insight.claim}" (age: ${Math.round(age / 86400000)}d)`);
      return false;
    }
    // Decay confidence for unverified insights
    if (age > 7 * 24 * 60 * 60 * 1000) {
      const weeksSinceVerified = age / (7 * 24 * 60 * 60 * 1000);
      insight.confidence = Math.max(0.1, insight.confidence - decayRate * weeksSinceVerified);
    }
    return true;
  });
}

/** Add a hypothesis to test. */
export function addHypothesis(
  memory: WorkingMemory,
  hypothesis: string,
  testCriteria: string,
  cyclesNeeded: number,
  runId: string,
): Hypothesis {
  const h: Hypothesis = {
    id: genId("hyp"),
    hypothesis,
    test_criteria: testCriteria,
    proposed_cycle: runId,
    cycles_remaining: cyclesNeeded,
    status: "testing",
  };
  memory.hypotheses.push(h);
  return h;
}

/** Resolve a hypothesis (confirmed, rejected, or inconclusive). */
export function resolveHypothesis(
  memory: WorkingMemory,
  hypothesis: string,
  result: "confirmed" | "rejected" | "inconclusive",
  evidence: string,
): boolean {
  const h = memory.hypotheses.find((h) => h.hypothesis === hypothesis && h.status === "testing");
  if (!h) return false;

  h.status = result;
  h.result_evidence = evidence;

  // If confirmed, promote to insight
  if (result === "confirmed") {
    addInsight(memory, hypothesis, evidence, 0.8, h.proposed_cycle);
  }

  return true;
}

/**
 * Apply memory updates from a meta-agent run.
 */
export function applyMetaAgentUpdates(memory: WorkingMemory, output: MetaAgentOutput): void {
  const updates = output.memory_updates;

  for (const ins of updates.add_insights) {
    addInsight(memory, ins.claim, ins.evidence, ins.confidence, output.run_id);
  }

  for (const upd of updates.update_insights) {
    updateInsight(memory, upd.claim, upd.new_confidence, upd.new_evidence, output.run_id);
  }

  for (const ret of updates.retire_insights) {
    retireInsight(memory, ret.claim);
    console.log(`  [memory] Retired insight: "${ret.claim}" — ${ret.reason}`);
  }

  for (const hyp of updates.add_hypotheses) {
    addHypothesis(memory, hyp.hypothesis, hyp.test_criteria, hyp.cycles_needed, output.run_id);
  }

  for (const res of updates.hypothesis_results) {
    resolveHypothesis(memory, res.hypothesis, res.result, res.evidence);
  }
}
