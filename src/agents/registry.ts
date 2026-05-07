/**
 * Agent Registry — defines each agent's identity, tools, and configuration.
 *
 * Only LLM-powered agents that reason belong here.
 * Deterministic code functions (publisher, distributor, scorer, monitor)
 * live in src/tools/ and are called either by the pipeline or by agents via Bash.
 *
 * Tool grants are FIXED IN CODE. The Meta-Agent can propose changes to
 * agent prompts but CANNOT modify which tools an agent has access to.
 */

export interface AgentDefinition {
  name: string;
  promptFile: string;
  model: string;
  allowedTools: string[];
  maxTurns: number;
  timeoutMs: number;
  description: string;
}

export const AGENTS: Record<string, AgentDefinition> = {
  scout: {
    name: "scout",
    promptFile: "scout",
    model: "claude-sonnet-4-6",
    allowedTools: ["Bash"],
    maxTurns: 10,
    timeoutMs: 8 * 60 * 1000, // 8 min — 10 bash turns, anything beyond is a hang
    description: "Scans HN, Reddit, and web for trending topics in AI coding tools",
  },
  strategist: {
    name: "strategist",
    promptFile: "strategist",
    model: "claude-sonnet-4-6",
    allowedTools: [],
    maxTurns: 1,
    timeoutMs: 8 * 60 * 1000, // 8 min — single turn but large input (scorecard + scout + blog index)
    description: "Analyzes citation gaps, picks content topic and distribution plan",
  },
  researcher: {
    name: "researcher",
    promptFile: "researcher",
    model: "claude-sonnet-4-6",
    allowedTools: ["Bash"],
    maxTurns: 15,
    timeoutMs: 20 * 60 * 1000, // 20 min — 15 turns with content extractions
    description: "Researches a topic using Parallel Web API, HN Algolia, GitHub API",
  },
  creator: {
    name: "creator",
    promptFile: "creator",
    model: "claude-sonnet-4-6",
    allowedTools: ["Bash"],
    maxTurns: 25,
    timeoutMs: 30 * 60 * 1000, // 30 min — 25 turns including publishing steps
    description: "Writes GEO-optimized content, validates, publishes draft, syndicates",
  },
  validator: {
    name: "validator",
    promptFile: "validator",
    model: "claude-sonnet-4-6",
    allowedTools: [],
    maxTurns: 1,
    timeoutMs: 3 * 60 * 1000, // 3 min — single turn QA check
    description: "QA checks on content before publication",
  },
  "meta-agent": {
    name: "meta-agent",
    promptFile: "meta-agent",
    model: "claude-sonnet-4-6",
    allowedTools: [],
    maxTurns: 1,
    timeoutMs: 5 * 60 * 1000, // 5 min — single turn synthesis
    description: "Analyzes performance across cycles, proposes agent improvements",
  },
};

/** Get an agent definition, throwing if not found. */
export function getAgent(name: string): AgentDefinition {
  const def = AGENTS[name];
  if (!def) throw new Error(`Unknown agent: ${name}. Available: ${Object.keys(AGENTS).join(", ")}`);
  return def;
}
