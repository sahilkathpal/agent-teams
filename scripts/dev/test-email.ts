import { sendProposalEmail } from "../notifications/email.js";
import type { MetaAgentOutput } from "../models/change-proposal.js";
import type { CitationScorecard } from "../models/citation-scorecard.js";
import "dotenv/config";

const scorecard: CitationScorecard = {
  run_id: "test-2026-05-07",
  scored_at: new Date().toISOString(),
  citation_coverage_pct: 42,
  prompts_tracked: 15,
  position_weighted_sov: 18.3,
  median_citation_position: 2,
  articles_cited_7d: 7,
  citations_by_engine: { ChatGPT: 34, Perplexity: 21, "Google AI": 12 },
  geo_quadrant: [
    { article_slug: "a", quadrant: "star" },
    { article_slug: "b", quadrant: "star" },
    { article_slug: "c", quadrant: "star" },
    { article_slug: "d", quadrant: "orphan" },
    { article_slug: "e", quadrant: "orphan" },
  ],
};

const output: MetaAgentOutput = {
  run_id: "test-2026-05-07",
  analyzed_at: new Date().toISOString(),

  strategy_notes: [
    "ChatGPT citations up 12% week-over-week — long-form content is driving most of the gain.",
    "Perplexity continues to favour listicle-style answers; our structured articles are underperforming there.",
  ],

  proposals: [
    {
      proposal_id: "prop-001",
      agent: "creator",
      confidence: "high",
      proposed_change: "Add a FAQ section to every article above 1,200 words.",
      reasoning: "Articles with FAQ sections were cited 3× more often across all engines in the last 30 days.",
      expected_impact: { citation_coverage: "+8–12%", sov: "+4%" },
    },
    {
      proposal_id: "prop-002",
      agent: "strategist",
      confidence: "medium",
      proposed_change: "Deprioritise listicle formats for Perplexity-targeted content.",
      reasoning: "Perplexity citation rate for listicles dropped from 31% to 19% over 6 weeks.",
      expected_impact: { perplexity_sov: "+3%", output_volume: "-10%" },
    },
  ],

  memory_updates: {
    add_insights: [
      { claim: "Long-form articles (>1,500 words) get cited more in ChatGPT", evidence: "...", confidence: 0.78 },
    ],
    update_insights: [
      { claim: "FAQ sections improve citation rate", new_confidence: 0.91, new_evidence: "..." },
    ],
    retire_insights: [
      { claim: "Short posts rank well in Perplexity", reason: "No correlation across 20+ articles published this quarter" },
    ],
    add_hypotheses: [
      { hypothesis: "Adding author bios improves trust signals in AI citations", test_criteria: "Compare citation rate for articles with vs without bios", cycles_needed: 4 },
    ],
    hypothesis_results: [
      { hypothesis: "Images reduce citation rate", result: "rejected", evidence: "No correlation found across 12 articles; image-heavy articles performed on par with text-only" },
      { hypothesis: "Competitive comparison pages get cited more in Perplexity", result: "confirmed", evidence: "Cited in 67% of competitive queries vs 31% baseline" },
      { hypothesis: "Shorter titles improve citation rate", result: "inconclusive", evidence: "Mixed results across ChatGPT and Perplexity; needs more data" },
    ],
  },

  prompt_updates: {
    add: [
      { prompt: "best project management tool for remote teams", cluster: "competitive", reason: "High volume query with no current coverage; competitors rank well", source: "competitor_gap", expected_volume: "high" },
    ],
    retire: [
      { prompt: "what is a gantt chart", reason: "Zero citations across 8 weeks; too generic for our content positioning" },
    ],
    recluster: [
      { prompt: "linear vs jira for startups", from_cluster: "onboarding", to_cluster: "competitive", reason: "Performs with competitive content patterns, not onboarding" },
    ],
  },
};

console.log("Sending test email...");
await sendProposalEmail(output, scorecard);
console.log("Done.");
