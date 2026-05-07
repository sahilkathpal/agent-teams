import { z } from "zod";

export const ResearchSignalSchema = z.object({
  source: z.string(),
  url: z.string(),
  title: z.string(),
  excerpt: z.string(),
  engagement: z.number().optional(),
});

export const QuotableEvidenceSchema = z.object({
  quote: z.string(),
  source: z.string(),
  url: z.string(),
});

export const CompetitorContentSchema = z.object({
  domain: z.string(),
  url: z.string(),
  summary: z.string(),
});

export const ResearchBriefSchema = z.object({
  plan_id: z.string(),
  topic: z.string(),
  signals: z.array(ResearchSignalSchema),
  key_findings: z.array(z.string()),
  user_pain_points: z.array(z.string()),
  quotable_evidence: z.array(QuotableEvidenceSchema),
  competitor_content: z.array(CompetitorContentSchema),
  researched_at: z.string(),
});

export type ResearchSignal = z.infer<typeof ResearchSignalSchema>;
export type ResearchBrief = z.infer<typeof ResearchBriefSchema>;
