import { getDb, saveScorecard } from "../db/helpers.js";
import type { CitationScorecard, GeoQuadrant, PromptCitation, DomainCitation, ClusterMetrics } from "../models/citation-scorecard.js";

const DOMAIN = process.env.SITE_DOMAIN ?? "codeongrass.com";
const NORTH_STAR_PROMPT = process.env.NORTH_STAR_PROMPT ?? "";
const OTTERLY_ENGINES = ["chatgpt", "perplexity", "google_aio", "copilot"];

/**
 * Scorer agent — computes the 8 core GEO metrics from SQLite data.
 * Pure computation, no LLM call needed.
 */
export async function runScorer(): Promise<CitationScorecard> {
  const db = getDb();
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const scorecardId = `geo_${today}`;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const since7d = sevenDaysAgo.toISOString().slice(0, 10);

  // ── 1. Citation Coverage ──────────────────────────────────────────

  const promptsCited = (db.prepare(`
    SELECT COUNT(DISTINCT prompt_id) as n FROM citations
    WHERE domain = ? AND date >= ?
  `).get(DOMAIN, since7d) as { n: number }).n;

  const promptsTracked = (db.prepare(
    "SELECT COUNT(*) as n FROM prompts",
  ).get() as { n: number }).n;

  const citationCoveragePct = promptsTracked > 0
    ? Math.round((promptsCited / promptsTracked) * 10000) / 100
    : 0;

  // ── 2. Citations by Engine ────────────────────────────────────────

  const engineRows = db.prepare(`
    SELECT engine, COUNT(*) as n FROM citations
    WHERE domain = ? AND date >= ?
    GROUP BY engine
  `).all(DOMAIN, since7d) as Array<{ engine: string; n: number }>;

  const citationsByEngine: Record<string, number> = {};
  for (const row of engineRows) citationsByEngine[row.engine] = row.n;

  // ── 3. Median Citation Position ───────────────────────────────────

  const positions = db.prepare(`
    SELECT position FROM citations
    WHERE domain = ? AND date >= ?
    ORDER BY position
  `).all(DOMAIN, since7d) as Array<{ position: number }>;

  let medianPosition: number | null = null;
  if (positions.length > 0) {
    const mid = Math.floor(positions.length / 2);
    medianPosition = positions.length % 2 === 0
      ? (positions[mid - 1].position + positions[mid].position) / 2
      : positions[mid].position;
  }

  // ── 4. Position-Weighted Share of Voice ────────────────────────────

  let sovTotal = 0;
  for (const engine of OTTERLY_ENGINES) {
    const ourScore = db.prepare(`
      SELECT SUM(1.0 / (LOG(position + 1) / LOG(2) + 1)) as score FROM citations
      WHERE engine = ? AND domain = ? AND date >= ?
    `).get(engine, DOMAIN, since7d) as { score: number | null };

    const totalScore = db.prepare(`
      SELECT SUM(1.0 / (LOG(position + 1) / LOG(2) + 1)) as score FROM citations
      WHERE engine = ? AND date >= ?
    `).get(engine, since7d) as { score: number | null };

    if (totalScore.score && ourScore.score) {
      sovTotal += ourScore.score / totalScore.score;
    }
  }
  sovTotal = OTTERLY_ENGINES.length > 0
    ? Math.round((sovTotal / OTTERLY_ENGINES.length) * 10000) / 100
    : 0;

  // ── 5. North Star Status ──────────────────────────────────────────

  const northStarStatus: Record<string, boolean> = {};
  if (NORTH_STAR_PROMPT) {
    const promptRow = db.prepare(
      "SELECT prompt_id, engines_tracked FROM prompts WHERE prompt_text = ?",
    ).get(NORTH_STAR_PROMPT) as { prompt_id: number; engines_tracked: string } | undefined;

    if (promptRow) {
      const engines = JSON.parse(promptRow.engines_tracked) as string[];
      for (const engine of engines) {
        const cited = db.prepare(`
          SELECT COUNT(*) as n FROM citations
          WHERE prompt_id = ? AND engine = ? AND domain = ? AND date >= ?
        `).get(promptRow.prompt_id, engine, DOMAIN, since7d) as { n: number };
        northStarStatus[engine] = cited.n > 0;
      }
    }
  }

  // ── 6. Articles Cited ─────────────────────────────────────────────

  const articlesCited = (db.prepare(`
    SELECT COUNT(DISTINCT article_slug) as n FROM citations
    WHERE article_slug IS NOT NULL AND date >= ?
  `).get(since7d) as { n: number }).n;

  // ── 7. GEO Quadrant ──────────────────────────────────────────────

  const articles = db.prepare("SELECT slug, url FROM articles WHERE status = 'published'").all() as Array<{ slug: string; url: string }>;
  const geoQuadrant: GeoQuadrant[] = [];

  for (const article of articles) {
    const citCount = (db.prepare(`
      SELECT COUNT(*) as n FROM citations
      WHERE article_slug = ? AND date >= ?
    `).get(article.slug, since7d) as { n: number }).n;

    const quadrant: "star" | "geo_only" | "orphan" =
      citCount > 0 ? "star" : "orphan";

    geoQuadrant.push({
      slug: article.slug,
      url: article.url,
      citations_7d: citCount,
      quadrant,
    });
  }

  // ── 8. Domain Citation Map ────────────────────────────────────────

  const allPrompts = db.prepare("SELECT prompt_id, prompt_text FROM prompts").all() as Array<{ prompt_id: number; prompt_text: string }>;
  const domainCitationMap: PromptCitation[] = [];

  for (const prompt of allPrompts) {
    // Check if our domain is cited for this prompt
    const ourCitations = db.prepare(`
      SELECT engine, position FROM citations
      WHERE prompt_id = ? AND domain = ? AND date >= ?
    `).all(prompt.prompt_id, DOMAIN, since7d) as Array<{ engine: string; position: number }>;

    const ourEngines = [...new Set(ourCitations.map((c) => c.engine))];
    const ourPositions = ourCitations.map((c) => c.position);
    const ourAvgPos = ourPositions.length > 0
      ? ourPositions.reduce((a, b) => a + b, 0) / ourPositions.length
      : null;

    // Get top domains for this prompt
    const domainRows = db.prepare(`
      SELECT domain, COUNT(*) as cnt, AVG(position) as avg_pos,
        GROUP_CONCAT(DISTINCT engine) as engines
      FROM citations
      WHERE prompt_id = ? AND date >= ?
      GROUP BY domain
      ORDER BY cnt DESC
      LIMIT 10
    `).all(prompt.prompt_id, since7d) as Array<{
      domain: string; cnt: number; avg_pos: number; engines: string;
    }>;

    const topDomains: DomainCitation[] = domainRows.map((r) => ({
      domain: r.domain,
      citation_count: r.cnt,
      avg_position: Math.round(r.avg_pos * 100) / 100,
      engines: r.engines.split(","),
    }));

    domainCitationMap.push({
      prompt_text: prompt.prompt_text,
      our_domain_cited: ourCitations.length > 0,
      our_position: ourAvgPos ? Math.round(ourAvgPos * 100) / 100 : null,
      our_engines: ourEngines,
      top_domains: topDomains,
    });
  }

  // ── Competitors ───────────────────────────────────────────────────

  const topCompetitors = db.prepare(`
    SELECT c.name, COUNT(*) as citations_7d
    FROM competitors c
    JOIN citations cit ON cit.date >= ? AND instr(cit.competitors_mentioned, c.name) > 0
    GROUP BY c.name
    ORDER BY citations_7d DESC
  `).all(since7d) as Array<{ name: string; citations_7d: number }>;

  // ── Cluster metrics ────────────────────────────────────────────────

  const clusterRows = db.prepare(`
    SELECT prompt_id, prompt_text, cluster FROM prompts
    WHERE status = 'active' AND cluster IS NOT NULL
  `).all() as Array<{ prompt_id: number; prompt_text: string; cluster: string }>;

  const clusterMap: Record<string, { prompts: number; cited: number; ourCitations: number; positions: number[]; totalCitations: number }> = {};

  for (const row of clusterRows) {
    if (!clusterMap[row.cluster]) {
      clusterMap[row.cluster] = { prompts: 0, cited: 0, ourCitations: 0, positions: [], totalCitations: 0 };
    }
    clusterMap[row.cluster].prompts++;

    const ourCites = (db.prepare(`
      SELECT COUNT(*) as n FROM citations WHERE prompt_id = ? AND domain = ? AND date >= ?
    `).get(row.prompt_id, DOMAIN, since7d) as { n: number }).n;

    const totalCites = (db.prepare(`
      SELECT COUNT(*) as n FROM citations WHERE prompt_id = ? AND date >= ?
    `).get(row.prompt_id, since7d) as { n: number }).n;

    if (ourCites > 0) {
      clusterMap[row.cluster].cited++;
      clusterMap[row.cluster].ourCitations += ourCites;

      const avgPos = (db.prepare(`
        SELECT AVG(position) as p FROM citations WHERE prompt_id = ? AND domain = ? AND date >= ?
      `).get(row.prompt_id, DOMAIN, since7d) as { p: number | null }).p;
      if (avgPos !== null) clusterMap[row.cluster].positions.push(avgPos);
    }
    clusterMap[row.cluster].totalCitations += totalCites;
  }

  const clusterMetrics: ClusterMetrics[] = Object.entries(clusterMap).map(([cluster, data]) => ({
    cluster,
    prompts: data.prompts,
    prompts_cited: data.cited,
    coverage_pct: data.prompts > 0 ? Math.round((data.cited / data.prompts) * 10000) / 100 : 0,
    total_our_citations: data.ourCitations,
    avg_position: data.positions.length > 0
      ? Math.round((data.positions.reduce((a, b) => a + b, 0) / data.positions.length) * 100) / 100
      : null,
    share_pct: data.totalCitations > 0
      ? Math.round((data.ourCitations / data.totalCitations) * 10000) / 100
      : 0,
  })).sort((a, b) => b.share_pct - a.share_pct);

  // ── Assemble ──────────────────────────────────────────────────────

  const scorecard: CitationScorecard = {
    scorecard_id: scorecardId,
    scored_at: now,
    domain: DOMAIN,
    citation_coverage_pct: citationCoveragePct,
    citations_by_engine: citationsByEngine,
    median_citation_position: medianPosition,
    position_weighted_sov: sovTotal,
    north_star_prompt: NORTH_STAR_PROMPT,
    north_star_status: northStarStatus,
    articles_cited_7d: articlesCited,
    geo_quadrant: geoQuadrant,
    domain_citation_map: domainCitationMap,
    cluster_metrics: clusterMetrics,
    prompts_tracked: promptsTracked,
    competitors: topCompetitors,
  };

  // Save to DB for historical trending
  saveScorecard(scorecardId, scorecard);

  console.log(`[scorer] Scorecard generated: ${scorecardId}`);
  console.log(`  Coverage: ${citationCoveragePct}%`);
  console.log(`  SOV: ${sovTotal}%`);
  console.log(`  Median position: ${medianPosition ?? "n/a"}`);
  console.log(`  Articles cited: ${articlesCited}`);

  return scorecard;
}
