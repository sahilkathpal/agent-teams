import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

export interface SeenEntry {
  url: string;
  first_seen: string;
  last_seen: string;
  score: number | undefined;
  num_comments: number | undefined;
  source: string;
}

export type SeenLedger = Record<string, SeenEntry>;

export type Freshness = "new" | "resurfaced" | "recurring";

export interface ResurfaceThresholds {
  scoreMultiplier: number;
  scoreAbsolute: number;
  commentsMultiplier: number;
  commentsAbsolute: number;
}

const DEFAULT_THRESHOLDS: ResurfaceThresholds = {
  scoreMultiplier: 2,
  scoreAbsolute: 10,
  commentsMultiplier: 1.5,
  commentsAbsolute: 5,
};

const LEDGER_PATH = resolve(import.meta.dirname, "../../data/seen-urls.json");
const PRUNE_DAYS = 90;

/**
 * Normalize a URL for consistent deduplication.
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.protocol = "https:";
    u.hostname = u.hostname.replace(/^www\./, "");
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return url.replace(/\/+$/, "");
  }
}

/**
 * Load the seen-URLs ledger from disk.
 * Prunes entries with last_seen older than 90 days.
 */
export function loadLedger(): SeenLedger {
  let ledger: SeenLedger = {};

  try {
    const raw = readFileSync(LEDGER_PATH, "utf-8");
    ledger = JSON.parse(raw);
  } catch {
    return {};
  }

  const cutoff = Date.now() - PRUNE_DAYS * 24 * 60 * 60 * 1000;
  const pruned: SeenLedger = {};
  let prunedCount = 0;

  for (const [key, entry] of Object.entries(ledger)) {
    if (new Date(entry.last_seen).getTime() >= cutoff) {
      pruned[key] = entry;
    } else {
      prunedCount++;
    }
  }

  if (prunedCount > 0) {
    console.log(`  [ledger] pruned ${prunedCount} entries older than ${PRUNE_DAYS} days`);
  }

  return pruned;
}

/**
 * Save the ledger back to disk.
 */
export function saveLedger(ledger: SeenLedger): void {
  mkdirSync(dirname(LEDGER_PATH), { recursive: true });
  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
  console.log(`  [ledger] saved ${Object.keys(ledger).length} entries`);
}

/**
 * Classify a URL's freshness based on ledger history.
 * - "new": URL not seen before
 * - "resurfaced": seen before but score/comments grew significantly
 * - "recurring": seen before, no significant change
 */
export function classifyUrl(
  url: string,
  ledger: SeenLedger,
  score?: number,
  numComments?: number,
  thresholds: ResurfaceThresholds = DEFAULT_THRESHOLDS,
): Freshness {
  const key = normalizeUrl(url);
  const entry = ledger[key];
  if (!entry) return "new";

  if (score != null && entry.score != null && entry.score > 0) {
    if (
      score >= entry.score * thresholds.scoreMultiplier ||
      score >= entry.score + thresholds.scoreAbsolute
    ) {
      return "resurfaced";
    }
  }

  if (numComments != null && entry.num_comments != null && entry.num_comments > 0) {
    if (
      numComments >= entry.num_comments * thresholds.commentsMultiplier ||
      numComments >= entry.num_comments + thresholds.commentsAbsolute
    ) {
      return "resurfaced";
    }
  }

  return "recurring";
}

/**
 * Update the ledger with new URL data.
 */
export function updateLedger(
  ledger: SeenLedger,
  urls: Array<{ url: string; score?: number; num_comments?: number; source: string }>,
): void {
  const now = new Date().toISOString();

  for (const item of urls) {
    const key = normalizeUrl(item.url);
    const existing = ledger[key];

    if (existing) {
      existing.last_seen = now;
      if (item.score != null) existing.score = item.score;
      if (item.num_comments != null) existing.num_comments = item.num_comments;
    } else {
      ledger[key] = {
        url: item.url,
        first_seen: now,
        last_seen: now,
        score: item.score,
        num_comments: item.num_comments,
        source: item.source,
      };
    }
  }
}
