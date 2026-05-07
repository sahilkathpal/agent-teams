import { readFileSync } from "node:fs";

// ── Row types ────────────────────────────────────────────────────────

export interface OtterlyPromptRow {
  prompt: string;
  country: string;
  tags: string;
  intent_volume_monthly: number;
  total_citations: number;
  your_brand_mentioned: number | null;
  all_engines_your_brand_rank: number | null;
  your_domain_cited: number | null;
  competitors: Record<string, { mentioned: number; cited: number }>;
}

export interface OtterlyCitationRow {
  prompt: string;
  country: string;
  service: string;
  title: string;
  url: string;
  position: number;
  date: string;
  domain: string;
  domain_category: string;
  my_brand_mentioned: boolean;
  competitors_mentioned: string;
}

// ── CSV parsing ──────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseDashNumber(val: string): number | null {
  if (val === "-" || val === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

// ── Parsers ──────────────────────────────────────────────────────────

export function parsePromptsCsv(csvPath: string): OtterlyPromptRow[] {
  const raw = readFileSync(csvPath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const rows: OtterlyPromptRow[] = [];

  const FIXED_COUNT = 9;
  const competitorHeaders: Array<{ name: string; type: "mentioned" | "cited" }> = [];
  for (let i = FIXED_COUNT; i < headers.length; i++) {
    const h = headers[i];
    const mentionedMatch = h.match(/^(.+?) mentioned$/);
    const citedMatch = h.match(/^(.+?) cited$/);
    if (mentionedMatch) competitorHeaders.push({ name: mentionedMatch[1], type: "mentioned" });
    else if (citedMatch) competitorHeaders.push({ name: citedMatch[1], type: "cited" });
  }

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length < FIXED_COUNT) continue;

    const competitors: Record<string, { mentioned: number; cited: number }> = {};
    for (let j = 0; j < competitorHeaders.length; j++) {
      const ch = competitorHeaders[j];
      const val = Number(fields[FIXED_COUNT + j] ?? "0") || 0;
      if (!competitors[ch.name]) competitors[ch.name] = { mentioned: 0, cited: 0 };
      competitors[ch.name][ch.type] = val;
    }

    rows.push({
      prompt: fields[0],
      country: fields[1],
      tags: fields[2],
      intent_volume_monthly: Number(fields[3]) || 0,
      total_citations: Number(fields[5]) || 0,
      your_brand_mentioned: parseDashNumber(fields[6]),
      all_engines_your_brand_rank: parseDashNumber(fields[7]),
      your_domain_cited: parseDashNumber(fields[8]),
      competitors,
    });
  }

  return rows;
}

export function parseCitationsCsv(csvPath: string): OtterlyCitationRow[] {
  const raw = readFileSync(csvPath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const rows: OtterlyCitationRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length < 11) continue;

    rows.push({
      prompt: fields[0],
      country: fields[1],
      service: fields[2],
      title: fields[3],
      url: fields[4],
      position: Number(fields[5]) || 0,
      date: fields[6],
      domain: fields[7],
      domain_category: fields[8],
      my_brand_mentioned: fields[9].toLowerCase() === "yes",
      competitors_mentioned: fields[10],
    });
  }

  return rows;
}
