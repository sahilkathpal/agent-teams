import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { initDb } from "../db/schema.js";
import { MetaAgentOutputSchema } from "../models/change-proposal.js";
import { loadMemory, saveMemory } from "../meta/working-memory.js";
import { applyProposal, rejectProposal } from "../meta/proposals.js";
import { approveProposal, rejectProposalDb } from "../db/helpers.js";
import { addPrompt, retirePrompt, assignCluster } from "../sync/prompt-manager.js";
import "dotenv/config";

initDb();

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

// ── Load meta-agent output ─────────────────────────────────────

const dataDir = resolve(import.meta.dirname, "../../data");
let metaOutputPath = resolve(dataDir, "meta-output.json");

if (!existsSync(metaOutputPath)) {
  const runsDir = resolve(dataDir, "runs");
  if (!existsSync(runsDir)) {
    console.log("No meta-agent output found. Run 'npm run meta' first.");
    process.exit(0);
  }

  const runs = readdirSync(runsDir).sort().reverse();
  let found = false;
  for (const run of runs) {
    const path = resolve(runsDir, run, "meta-output.json");
    if (existsSync(path)) {
      console.log(`Found meta-agent output in run ${run}`);
      metaOutputPath = path;
      found = true;
      break;
    }
  }

  if (!found) {
    console.log("No meta-agent output found. Run 'npm run meta' first.");
    process.exit(0);
  }
}

const raw = JSON.parse(readFileSync(metaOutputPath, "utf-8"));
const output = MetaAgentOutputSchema.parse(raw);

// ── --apply <proposal_id> ──────────────────────────────────────

const applyId = getArg("--apply");
if (applyId) {
  const proposal = output.proposals.find((p) => p.proposal_id === applyId);
  if (!proposal) {
    console.error(`Proposal "${applyId}" not found. Available: ${output.proposals.map((p) => p.proposal_id).join(", ") || "(none)"}`);
    process.exit(1);
  }
  const memory = loadMemory();
  const newVersion = await applyProposal(proposal, memory);
  saveMemory(memory);
  const applied = memory.applied_changes.find((c) => c.change_id === applyId);
  approveProposal(applyId, applied?.version_from ?? "unknown", newVersion);
  console.log(`\nApplied ${applyId} → v${newVersion}`);
  process.exit(0);
}

// ── --reject <proposal_id> <reason> ────────────────────────────

const rejectId = getArg("--reject");
if (rejectId) {
  const rejectIdx = args.indexOf("--reject");
  const reason = args.slice(rejectIdx + 2).join(" ");
  if (!reason) {
    console.error("Usage: npm run proposals -- --reject <id> <reason>");
    process.exit(1);
  }
  const proposal = output.proposals.find((p) => p.proposal_id === rejectId);
  if (!proposal) {
    console.error(`Proposal "${rejectId}" not found. Available: ${output.proposals.map((p) => p.proposal_id).join(", ") || "(none)"}`);
    process.exit(1);
  }
  const memory = loadMemory();
  rejectProposal(proposal, reason, memory);
  saveMemory(memory);
  rejectProposalDb(rejectId, reason);
  console.log(`\nRejected ${rejectId}: ${reason}`);
  process.exit(0);
}

// ── --apply-prompts ────────────────────────────────────────────

if (args.includes("--apply-prompts")) {
  let applied = 0;
  const otterlyActions: string[] = [];

  for (const p of output.prompt_updates.add) {
    addPrompt(p.prompt, p.source as "geo_target" | "adjacent_query" | "competitor_gap" | "manual");
    otterlyActions.push(`  ADD to Otterly: "${p.prompt}"`);
    applied++;
  }
  for (const p of output.prompt_updates.retire) {
    retirePrompt(p.prompt, p.reason);
    otterlyActions.push(`  REMOVE from Otterly: "${p.prompt}" (${p.reason})`);
    applied++;
  }
  for (const p of output.prompt_updates.recluster) {
    assignCluster(p.prompt, p.to_cluster);
    applied++;
  }
  console.log(`\nApplied ${applied} prompt update(s) locally.`);

  if (otterlyActions.length > 0) {
    console.log(`\n${"!".repeat(60)}`);
    console.log(`ACTION REQUIRED — update these prompts on app.otterly.ai:`);
    console.log("!".repeat(60));
    for (const action of otterlyActions) {
      console.log(action);
    }
    console.log(`\nOtterly has a ${process.env.MAX_TRACKED_PROMPTS ?? 15}-prompt limit. Current local count: ${output.prompt_updates.add.length} added, ${output.prompt_updates.retire.length} retired.`);
    console.log("!".repeat(60));
  }

  process.exit(0);
}

// ── Display mode (default) ─────────────────────────────────────

const hasProposals = output.proposals.length > 0;
const hasPromptUpdates = output.prompt_updates.add.length > 0 || output.prompt_updates.retire.length > 0 || output.prompt_updates.recluster.length > 0;

if (!hasProposals && !hasPromptUpdates) {
  console.log("No pending proposals or prompt updates.");
  process.exit(0);
}

const memory = loadMemory();

// ── Agent config proposals ──────────────────────────────────────

if (hasProposals) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Agent Config Proposals (${output.proposals.length})`);
  console.log("=".repeat(60));

  for (const proposal of output.proposals) {
    console.log(`\n${"─".repeat(50)}`);
    console.log(`Proposal: ${proposal.proposal_id}`);
    console.log(`Agent: ${proposal.agent}`);
    console.log(`Confidence: ${proposal.confidence}`);
    console.log(`Change: ${proposal.proposed_change}`);
    console.log(`Reasoning: ${proposal.reasoning}`);
    console.log(`Expected impact: ${JSON.stringify(proposal.expected_impact)}`);
    if (proposal.proposed_diff) {
      console.log(`\nDiff:\n${proposal.proposed_diff}`);
    }
    console.log(`\nEvidence runs: ${proposal.evidence_runs.join(", ")}`);
    console.log(`\n  To apply:  npm run proposals -- --apply ${proposal.proposal_id}`);
    console.log(`  To reject: npm run proposals -- --reject ${proposal.proposal_id} "your reason"`);
  }
}

// ── Prompt curation ─────────────────────────────────────────────

if (hasPromptUpdates) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Prompt Curation Suggestions`);
  console.log("=".repeat(60));

  if (output.prompt_updates.add.length > 0) {
    console.log(`\n  ADD (${output.prompt_updates.add.length}):`);
    for (const p of output.prompt_updates.add) {
      console.log(`    + "${p.prompt}"`);
      console.log(`      Source: ${p.source} | Volume: ${p.expected_volume}`);
      console.log(`      Reason: ${p.reason}`);
    }
  }

  if (output.prompt_updates.retire.length > 0) {
    console.log(`\n  RETIRE (${output.prompt_updates.retire.length}):`);
    for (const p of output.prompt_updates.retire) {
      console.log(`    - "${p.prompt}"`);
      console.log(`      Reason: ${p.reason}`);
    }
  }

  if (output.prompt_updates.recluster.length > 0) {
    console.log(`\n  RECLUSTER (${output.prompt_updates.recluster.length}):`);
    for (const p of output.prompt_updates.recluster) {
      console.log(`    ~ "${p.prompt}": ${p.from_cluster ?? "(none)"} → ${p.to_cluster}`);
      console.log(`      Reason: ${p.reason}`);
    }
  }

  console.log(`\n  To apply all: npm run proposals -- --apply-prompts`);
}

saveMemory(memory);
console.log(`\n${"=".repeat(60)}`);
console.log("Review complete.");
