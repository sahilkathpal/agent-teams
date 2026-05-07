import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { readdirSync, mkdirSync } from "node:fs";
import { loadPrompt } from "../prompts/load.js";

const DEFAULT_EXPORTS_DIR = resolve(import.meta.dirname, "../../data/otterly-exports");

/**
 * Run the Otterly scraper — spawns `claude --chrome` to download CSVs.
 * Requires Chrome to be open and logged into app.otterly.ai.
 *
 * Returns the paths to the downloaded prompts and citations CSVs,
 * or null if the scraper failed.
 */
export async function runOtterlyScraper(
  exportsDir?: string,
): Promise<{ promptsCsv: string; citationsCsv: string } | null> {
  const dir = exportsDir ?? DEFAULT_EXPORTS_DIR;
  mkdirSync(dir, { recursive: true });

  // Get files before scraping to detect new ones
  const filesBefore = new Set(readdirSync(dir));

  const prompt = loadPrompt("otterly-scraper", {
    exports_dir: dir,
  });

  console.log("[otterly-scraper] Starting CSV export from app.otterly.ai...");
  console.log(`  Exports directory: ${dir}`);

  // Ensure Chrome is running (macOS)
  if (process.platform === "darwin") {
    const { execSync } = await import("node:child_process");
    try {
      execSync('open -a "Google Chrome"', { stdio: "ignore" });
      await new Promise((r) => setTimeout(r, 2000));
    } catch {
      console.warn("  Could not open Chrome — assuming it's already running");
    }
  }

  return new Promise((resolvePromise, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn("claude", [
      "--chrome",
      "--dangerously-skip-permissions",
      "--allowedTools", "Bash",
      "--max-turns", "150",
      "--model", "claude-sonnet-4-6",
      "-p",
      "--output-format", "text",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      // Stream output for visibility
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`claude CLI spawn failed: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        console.error(`[otterly-scraper] claude exited with code ${code}`);
        console.error(`  stderr: ${stderr.slice(0, 500)}`);
        resolvePromise(null);
        return;
      }

      // Find new files in exports directory
      const filesAfter = readdirSync(dir);
      const newFiles = filesAfter.filter((f) => !filesBefore.has(f) && f.endsWith(".csv"));

      const promptsCsv = newFiles.find((f) => f.startsWith("prompts-"));
      const citationsCsv = newFiles.find((f) => f.startsWith("citations-"));

      if (!promptsCsv || !citationsCsv) {
        console.error("[otterly-scraper] Expected prompts-*.csv and citations-*.csv but found:", newFiles);
        resolvePromise(null);
        return;
      }

      console.log(`[otterly-scraper] Downloaded:`);
      console.log(`  Prompts:  ${promptsCsv}`);
      console.log(`  Citations: ${citationsCsv}`);

      resolvePromise({
        promptsCsv: resolve(dir, promptsCsv),
        citationsCsv: resolve(dir, citationsCsv),
      });
    });

    // Send the prompt
    child.stdin.on("error", () => {});
    child.stdin.write(prompt, () => {
      child.stdin.end();
    });
  });
}

/**
 * Find the latest prompts and citations CSVs in the exports directory.
 */
export function findLatestExports(exportsDir?: string): { promptsCsv: string; citationsCsv: string } | null {
  const dir = exportsDir ?? DEFAULT_EXPORTS_DIR;

  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".csv")).sort().reverse();
    const promptsCsv = files.find((f) => f.startsWith("prompts-"));
    const citationsCsv = files.find((f) => f.startsWith("citations-"));

    if (!promptsCsv || !citationsCsv) return null;

    return {
      promptsCsv: resolve(dir, promptsCsv),
      citationsCsv: resolve(dir, citationsCsv),
    };
  } catch {
    return null;
  }
}
