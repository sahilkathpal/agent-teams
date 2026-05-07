import type Database from "better-sqlite3";
import { initDb } from "./schema.js";

const DOMAIN = process.env.SITE_DOMAIN ?? "codeongrass.com";

let _db: Database.Database | null = null;

/** Singleton accessor for the measurement database. */
export function getDb(): Database.Database {
  if (!_db) _db = initDb();
  return _db;
}

/** Extract slug from a URL, or null if not our domain. */
export function slugFromUrl(url: string, domain: string = DOMAIN): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith(domain)) return null;
    const parts = u.pathname.replace(/^\/|\/$/g, "").split("/");
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}

/** Merge two engine arrays into a sorted union. */
function mergeEngines(existing: string[], incoming: string[]): string[] {
  return [...new Set([...existing, ...incoming])].sort();
}

/** Upsert a prompt row. Merges engines on conflict. Returns prompt_id. */
export function upsertPrompt(
  text: string,
  engines: string[],
  volume?: number,
): number {
  const db = getDb();

  const existing = db.prepare(
    "SELECT prompt_id, engines_tracked FROM prompts WHERE prompt_text = ?",
  ).get(text) as { prompt_id: number; engines_tracked: string } | undefined;

  if (existing) {
    const merged = mergeEngines(JSON.parse(existing.engines_tracked) as string[], engines);
    db.prepare(
      "UPDATE prompts SET engines_tracked = ?, intent_volume_monthly = COALESCE(?, intent_volume_monthly) WHERE prompt_id = ?",
    ).run(JSON.stringify(merged), volume ?? null, existing.prompt_id);
    return existing.prompt_id;
  }

  const result = db.prepare(
    "INSERT INTO prompts (prompt_text, engines_tracked, intent_volume_monthly) VALUES (?, ?, ?)",
  ).run(text, JSON.stringify(engines), volume ?? 0);

  return Number(result.lastInsertRowid);
}

/** Insert a citation row. Deduplicates via unique constraint. */
export function upsertCitation(opts: {
  prompt_id: number;
  engine: string;
  url: string;
  position: number;
  date: string;
  domain: string;
  article_slug?: string | null;
  brand_mentioned?: number;
  competitors_mentioned?: string;
  source?: string;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO citations
      (prompt_id, engine, url, position, date, domain, article_slug,
       brand_mentioned, competitors_mentioned, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.prompt_id,
    opts.engine,
    opts.url,
    opts.position,
    opts.date,
    opts.domain,
    opts.article_slug ?? null,
    opts.brand_mentioned ?? 0,
    opts.competitors_mentioned ?? "",
    opts.source ?? "otterly",
  );
}

/** Upsert a competitor. */
export function upsertCompetitor(name: string, domains: string[] = []): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO competitors (name, domains) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET
      domains = CASE WHEN excluded.domains != '[]' THEN excluded.domains ELSE competitors.domains END
  `).run(name, JSON.stringify(domains));
}

/** Upsert an article. */
export function upsertArticle(opts: {
  slug: string;
  url: string;
  title: string;
  published_at: string;
  format?: string;
  geo_targets?: string[];
  status?: "draft" | "published";
}): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO articles (slug, url, title, published_at, format, geo_targets, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.slug,
    opts.url,
    opts.title,
    opts.published_at,
    opts.format ?? null,
    JSON.stringify(opts.geo_targets ?? []),
    opts.status ?? "published",
  );
}

/** Record a trace linking a run to agent versions and an article. */
export function recordTrace(opts: {
  trace_id: string;
  run_id: string;
  article_slug?: string;
  topic_id?: string;
  agent_versions: Record<string, string>;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO traces (trace_id, run_id, article_slug, topic_id, agent_versions, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    opts.trace_id,
    opts.run_id,
    opts.article_slug ?? null,
    opts.topic_id ?? null,
    JSON.stringify(opts.agent_versions),
    new Date().toISOString(),
  );
}

/** Save a scorecard snapshot. */
export function saveScorecard(id: string, data: unknown): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO scorecards (scorecard_id, scored_at, data)
    VALUES (?, ?, ?)
  `).run(id, new Date().toISOString(), JSON.stringify(data));
}

/** Record proposals from a meta-agent run. */
export function recordProposals(runId: string, proposals: Array<{
  proposal_id: string;
  agent: string;
  field: string;
  proposed_change: string;
  proposed_diff?: string;
  reasoning: string;
  evidence_runs: string[];
  confidence: string;
  expected_impact: Record<string, string>;
}>): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO proposals
      (proposal_id, run_id, agent, field, proposed_change, proposed_diff,
       reasoning, evidence_runs, confidence, expected_impact, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `);
  const now = new Date().toISOString();
  for (const p of proposals) {
    stmt.run(
      p.proposal_id, runId, p.agent, p.field, p.proposed_change,
      p.proposed_diff ?? null, p.reasoning, JSON.stringify(p.evidence_runs),
      p.confidence, JSON.stringify(p.expected_impact), now,
    );
  }
}

/** Mark a proposal as approved and record version change. */
export function approveProposal(proposalId: string, versionFrom: string, versionTo: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE proposals SET status = 'approved', version_from = ?, version_to = ?, decided_at = ?
    WHERE proposal_id = ?
  `).run(versionFrom, versionTo, new Date().toISOString(), proposalId);
}

/** Mark a proposal as rejected with a reason. */
export function rejectProposalDb(proposalId: string, reason: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE proposals SET status = 'rejected', decision_reason = ?, decided_at = ?
    WHERE proposal_id = ?
  `).run(reason, new Date().toISOString(), proposalId);
}
