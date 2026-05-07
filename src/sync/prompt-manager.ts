import { getDb } from "../db/helpers.js";

/**
 * Get all actively tracked prompts.
 */
export function getTrackedPrompts(): Array<{
  prompt_id: number;
  prompt_text: string;
  intent_volume_monthly: number;
  source: string;
  cluster: string | null;
}> {
  const db = getDb();
  return db.prepare(`
    SELECT prompt_id, prompt_text, intent_volume_monthly, source, cluster
    FROM prompts
    WHERE status = 'active'
    ORDER BY prompt_text
  `).all() as Array<{
    prompt_id: number;
    prompt_text: string;
    intent_volume_monthly: number;
    source: string;
    cluster: string | null;
  }>;
}

/**
 * Get all geo_targets from published articles.
 */
export function getGeoTargets(): string[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT geo_targets FROM articles WHERE geo_targets != '[]'",
  ).all() as Array<{ geo_targets: string }>;

  const targets = new Set<string>();
  for (const row of rows) {
    const parsed = JSON.parse(row.geo_targets) as string[];
    for (const t of parsed) targets.add(t.toLowerCase().trim());
  }
  return [...targets].sort();
}

/**
 * Find geo_targets that aren't currently tracked as prompts.
 */
export function getUntrackedGeoTargets(): string[] {
  const targets = getGeoTargets();
  const db = getDb();

  const untracked: string[] = [];
  for (const target of targets) {
    const exists = db.prepare(
      "SELECT 1 FROM prompts WHERE LOWER(prompt_text) = ? AND status = 'active'",
    ).get(target);
    if (!exists) untracked.push(target);
  }
  return untracked;
}

/**
 * Add a prompt to the tracking list.
 */
export function addPrompt(
  text: string,
  source: "geo_target" | "adjacent_query" | "competitor_gap" | "manual" = "manual",
): number {
  const db = getDb();

  // Check if it exists but is retired — reactivate
  const existing = db.prepare(
    "SELECT prompt_id, status FROM prompts WHERE prompt_text = ?",
  ).get(text) as { prompt_id: number; status: string } | undefined;

  if (existing) {
    if (existing.status === "retired") {
      db.prepare("UPDATE prompts SET status = 'active', source = ? WHERE prompt_id = ?")
        .run(source, existing.prompt_id);
      console.log(`  [prompts] Reactivated: "${text}"`);
    }
    return existing.prompt_id;
  }

  const result = db.prepare(
    "INSERT INTO prompts (prompt_text, engines_tracked, status, source) VALUES (?, ?, 'active', ?)",
  ).run(text, JSON.stringify(["chatgpt", "perplexity", "google_aio", "copilot"]), source);

  console.log(`  [prompts] Added: "${text}" (source: ${source})`);
  return Number(result.lastInsertRowid);
}

/**
 * Retire a prompt (mark as inactive, keep for historical queries).
 */
export function retirePrompt(text: string, reason: string): boolean {
  const db = getDb();
  const result = db.prepare(
    "UPDATE prompts SET status = 'retired' WHERE prompt_text = ? AND status = 'active'",
  ).run(text);

  if (result.changes > 0) {
    console.log(`  [prompts] Retired: "${text}" — ${reason}`);
    return true;
  }
  return false;
}

/**
 * Get prompts with zero citations from any domain in the last N days.
 */
export function getStalePrompts(days: number = 30): Array<{
  prompt_id: number;
  prompt_text: string;
}> {
  const db = getDb();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().slice(0, 10);

  return db.prepare(`
    SELECT p.prompt_id, p.prompt_text
    FROM prompts p
    WHERE p.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM citations c
        WHERE c.prompt_id = p.prompt_id AND c.date >= ?
      )
    ORDER BY p.prompt_text
  `).all(sinceStr) as Array<{
    prompt_id: number;
    prompt_text: string;
  }>;
}

/**
 * Assign a prompt to a cluster.
 */
export function assignCluster(promptText: string, cluster: string): boolean {
  const db = getDb();
  const result = db.prepare(
    "UPDATE prompts SET cluster = ? WHERE prompt_text = ?",
  ).run(cluster, promptText);

  if (result.changes > 0) {
    console.log(`  [prompts] Assigned "${promptText}" → cluster "${cluster}"`);
    return true;
  }
  return false;
}

/**
 * Get all clusters with their prompt counts.
 */
export function getClusters(): Array<{ cluster: string; count: number }> {
  const db = getDb();
  return db.prepare(`
    SELECT cluster, COUNT(*) as count
    FROM prompts
    WHERE status = 'active' AND cluster IS NOT NULL
    GROUP BY cluster
    ORDER BY count DESC
  `).all() as Array<{ cluster: string; count: number }>;
}
