import { z } from "zod";

export const ValidationIssueSchema = z.object({
  severity: z.string().default("info"),
  category: z.string().default("quality"),
  description: z.string(),
  location: z.string().optional(),
  suggestion: z.string().optional(),
}).passthrough();

export const ValidationResultSchema = z.object({
  plan_id: z.string().optional().default(""),
  verdict: z.enum(["approved", "rejected"]),
  issues: z.array(ValidationIssueSchema).default([]),
  scores: z.object({
    factual_accuracy: z.number().default(0),
    geo_optimization: z.number().default(0),
    brand_alignment: z.number().default(0),
    overall_quality: z.number().default(0),
  }).passthrough(),
  rejection_reason: z.string().optional(),
  validated_at: z.string().optional().default(""),
}).passthrough();

export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;
export type ValidationResult = z.infer<typeof ValidationResultSchema>;
