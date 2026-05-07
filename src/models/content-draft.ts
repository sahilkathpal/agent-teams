import { z } from "zod";

/** Creator output: metadata + markdown content. */
export const ContentDraftSchema = z.object({
  plan_id: z.string(),
  title: z.string(),
  slug: z.string(),
  meta_description: z.string(),
  geo_targets: z.array(z.string()),
  format: z.string(),
  intent_mode: z.string(),
  grass_role: z.string(),
  external_links_used: z.array(z.object({
    url: z.string(),
    title: z.string(),
  })),
  internal_links_used: z.array(z.object({
    url: z.string(),
    title: z.string(),
  })),
  word_count: z.number().int(),
  created_at: z.string(),
  markdown: z.string(),
});

export type ContentDraft = z.infer<typeof ContentDraftSchema>;
