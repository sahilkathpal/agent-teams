import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { log } from "./utils/run-logger.js";

export interface CallClaudeOpts {
  maxRetries?: number;
  maxTurns?: number;
  allowedTools?: string[];
  timeoutMs?: number;
  logPath?: string;
}

export interface ClaudeResult {
  text: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  num_turns: number;
}

/**
 * Extract JSON from a Claude response that may contain fences or preamble.
 */
export function extractJson(text: string): string {
  const jsonFence = text.match(/```json\s*\n?([\s\S]*?)\n?```/);
  if (jsonFence) return jsonFence[1].trim();

  const plainFence = text.match(/```\s*\n([\s\S]*?)\n?```/);
  if (plainFence) return plainFence[1].trim();

  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  if (firstBrace === -1 && firstBracket === -1) return text.trim();

  const start =
    firstBrace === -1 ? firstBracket
    : firstBracket === -1 ? firstBrace
    : Math.min(firstBrace, firstBracket);
  return text.slice(start).trim();
}

/**
 * Call Claude Code CLI with a prompt. Retries with exponential backoff.
 */
export function callClaude(
  prompt: string,
  model?: string,
  opts?: CallClaudeOpts,
): Promise<ClaudeResult> {
  const maxRetries = opts?.maxRetries ?? 2;

  async function attempt(retryNum: number): Promise<ClaudeResult> {
    try {
      return await callClaudeOnce(prompt, model, opts);
    } catch (err) {
      if (retryNum < maxRetries) {
        const delay = Math.pow(2, retryNum) * 1000;
        log(`[claude] retry ${retryNum + 1}/${maxRetries} after ${delay}ms — ${err instanceof Error ? err.message.slice(0, 100) : err}`);
        await new Promise((r) => setTimeout(r, delay));
        return attempt(retryNum + 1);
      }
      throw err;
    }
  }

  return attempt(0);
}

function callClaudeOnce(prompt: string, model?: string, opts?: CallClaudeOpts): Promise<ClaudeResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const args = ["-p", "--verbose", "--output-format", "json", "--max-turns", String(opts?.maxTurns ?? 5)];
    if (model) args.push("--model", model);
    if (opts?.allowedTools?.length) args.push("--allowedTools", ...opts.allowedTools);

    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (err) => reject(new Error(`claude CLI spawn failed: ${err.message}`)));

    let settled = false;
    const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      settle(() => {
        if (opts?.logPath) {
          try {
            writeFileSync(opts.logPath, stdout + (stderr ? `\n--- stderr ---\n${stderr}` : ""));
          } catch { /* ignore log write failures */ }
        }
        if (code !== 0) {
          reject(new Error(`claude CLI exited with code ${code}\nstderr: ${stderr}`));
        } else {
          // Parse JSON envelope
          try {
            const parsed = JSON.parse(stdout);
            // --verbose outputs a JSON array of messages; the result is the last "result" entry
            // Without --verbose it's a single object
            const envelope = Array.isArray(parsed)
              ? [...parsed].reverse().find((m: Record<string, unknown>) => m.type === "result") ?? parsed[parsed.length - 1]
              : parsed;
            const usage = (envelope as Record<string, unknown>).usage as Record<string, number> | undefined ?? {};
            resolve({
              text: (envelope as Record<string, unknown>).result as string ?? "",
              cost_usd: (envelope as Record<string, unknown>).total_cost_usd as number ?? 0,
              input_tokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
              output_tokens: usage.output_tokens ?? 0,
              duration_ms: (envelope as Record<string, unknown>).duration_ms as number ?? 0,
              num_turns: (envelope as Record<string, unknown>).num_turns as number ?? 1,
            });
          } catch {
            // Fallback: treat stdout as plain text
            resolve({
              text: stdout,
              cost_usd: 0,
              input_tokens: 0,
              output_tokens: 0,
              duration_ms: 0,
              num_turns: 1,
            });
          }
        }
      });
    });

    const timer = opts?.timeoutMs
      ? setTimeout(() => {
          settle(() => {
            child.kill("SIGKILL");
            reject(new Error(`claude CLI timed out after ${opts.timeoutMs! / 1000}s`));
          });
        }, opts.timeoutMs)
      : null;

    child.stdin.on("error", () => {});
    child.stdin.write(prompt, () => { child.stdin.end(); });
  });
}
