import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { getDb } from "../db/helpers.js";
import { callClaude } from "../claude.js";

const PROMPTS_DIR = resolve(import.meta.dirname, "../prompts");
const VERSIONS_DIR = resolve(import.meta.dirname, "../../data/versions");

/** Hash a prompt file's contents. */
function hashPrompt(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** Get all agent names by scanning prompt files. */
function discoverAgents(): string[] {
  return readdirSync(PROMPTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(".md", ""));
}

/** Write a prompt snapshot to data/versions/<agent>/<version>.md. */
function writeSnapshotFile(agentName: string, version: string, content: string): void {
  const dir = resolve(VERSIONS_DIR, agentName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${version}.md`), content, "utf-8");
}

/** Read a prompt snapshot from data/versions/<agent>/<version>.md. */
function readSnapshotFile(agentName: string, version: string): string | null {
  const p = resolve(VERSIONS_DIR, agentName, `${version}.md`);
  try { return readFileSync(p, "utf-8"); } catch { return null; }
}

/** Call Haiku to generate a one-sentence semantic summary of what changed. */
async function buildChangeSummary(oldContent: string, newContent: string): Promise<string> {
  const prompt = `You are comparing two versions of an AI agent's system prompt. Write a single sentence (max 20 words) describing what changed — be specific about instructions added, removed, or modified. Focus on semantic meaning, not formatting.

OLD PROMPT:
${oldContent}

NEW PROMPT:
${newContent}

Respond with only the one-sentence summary. No preamble.`;

  try {
    const { text } = await callClaude(prompt, "claude-haiku-4-5-20251001", { maxTurns: 1 });
    return text.trim();
  } catch {
    return "prompt updated";
  }
}

/** Get the latest version number for an agent, or null if never tracked. */
function getLatestVersion(agentName: string): { version: string; prompt_hash: string } | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT version, prompt_hash FROM agent_versions
    WHERE agent_name = ?
    ORDER BY changed_at DESC
    LIMIT 1
  `).get(agentName) as { version: string; prompt_hash: string } | undefined;
  return row ?? null;
}

/** Bump a version string: "1.0" → "1.1", "1.9" → "1.10". */
function bumpMinor(version: string): string {
  const parts = version.split(".");
  const minor = parseInt(parts[1] ?? "0", 10) + 1;
  return `${parts[0]}.${minor}`;
}

/** Record a new version in the database and write snapshot file. */
function recordVersion(
  agentName: string,
  version: string,
  promptHash: string,
  promptContent: string,
  changeSummary: string,
): void {
  writeSnapshotFile(agentName, version, promptContent);
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO agent_versions
      (agent_name, version, prompt_hash, changed_at, change_summary)
    VALUES (?, ?, ?, ?, ?)
  `).run(agentName, version, promptHash, new Date().toISOString(), changeSummary);
}

/**
 * Check all agent prompt files against their last known versions.
 * Records new versions for any changed prompts.
 * Returns a map of agent name → current version.
 */
export async function trackVersions(): Promise<Record<string, string>> {
  const agents = discoverAgents();
  const versions: Record<string, string> = {};

  for (const agent of agents) {
    if (agent === "load") continue; // skip the loader utility

    const promptPath = resolve(PROMPTS_DIR, `${agent}.md`);
    const content = readFileSync(promptPath, "utf-8");
    const hash = hashPrompt(content);

    const latest = getLatestVersion(agent);

    if (!latest) {
      // First time tracking this agent
      const version = "1.0";
      recordVersion(agent, version, hash, content, "initial version");
      versions[agent] = version;
      console.log(`  [versions] ${agent}: initial version → ${version}`);
    } else if (latest.prompt_hash !== hash) {
      // Prompt changed — generate semantic summary
      const oldContent = readSnapshotFile(agent, latest.version) ?? "";
      const summary = await buildChangeSummary(oldContent, content);
      const version = bumpMinor(latest.version);
      recordVersion(agent, version, hash, content, summary);
      versions[agent] = version;
      console.log(`  [versions] ${agent}: ${latest.version} → ${version} (${summary})`);
    } else {
      // No change
      versions[agent] = latest.version;
    }
  }

  return versions;
}

/** Get version history for a specific agent. */
export function getAgentHistory(agentName: string): Array<{
  version: string;
  prompt_hash: string;
  changed_at: string;
  change_summary: string;
}> {
  const db = getDb();
  return db.prepare(`
    SELECT version, prompt_hash, changed_at, change_summary
    FROM agent_versions
    WHERE agent_name = ?
    ORDER BY changed_at DESC
  `).all(agentName) as Array<{
    version: string;
    prompt_hash: string;
    changed_at: string;
    change_summary: string;
  }>;
}

/** Get the prompt snapshot for a specific agent version. Reads from file. */
export function getPromptSnapshot(agentName: string, version: string): string | null {
  return readSnapshotFile(agentName, version);
}

/** Get all current agent versions. */
export function getCurrentVersions(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT agent_name, version FROM agent_versions
    WHERE (agent_name, changed_at) IN (
      SELECT agent_name, MAX(changed_at) FROM agent_versions GROUP BY agent_name
    )
  `).all() as Array<{ agent_name: string; version: string }>;

  const versions: Record<string, string> = {};
  for (const row of rows) {
    versions[row.agent_name] = row.version;
  }
  return versions;
}
