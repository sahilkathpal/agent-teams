import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

let logPath: string | null = null;

export function setRunLogPath(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  logPath = path;
}

export function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stdout.write(line);
  if (logPath) appendFileSync(logPath, line);
}
