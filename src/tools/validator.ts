import { writeFileSync } from "node:fs";
import { ValidationResultSchema, type ValidationResult } from "../models/validation-result.js";
import { callClaude, extractJson } from "../claude.js";
import { loadPrompt } from "../prompts/load.js";
import { getAgent } from "../agents/registry.js";
import type { ContentDraft } from "../models/content-draft.js";

/**
 * Validator agent — QA checks on content before publication.
 */
export async function runValidator(opts: {
  draft: ContentDraft;
  productContext: string;
  outPath: string;
}): Promise<ValidationResult | null> {
  console.log(`[validator] Validating: "${opts.draft.title}"`);

  const { markdown, ...metadata } = opts.draft;

  const prompt = loadPrompt("validator", {
    plan_id: opts.draft.plan_id,
    draft_metadata_json: JSON.stringify(metadata, null, 2),
    draft_markdown: markdown,
    product_context: opts.productContext,
    validated_at: new Date().toISOString(),
  });

  const def = getAgent("validator");
  const { text } = await callClaude(prompt, def.model, { maxTurns: def.maxTurns, allowedTools: def.allowedTools });

  try {
    const parsed = JSON.parse(extractJson(text));
    const result = ValidationResultSchema.parse(parsed);

    console.log(`  Verdict: ${result.verdict}`);
    console.log(`  Scores: factual=${result.scores.factual_accuracy} geo=${result.scores.geo_optimization} brand=${result.scores.brand_alignment} quality=${result.scores.overall_quality}`);
    if (result.issues.length > 0) {
      console.log(`  Issues: ${result.issues.length} (${result.issues.filter(i => i.severity === "error").length} errors)`);
    }
    if (result.verdict === "rejected") {
      console.log(`  Rejection reason: ${result.rejection_reason}`);
    }

    writeFileSync(opts.outPath, JSON.stringify(result, null, 2));
    return result;
  } catch (err) {
    console.warn(`[validator] Failed to parse response: ${err instanceof Error ? err.message : String(err)}`);
    console.warn(`  Raw (first 500): ${(text ?? "").slice(0, 500)}`);
    return null;
  }
}
