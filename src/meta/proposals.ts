import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ChangeProposal } from "../models/change-proposal.js";
import type { WorkingMemory } from "../models/working-memory.js";
import { callClaude } from "../claude.js";
import { trackVersions, getCurrentVersions } from "./version-tracker.js";

const PROMPTS_DIR = resolve(import.meta.dirname, "../prompts");

/**
 * Apply an accepted proposal by using Claude to intelligently edit the prompt file.
 * Instead of appending text, Claude reads the current prompt, understands its structure,
 * and makes a targeted edit — producing a clean, coherent updated prompt.
 *
 * Returns the new version string.
 */
export async function applyProposal(
  proposal: ChangeProposal,
  memory: WorkingMemory,
): Promise<string> {
  if (proposal.field !== "prompt") {
    throw new Error(`Only prompt changes are supported, got: ${proposal.field}`);
  }

  const promptPath = resolve(PROMPTS_DIR, `${proposal.agent}.md`);
  const currentPrompt = readFileSync(promptPath, "utf-8");

  // Get current version before change
  const versionsBefore = getCurrentVersions();
  const versionBefore = versionsBefore[proposal.agent] ?? "0.0";

  // Use Claude to intelligently edit the prompt
  const editInstruction = `You are editing an agent prompt file. Your job is to apply a specific change while keeping the prompt clean and coherent.

## Change to apply

**What to change:** ${proposal.proposed_change}
**Reasoning:** ${proposal.reasoning}
${proposal.proposed_diff ? `**Specific text to incorporate:**\n${proposal.proposed_diff}` : ""}

## Rules

1. Find the most appropriate section in the prompt and make a targeted edit there.
2. Do NOT append to the end of the file — integrate the change into the existing structure.
3. If the change contradicts an existing rule, UPDATE the existing rule rather than adding a conflicting one.
4. Preserve ALL existing functionality not affected by this change.
5. Keep the same formatting style (markdown headers, bullet points, etc.).
6. Do NOT add comments like "<!-- Applied change -->" — make the edit seamless.
7. Return the COMPLETE updated prompt file — every line, from the first heading to the last.
8. Output ONLY the prompt file content — no explanation, no fences, no preamble.

## Current prompt file

${currentPrompt}`;

  console.log(`  [proposals] Applying change to ${proposal.agent} prompt via Claude...`);
  const { text: updatedPrompt } = await callClaude(editInstruction, "claude-sonnet-4-6", { maxTurns: 1 });

  // ── Verification ──────────────────────────────────────────────

  // Check the edit didn't accidentally truncate or destroy the prompt
  const minLength = Math.floor(currentPrompt.length * 0.5);
  if (updatedPrompt.length < minLength) {
    console.error(`  [proposals] ABORTED: Updated prompt is suspiciously short (${updatedPrompt.length} chars vs ${currentPrompt.length} original). Keeping original.`);
    return versionBefore;
  }

  // Check key structural markers are preserved
  const requiredMarkers = ["## Output Format", "## Your Task"];
  const missingMarkers = requiredMarkers.filter(
    (m) => currentPrompt.includes(m) && !updatedPrompt.includes(m),
  );
  if (missingMarkers.length > 0) {
    console.error(`  [proposals] ABORTED: Updated prompt is missing structural markers: ${missingMarkers.join(", ")}. Keeping original.`);
    return versionBefore;
  }

  // Apply the edit
  writeFileSync(promptPath, updatedPrompt);

  // Track the version change
  const versions = await trackVersions();
  const newVersion = versions[proposal.agent] ?? "unknown";

  // Record in working memory
  memory.applied_changes.push({
    change_id: proposal.proposal_id,
    agent: proposal.agent,
    version_from: versionBefore,
    version_to: newVersion,
    applied_at: new Date().toISOString(),
    expected_impact: proposal.expected_impact,
    actual_impact: null,
    verified: false,
  });

  console.log(`  [proposals] Applied proposal ${proposal.proposal_id} to ${proposal.agent}: v${versionBefore} → v${newVersion}`);
  return newVersion;
}

/**
 * Record a proposal rejection in working memory for meta-agent learning.
 */
export function rejectProposal(
  proposal: ChangeProposal,
  reason: string,
  memory: WorkingMemory,
): void {
  memory.insights.push({
    id: `rej_${proposal.proposal_id}`,
    claim: `Rejected proposal for ${proposal.agent}: ${proposal.proposed_change}`,
    evidence: `Rejected because: ${reason}`,
    confidence: 0.9,
    first_observed: new Date().toISOString(),
    last_verified: new Date().toISOString(),
    evidence_runs: proposal.evidence_runs,
  });

  console.log(`  [proposals] Rejected proposal ${proposal.proposal_id}: ${reason}`);
}
