import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const TOPICS_PATH = resolve(import.meta.dirname, "../../data/topics.json");

export interface Topic {
  id: string;
  label: string;
  rationale: string;
  subreddits: string[];
  created_at: string;
}

export interface TopicRegistry {
  topics: Topic[];
}

export interface TopicUpsert {
  id: string;
  label: string;
  rationale: string;
  subreddits: string[];
  is_new: boolean;
}

export function loadTopics(): TopicRegistry {
  if (!existsSync(TOPICS_PATH)) return { topics: [] };
  try {
    return JSON.parse(readFileSync(TOPICS_PATH, "utf-8")) as TopicRegistry;
  } catch {
    return { topics: [] };
  }
}

export function saveTopics(registry: TopicRegistry): void {
  writeFileSync(TOPICS_PATH, JSON.stringify(registry, null, 2));
}

export function getTopicById(registry: TopicRegistry, id: string): Topic | null {
  return registry.topics.find((t) => t.id === id) ?? null;
}

/**
 * Create a new topic or merge subreddits into an existing one.
 * Called after strategist response — no approval gate.
 */
export function upsertTopicFromStrategist(registry: TopicRegistry, upsert: TopicUpsert): void {
  const existing = registry.topics.find((t) => t.id === upsert.id);

  if (!existing) {
    // Create — even if is_new is false, create it if it doesn't exist
    registry.topics.push({
      id: upsert.id,
      label: upsert.label,
      rationale: upsert.rationale,
      subreddits: [...new Set(upsert.subreddits)],
      created_at: new Date().toISOString(),
    });
  } else {
    // Merge subreddits (deduplicate)
    const merged = [...new Set([...existing.subreddits, ...upsert.subreddits])];
    existing.subreddits = merged;
  }
}
