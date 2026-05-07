import { z } from "zod";

export const InsightSchema = z.object({
  id: z.string(),
  claim: z.string(),
  evidence: z.string(),
  confidence: z.number().min(0).max(1),
  first_observed: z.string(),
  last_verified: z.string(),
  evidence_runs: z.array(z.string()),
});

export const HypothesisSchema = z.object({
  id: z.string(),
  hypothesis: z.string(),
  test_criteria: z.string(),
  proposed_cycle: z.string(),
  cycles_remaining: z.number().int(),
  status: z.enum(["testing", "confirmed", "rejected", "inconclusive"]),
  result_evidence: z.string().optional(),
});

export const WatchListItemSchema = z.object({
  id: z.string(),
  signal: z.string(),
  threshold: z.number(),
  comparison: z.enum(["above", "below"]),
  action: z.string(),
  last_triggered: z.string().optional(),
});

export const AppliedChangeSchema = z.object({
  change_id: z.string(),
  agent: z.string(),
  version_from: z.string(),
  version_to: z.string(),
  applied_at: z.string(),
  expected_impact: z.record(z.string(), z.string()),
  actual_impact: z.record(z.string(), z.string()).nullable(),
  verified: z.boolean().default(false),
});

export const WorkingMemorySchema = z.object({
  insights: z.array(InsightSchema),
  hypotheses: z.array(HypothesisSchema),
  watch_list: z.array(WatchListItemSchema),
  applied_changes: z.array(AppliedChangeSchema),
  last_updated: z.string(),
});

export type Insight = z.infer<typeof InsightSchema>;
export type Hypothesis = z.infer<typeof HypothesisSchema>;
export type WatchListItem = z.infer<typeof WatchListItemSchema>;
export type AppliedChange = z.infer<typeof AppliedChangeSchema>;
export type WorkingMemory = z.infer<typeof WorkingMemorySchema>;
