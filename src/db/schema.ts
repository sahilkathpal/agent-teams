import Database from "better-sqlite3";
import { resolve } from "node:path";

const DEFAULT_DB_PATH = resolve(import.meta.dirname, "../../data/measurement.db");

/**
 * Initialize (or open) the measurement SQLite database.
 * Creates all tables idempotently.
 */
export function initDb(dbPath?: string): Database.Database {
  const p = dbPath ?? process.env.MEASUREMENT_DB_PATH ?? DEFAULT_DB_PATH;
  const db = new Database(p);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    -- ── Content ──────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS articles (
      slug TEXT PRIMARY KEY,
      url TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      published_at TEXT NOT NULL,
      format TEXT,
      geo_targets TEXT DEFAULT '[]'
    );

    -- ── Citation tracking ────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS prompts (
      prompt_id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_text TEXT UNIQUE NOT NULL,
      intent_volume_monthly INTEGER DEFAULT 0,
      engines_tracked TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      source TEXT NOT NULL DEFAULT 'otterly',
      cluster TEXT
    );

    CREATE TABLE IF NOT EXISTS citations (
      citation_id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_id INTEGER NOT NULL REFERENCES prompts(prompt_id),
      engine TEXT NOT NULL,
      url TEXT NOT NULL,
      position INTEGER NOT NULL,
      date TEXT NOT NULL,
      domain TEXT NOT NULL,
      article_slug TEXT,
      brand_mentioned INTEGER DEFAULT 0,
      competitors_mentioned TEXT DEFAULT '',
      source TEXT NOT NULL DEFAULT 'otterly',
      UNIQUE(prompt_id, engine, url, date)
    );

    CREATE INDEX IF NOT EXISTS idx_citations_date ON citations(date);
    CREATE INDEX IF NOT EXISTS idx_citations_domain ON citations(domain);
    CREATE INDEX IF NOT EXISTS idx_citations_engine ON citations(engine);
    CREATE INDEX IF NOT EXISTS idx_citations_article ON citations(article_slug);

    CREATE TABLE IF NOT EXISTS competitors (
      name TEXT PRIMARY KEY,
      domains TEXT DEFAULT '[]'
    );

    -- ── Meta framework ───────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS agent_versions (
      agent_name TEXT NOT NULL,
      version TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      change_summary TEXT DEFAULT '',
      PRIMARY KEY (agent_name, version)
    );

    CREATE TABLE IF NOT EXISTS traces (
      trace_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      article_slug TEXT,
      topic_id TEXT,
      agent_versions TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_traces_run ON traces(run_id);
    CREATE INDEX IF NOT EXISTS idx_traces_article ON traces(article_slug);

    CREATE TABLE IF NOT EXISTS scorecards (
      scorecard_id TEXT PRIMARY KEY,
      scored_at TEXT NOT NULL,
      data TEXT NOT NULL
    );

    -- ── Proposals ────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS proposals (
      proposal_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      field TEXT NOT NULL,
      proposed_change TEXT NOT NULL,
      proposed_diff TEXT,
      reasoning TEXT NOT NULL,
      evidence_runs TEXT NOT NULL DEFAULT '[]',
      confidence TEXT NOT NULL,
      expected_impact TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      decision_reason TEXT,
      version_from TEXT,
      version_to TEXT,
      created_at TEXT NOT NULL,
      decided_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_proposals_agent ON proposals(agent);
    CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
  `);

  return db;
}
