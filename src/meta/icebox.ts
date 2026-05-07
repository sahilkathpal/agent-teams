import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { IceboxSchema, type Icebox, type IceboxEntry } from "../models/icebox.js";
import type { DistributionTarget } from "../models/content-plan.js";
import { createHash } from "node:crypto";

const ICEBOX_PATH = resolve(import.meta.dirname, "../../data/distribution-icebox.json");
const PRUNE_DAYS = 90;

const PRIORITY_SCORES: Record<string, number> = { high: 3, medium: 2, low: 1 };

/**
 * Load the distribution icebox from disk.
 */
export function loadIcebox(): Icebox {
  try {
    const raw = readFileSync(ICEBOX_PATH, "utf-8");
    return IceboxSchema.parse(JSON.parse(raw));
  } catch {
    return { entries: [], channel_summary: {} };
  }
}

/**
 * Save the icebox to disk.
 */
export function saveIcebox(icebox: Icebox): void {
  mkdirSync(dirname(ICEBOX_PATH), { recursive: true });
  writeFileSync(ICEBOX_PATH, JSON.stringify(icebox, null, 2));
}

/**
 * Add playbook items to the icebox and update channel summaries.
 */
export function addToIcebox(
  icebox: Icebox,
  items: Array<{
    target: DistributionTarget;
    runId: string;
    articleSlug?: string;
    articleTitle?: string;
    compositeScore: number;
  }>,
): number {
  const now = new Date().toISOString();
  let added = 0;

  for (const item of items) {
    const id = createHash("sha256")
      .update(`${item.target.platform}:${item.articleSlug ?? ""}:${item.runId}`)
      .digest("hex")
      .slice(0, 12);

    // Skip if already iceboxed (same id)
    if (icebox.entries.some((e) => e.id === id)) continue;

    const entry: IceboxEntry = {
      id,
      platform: item.target.platform,
      run_id: item.runId,
      article_slug: item.articleSlug,
      article_title: item.articleTitle,
      action: item.target.action ?? item.target.format ?? "",
      talking_points: item.target.talking_points ?? [],
      priority: item.target.priority ?? "medium",
      reason: item.target.reason ?? "",
      composite_score: item.compositeScore,
      iceboxed_at: now,
    };

    icebox.entries.push(entry);
    added++;

    // Update channel summary
    const platform = item.target.platform.toLowerCase();
    const existing = icebox.channel_summary[platform];
    const priorityScore = PRIORITY_SCORES[entry.priority] ?? 2;

    if (existing) {
      const totalScore = existing.avg_priority_score * existing.times_recommended + priorityScore;
      existing.times_recommended++;
      existing.avg_priority_score = totalScore / existing.times_recommended;
      existing.last_recommended = now;
      // Keep last 3 unique actions
      if (entry.action && !existing.sample_actions.includes(entry.action)) {
        existing.sample_actions.push(entry.action);
        if (existing.sample_actions.length > 3) existing.sample_actions.shift();
      }
    } else {
      icebox.channel_summary[platform] = {
        times_recommended: 1,
        avg_priority_score: priorityScore,
        last_recommended: now,
        sample_actions: entry.action ? [entry.action] : [],
      };
    }
  }

  return added;
}

/**
 * Remove icebox entries older than maxAge days.
 */
export function pruneIcebox(icebox: Icebox, maxAgeDays: number = PRUNE_DAYS): number {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const before = icebox.entries.length;
  icebox.entries = icebox.entries.filter(
    (e) => new Date(e.iceboxed_at).getTime() >= cutoff,
  );
  return before - icebox.entries.length;
}

/**
 * Get channel summary sorted by times_recommended (descending).
 */
export function getChannelSummary(icebox: Icebox): string {
  const sorted = Object.entries(icebox.channel_summary)
    .sort(([, a], [, b]) => b.times_recommended - a.times_recommended);

  if (sorted.length === 0) return "No distribution channels have been iceboxed yet.";

  return sorted
    .map(([platform, stats]) =>
      `- **${platform}**: recommended ${stats.times_recommended}× (avg priority: ${stats.avg_priority_score.toFixed(1)}/3, last: ${stats.last_recommended.slice(0, 10)}). Sample actions: ${stats.sample_actions.join(", ") || "n/a"}`,
    )
    .join("\n");
}
