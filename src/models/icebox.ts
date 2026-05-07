import { z } from "zod";

export const IceboxEntrySchema = z.object({
  id: z.string(),
  platform: z.string(),
  run_id: z.string(),
  article_slug: z.string().optional(),
  article_title: z.string().optional(),
  action: z.string(),
  talking_points: z.array(z.string()).default([]),
  priority: z.string(),
  reason: z.string(),
  composite_score: z.number(),
  iceboxed_at: z.string(),
});

export const ChannelSummarySchema = z.object({
  times_recommended: z.number(),
  avg_priority_score: z.number(),
  last_recommended: z.string(),
  sample_actions: z.array(z.string()),
});

export const IceboxSchema = z.object({
  entries: z.array(IceboxEntrySchema).default([]),
  channel_summary: z.record(ChannelSummarySchema).default({}),
});

export type IceboxEntry = z.infer<typeof IceboxEntrySchema>;
export type ChannelSummary = z.infer<typeof ChannelSummarySchema>;
export type Icebox = z.infer<typeof IceboxSchema>;
