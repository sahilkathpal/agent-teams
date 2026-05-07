import { z } from "zod";

/** Per-prompt domain citation: which domains get cited for this prompt. */
export const DomainCitationSchema = z.object({
  domain: z.string(),
  citation_count: z.number().int(),
  avg_position: z.number(),
  engines: z.array(z.string()),
});

/** Per-prompt citation landscape. */
export const PromptCitationSchema = z.object({
  prompt_text: z.string(),
  our_domain_cited: z.boolean(),
  our_position: z.number().nullable(),
  our_engines: z.array(z.string()),
  top_domains: z.array(DomainCitationSchema),
});

/** GEO-SEO quadrant per article. */
export const GeoQuadrantSchema = z.object({
  slug: z.string(),
  url: z.string(),
  citations_7d: z.number().int(),
  quadrant: z.enum(["star", "geo_only", "orphan"]),
});

/** Per-cluster performance metrics. */
export const ClusterMetricsSchema = z.object({
  cluster: z.string(),
  prompts: z.number().int(),
  prompts_cited: z.number().int(),
  coverage_pct: z.number(),
  total_our_citations: z.number().int(),
  avg_position: z.number().nullable(),
  share_pct: z.number(),
});

/** The 8 core GEO metrics + domain citation map + cluster metrics. */
export const CitationScorecardSchema = z.object({
  scorecard_id: z.string(),
  scored_at: z.string(),
  domain: z.string(),

  // Core metrics
  citation_coverage_pct: z.number(),
  citations_by_engine: z.record(z.string(), z.number().int()),
  median_citation_position: z.number().nullable(),
  position_weighted_sov: z.number(),
  north_star_prompt: z.string(),
  north_star_status: z.record(z.string(), z.boolean()),
  articles_cited_7d: z.number().int(),
  geo_quadrant: z.array(GeoQuadrantSchema),

  // Domain citation map (drives distribution strategy)
  domain_citation_map: z.array(PromptCitationSchema),

  // Cluster performance
  cluster_metrics: z.array(ClusterMetricsSchema),

  // Context
  prompts_tracked: z.number().int(),
  competitors: z.array(z.object({
    name: z.string(),
    citations_7d: z.number().int(),
  })),
});

export type DomainCitation = z.infer<typeof DomainCitationSchema>;
export type PromptCitation = z.infer<typeof PromptCitationSchema>;
export type GeoQuadrant = z.infer<typeof GeoQuadrantSchema>;
export type ClusterMetrics = z.infer<typeof ClusterMetricsSchema>;
export type CitationScorecard = z.infer<typeof CitationScorecardSchema>;
