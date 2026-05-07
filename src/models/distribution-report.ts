import { z } from "zod";

export const SyndicationResultSchema = z.object({
  platform: z.string(),
  url: z.string(),
  published_at: z.string(),
  status: z.enum(["published", "failed"]),
  error: z.string().optional(),
});

export const PlaybookItemSchema = z.object({
  platform: z.string(),
  action: z.string(),
  target_url: z.string().optional(),
  talking_points: z.array(z.string()),
  priority: z.enum(["high", "medium", "low"]),
  status: z.enum(["pending", "completed", "skipped"]),
  completed_url: z.string().optional(),
  completed_at: z.string().optional(),
});

export const DistributionReportSchema = z.object({
  plan_id: z.string(),
  canonical_url: z.string(),
  syndication_results: z.array(SyndicationResultSchema),
  manual_playbook: z.array(PlaybookItemSchema),
  distributed_at: z.string(),
});

export type SyndicationResult = z.infer<typeof SyndicationResultSchema>;
export type PlaybookItem = z.infer<typeof PlaybookItemSchema>;
export type DistributionReport = z.infer<typeof DistributionReportSchema>;
