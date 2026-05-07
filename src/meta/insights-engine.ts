import { getDb } from "../db/helpers.js";
import { getAllTraces } from "./trace-recorder.js";
import { getCurrentVersions } from "./version-tracker.js";
import { loadMemory } from "./working-memory.js";

// ── Types ────────────────────────────────────────────────────────

export interface VersionPerformance {
  version: string;
  articles: number;
  cited: number;
  citation_rate: number;
  total_citations: number;
  avg_position: number | null;
}

export interface MetricDataPoint {
  date: string;
  value: number;
}

export interface AttributionEntry {
  article_slug: string;
  article_url: string;
  citations_7d: number;
  run_id: string;
  agent_versions: Record<string, string>;
  created_at: string;
}

export interface DomainEffectivenessEntry {
  domain: string;
  citation_count: number;
  prompts_cited: number;
  avg_position: number;
}

export interface OverviewData {
  prompts_tracked: number;
  articles_count: number;
  citations_count: number;
  traces_count: number;
  agent_versions: Record<string, string>;
  memory_summary: {
    insights: number;
    hypotheses_total: number;
    hypotheses_testing: number;
    watch_list: number;
    applied_changes: number;
  };
  latest_scorecard: Record<string, unknown> | null;
}

// ── Queries ──────────────────────────────────────────────────────

/**
 * Compare performance across versions of a specific agent.
 * Joins traces → citations to see which agent version produced the best-cited articles.
 */
export function versionPerformance(agentName: string): VersionPerformance[] {
  const traces = getAllTraces();
  const db = getDb();

  const byVersion: Record<string, { articles: string[]; cited: number; totalCitations: number; positions: number[] }> = {};

  for (const trace of traces) {
    const version = trace.agent_versions[agentName];
    if (!version) continue;

    if (!byVersion[version]) {
      byVersion[version] = { articles: [], cited: 0, totalCitations: 0, positions: [] };
    }

    byVersion[version].articles.push(trace.article_slug ?? "no-article");

    if (trace.article_slug) {
      const citRows = db.prepare(`
        SELECT COUNT(*) as cnt, AVG(position) as avg_pos FROM citations
        WHERE article_slug = ?
      `).get(trace.article_slug) as { cnt: number; avg_pos: number | null };

      if (citRows.cnt > 0) {
        byVersion[version].cited++;
        byVersion[version].totalCitations += citRows.cnt;
        if (citRows.avg_pos !== null) byVersion[version].positions.push(citRows.avg_pos);
      }
    }
  }

  return Object.entries(byVersion).map(([version, data]) => ({
    version,
    articles: data.articles.length,
    cited: data.cited,
    citation_rate: data.articles.length > 0 ? Math.round((data.cited / data.articles.length) * 100) : 0,
    total_citations: data.totalCitations,
    avg_position: data.positions.length > 0
      ? Math.round((data.positions.reduce((a, b) => a + b, 0) / data.positions.length) * 100) / 100
      : null,
  }));
}

/**
 * Get a metric's trend over time from historical scorecards.
 */
export function metricTrend(metricName: string, limitDays?: number): MetricDataPoint[] {
  const db = getDb();

  let query = "SELECT scored_at, data FROM scorecards ORDER BY scored_at ASC";
  const params: unknown[] = [];

  if (limitDays) {
    const since = new Date();
    since.setDate(since.getDate() - limitDays);
    query = "SELECT scored_at, data FROM scorecards WHERE scored_at >= ? ORDER BY scored_at ASC";
    params.push(since.toISOString());
  }

  const rows = db.prepare(query).all(...params) as Array<{ scored_at: string; data: string }>;

  return rows
    .map((row) => {
      const data = JSON.parse(row.data);
      const value = data[metricName];
      if (value === undefined || value === null) return null;
      return { date: row.scored_at.slice(0, 10), value: Number(value) };
    })
    .filter((d): d is MetricDataPoint => d !== null);
}

/**
 * For each cited article, show which agent versions produced it.
 */
export function attributionReport(): AttributionEntry[] {
  const db = getDb();
  const traces = getAllTraces();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const since7d = sevenDaysAgo.toISOString().slice(0, 10);

  const results: AttributionEntry[] = [];

  for (const trace of traces) {
    if (!trace.article_slug) continue;

    const article = db.prepare(
      "SELECT url FROM articles WHERE slug = ?",
    ).get(trace.article_slug) as { url: string } | undefined;

    const citCount = (db.prepare(`
      SELECT COUNT(*) as n FROM citations WHERE article_slug = ? AND date >= ?
    `).get(trace.article_slug, since7d) as { n: number }).n;

    if (citCount > 0) {
      results.push({
        article_slug: trace.article_slug,
        article_url: article?.url ?? "",
        citations_7d: citCount,
        run_id: trace.run_id,
        agent_versions: trace.agent_versions,
        created_at: trace.created_at,
      });
    }
  }

  return results.sort((a, b) => b.citations_7d - a.citations_7d);
}

/**
 * Which domains get cited most across all tracked prompts?
 * Identifies which distribution channels are most effective.
 */
export function domainEffectiveness(): DomainEffectivenessEntry[] {
  const db = getDb();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const since7d = sevenDaysAgo.toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT domain,
      COUNT(*) as citation_count,
      COUNT(DISTINCT prompt_id) as prompts_cited,
      AVG(position) as avg_position
    FROM citations
    WHERE date >= ?
    GROUP BY domain
    ORDER BY citation_count DESC
    LIMIT 30
  `).all(since7d) as Array<{
    domain: string;
    citation_count: number;
    prompts_cited: number;
    avg_position: number;
  }>;

  return rows.map((r) => ({
    domain: r.domain,
    citation_count: r.citation_count,
    prompts_cited: r.prompts_cited,
    avg_position: Math.round(r.avg_position * 100) / 100,
  }));
}

/**
 * Report on all active and resolved hypotheses from working memory.
 */
export function hypothesisReport(): Array<{
  hypothesis: string;
  status: string;
  cycles_remaining: number;
  result_evidence?: string;
}> {
  const memory = loadMemory();
  return memory.hypotheses.map((h) => ({
    hypothesis: h.hypothesis,
    status: h.status,
    cycles_remaining: h.cycles_remaining,
    result_evidence: h.result_evidence,
  }));
}

/**
 * Overview dashboard data.
 */
export function overview(): OverviewData {
  const db = getDb();
  const versions = getCurrentVersions();
  const traces = getAllTraces();
  const memory = loadMemory();

  const promptCount = (db.prepare("SELECT COUNT(*) as n FROM prompts").get() as { n: number }).n;
  const articleCount = (db.prepare("SELECT COUNT(*) as n FROM articles").get() as { n: number }).n;
  const citationCount = (db.prepare("SELECT COUNT(*) as n FROM citations").get() as { n: number }).n;

  const latest = db.prepare(
    "SELECT data FROM scorecards ORDER BY scored_at DESC LIMIT 1",
  ).get() as { data: string } | undefined;

  return {
    prompts_tracked: promptCount,
    articles_count: articleCount,
    citations_count: citationCount,
    traces_count: traces.length,
    agent_versions: versions,
    memory_summary: {
      insights: memory.insights.length,
      hypotheses_total: memory.hypotheses.length,
      hypotheses_testing: memory.hypotheses.filter((h) => h.status === "testing").length,
      watch_list: memory.watch_list.length,
      applied_changes: memory.applied_changes.length,
    },
    latest_scorecard: latest ? JSON.parse(latest.data) as Record<string, unknown> : null,
  };
}
