import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export interface ContextEntry {
  topic: string;
  description: string;
  priority: number;
  consumers: string[];
  body: string;
}

const GRASS_DIR = resolve(import.meta.dirname, "grass");

/**
 * Parse flat YAML front matter from a markdown string.
 */
function parseFrontMatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) meta[m[1]] = m[2];
  }
  return { meta, body: match[2].trim() };
}

function loadFile(filePath: string): ContextEntry {
  const raw = readFileSync(filePath, "utf-8");
  const { meta, body } = parseFrontMatter(raw);
  return {
    topic: meta.topic ?? "",
    description: meta.description ?? "",
    priority: Number(meta.priority ?? 99),
    consumers: meta.consumers ? meta.consumers.split(",").map((s) => s.trim()) : [],
    body,
  };
}

/**
 * Load all .md files from the grass context directory, sorted by priority.
 */
export function loadAllContext(): ContextEntry[] {
  const files = readdirSync(GRASS_DIR).filter((f) => f.endsWith(".md"));
  return files.map((f) => loadFile(resolve(GRASS_DIR, f))).sort((a, b) => a.priority - b.priority);
}

/**
 * Load context entries filtered to a specific consumer key.
 */
export function loadContextForConsumer(consumer: string): ContextEntry[] {
  const all = loadAllContext();
  const matched = all.filter((entry) => entry.consumers.includes(consumer));
  if (matched.length === 0) {
    // Fall back to all context if no specific match
    console.warn(`  [context] No files matched consumer "${consumer}", using all context.`);
    return all;
  }
  return matched;
}

/**
 * Concatenate context entries into a single markdown string.
 */
export function buildContextString(contexts: ContextEntry[]): string {
  return contexts.map((c) => c.body).join("\n\n");
}

/**
 * Load context appropriate for a specific grass_role.
 * Maps grass_role to the consumer key used in content-agentsy.
 */
export function loadContextForRole(role: "light" | "evaluate" | "integrate" | "execute"): string {
  const consumer = `creator-${role}`;
  const entries = loadContextForConsumer(consumer);
  return buildContextString(entries);
}

/**
 * Load context for the strategist agent.
 */
export function loadStrategistContext(): string {
  const entries = loadContextForConsumer("strategist");
  return buildContextString(entries);
}
