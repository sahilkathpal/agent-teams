import { z } from "zod";

/** A single distribution target (syndication or manual). */
export const DistributionTargetSchema = z.object({
  platform: z.string(),
  type: z.enum(["syndication", "manual"]).optional().default("manual"),
  format: z.string().optional().default(""),
  reason: z.string().optional().default(""),
  priority: z.string().optional().default("medium"),
  action: z.string().optional(),
  talking_points: z.array(z.string()).optional(),
}).passthrough();

/** Scoring rubric: each dimension 1-5. */
export const ScoresSchema = z.object({
  demand: z.number().min(1).max(5),
  proximity: z.number().min(1).max(5),
  proof: z.number().min(1).max(5),
  freshness: z.number().min(1).max(5),
  defensibility: z.number().min(1).max(5),
});

/** Content plan: what to write (or refresh). */
export const ContentPlanSchema = z.object({
  plan_id: z.string().optional().default(""),
  topic_id: z.string().optional().default(""),
  action: z.enum(["create", "refresh"]).default("create"),
  refresh_target: z.object({
    slug: z.string(),
    url: z.string(),
    reason: z.string(),
    update_title: z.boolean().default(false),
  }).optional(),
  topic: z.string(),
  angle: z.string(),
  format: z.string().default("guide"),
  intent_mode: z.string().default("M1_EVALUATE"),
  geo_targets: z.array(z.string()).default([]),
  grass_role: z.enum(["light", "evaluate", "integrate", "execute"]).default("evaluate"),
  voice_type: z.string().default("engineer_voice"),
  reasoning: z.string().default(""),
  scores: ScoresSchema,
  composite_score: z.number().default(0),
  syndication_targets: z.array(z.string()).default([]),
  distribution_targets: z.array(DistributionTargetSchema).default([]),
}).passthrough();

/** Distribution playbook: landscape-level insights (per-plan targets are in ContentPlan). */
export const DistributionPlaybookSchema = z.object({
  canonical_channel: z.string().default("blog"),
  domain_insights: z.array(z.object({
    domain: z.string(),
    cited_pct: z.number().optional().default(0),
    our_presence: z.boolean().optional().default(false),
    recommendation: z.string().default(""),
  }).passthrough()).default([]),
}).passthrough();

/** Topic upsert: create a new topic or merge subreddits into an existing one. */
export const TopicUpsertSchema = z.object({
  id: z.string(),
  label: z.string(),
  rationale: z.string(),
  subreddits: z.array(z.string()),
  is_new: z.boolean(),
});

/** Full strategist output. */
export const StrategistOutputSchema = z.object({
  run_id: z.string(),
  content_plans: z.array(ContentPlanSchema),
  topic_upserts: z.array(TopicUpsertSchema).default([]),
  distribution_playbook: DistributionPlaybookSchema,
  strategy_notes: z.array(z.string()).default([]),
  analyzed_at: z.string().optional().default(""),
}).passthrough();

export type TopicUpsert = z.infer<typeof TopicUpsertSchema>;

export type DistributionTarget = z.infer<typeof DistributionTargetSchema>;
export type ContentPlan = z.infer<typeof ContentPlanSchema>;
export type DistributionPlaybook = z.infer<typeof DistributionPlaybookSchema>;
export type StrategistOutput = z.infer<typeof StrategistOutputSchema>;
