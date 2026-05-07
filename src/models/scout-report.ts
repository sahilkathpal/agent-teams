import { z } from "zod";

export const ScoutReportSchema = z.object({
  scouted_at: z.string(),
  hot_topics: z.array(z.object({
    topic: z.string(),
    signal_strength: z.enum(["high", "medium"]),
    sources: z.array(z.string()),
    summary: z.string(),
    representative_links: z.array(z.string()).default([]),
    freshness_profile: z.object({
      new: z.number(),
      resurfaced: z.number(),
      recurring: z.number(),
    }).optional(),
  })).default([]),
  rising_tools: z.array(z.object({
    name: z.string(),
    description: z.string(),
    buzz_source: z.string(),
    url: z.string().default(""),
  })).default([]),
  developer_pain_points: z.array(z.string()).default([]),
  raw_signal_count: z.object({
    hn_posts: z.number().default(0),
    reddit_posts: z.number().default(0),
    web_results: z.number().default(0),
  }).default({}),
  subreddits_discovered: z.array(z.object({
    subreddit: z.string(),    // e.g. "ExperiencedDevs"
    query: z.string(),        // the query that surfaced it
    sample_url: z.string(),   // one representative post URL
  })).default([]),
}).passthrough();

export type ScoutReport = z.infer<typeof ScoutReportSchema>;
