import { z } from "zod";

export const ChangeProposalSchema = z.object({
  proposal_id: z.string(),
  agent: z.string(),
  field: z.enum(["prompt", "config"]),
  proposed_change: z.string(),
  proposed_diff: z.string().optional(),
  reasoning: z.string(),
  evidence_runs: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
  expected_impact: z.record(z.string(), z.string()),
});

export const MetaAgentOutputSchema = z.object({
  run_id: z.string(),
  analyzed_at: z.string(),

  // Change proposals for agent configs
  proposals: z.array(ChangeProposalSchema),

  // Working memory updates
  memory_updates: z.object({
    add_insights: z.array(z.object({
      claim: z.string(),
      evidence: z.string(),
      confidence: z.number().min(0).max(1),
    })),
    update_insights: z.array(z.object({
      claim: z.string(),
      new_confidence: z.number().min(0).max(1),
      new_evidence: z.string().optional(),
    })),
    retire_insights: z.array(z.object({
      claim: z.string(),
      reason: z.string(),
    })),
    add_hypotheses: z.array(z.object({
      hypothesis: z.string(),
      test_criteria: z.string(),
      cycles_needed: z.number().int(),
    })),
    hypothesis_results: z.array(z.object({
      hypothesis: z.string(),
      result: z.enum(["confirmed", "rejected", "inconclusive"]),
      evidence: z.string(),
    })),
  }),

  // Prompt curation suggestions
  prompt_updates: z.object({
    add: z.array(z.object({
      prompt: z.string(),
      cluster: z.string(),
      reason: z.string(),
      source: z.enum(["geo_target", "adjacent_query", "competitor_gap", "manual"]),
      expected_volume: z.enum(["high", "medium", "low", "unknown"]),
    })),
    retire: z.array(z.object({
      prompt: z.string(),
      reason: z.string(),
    })),
    recluster: z.array(z.object({
      prompt: z.string(),
      from_cluster: z.string().nullable(),
      to_cluster: z.string(),
      reason: z.string(),
    })),
  }),

  // High-level observations
  strategy_notes: z.array(z.string()),
});

export type ChangeProposal = z.infer<typeof ChangeProposalSchema>;
export type MetaAgentOutput = z.infer<typeof MetaAgentOutputSchema>;
