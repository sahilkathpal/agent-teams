import { initDb } from "../db/schema.js";
import { runOtterlyScraper, findLatestExports } from "../sync/otterly-scraper.js";
import { syncOtterly } from "../sync/sync-otterly.js";
import "dotenv/config";

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const scrapeOnly = args.includes("--scrape-only");
const ingestOnly = args.includes("--ingest-only");

initDb();

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Usage: npm run sync -- [options]

Modes:
  (default)          Scrape Otterly CSVs then ingest into DB
  --scrape-only      Just download CSVs (no ingest)
  --ingest-only      Just ingest existing CSVs (no browser)

Options:
  --prompts-csv <path>    Path to prompts CSV (with --ingest-only)
  --citations-csv <path>  Path to citations CSV (with --ingest-only)
  --exports-dir <path>    Directory for CSV exports (default: data/otterly-exports/)
`);
  process.exit(0);
}

const exportsDir = getArg("--exports-dir");

if (ingestOnly) {
  // Ingest mode: use provided paths or auto-discover
  const promptsCsv = getArg("--prompts-csv");
  const citationsCsv = getArg("--citations-csv");

  if (promptsCsv || citationsCsv) {
    console.log("Ingesting specified CSV files...");
    await syncOtterly({ promptsCsv, citationsCsv });
  } else {
    // Auto-discover latest exports
    const latest = findLatestExports(exportsDir);
    if (!latest) {
      console.error("No CSV files found. Provide --prompts-csv and --citations-csv, or run without --ingest-only to scrape first.");
      process.exit(1);
    }
    console.log(`Auto-discovered latest exports:`);
    console.log(`  Prompts:  ${latest.promptsCsv}`);
    console.log(`  Citations: ${latest.citationsCsv}`);
    await syncOtterly(latest);
  }
} else if (scrapeOnly) {
  // Scrape mode: just download, don't ingest
  const result = await runOtterlyScraper(exportsDir);
  if (!result) {
    console.error("Scraper failed. Check Chrome is open and logged into app.otterly.ai.");
    process.exit(1);
  }
  console.log("\nCSVs downloaded. Run `npm run sync -- --ingest-only` to ingest.");
} else {
  // Full sync: scrape then ingest
  console.log("=== Step 1: Scraping Otterly CSVs ===\n");
  const scraped = await runOtterlyScraper(exportsDir);

  if (!scraped) {
    // Scraper failed — try auto-discovering existing files
    console.log("\nScraper failed. Checking for existing exports...");
    const latest = findLatestExports(exportsDir);
    if (!latest) {
      console.error("No CSV files available. Ensure Chrome is open and logged into app.otterly.ai.");
      process.exit(1);
    }
    console.log(`Found existing exports, ingesting those instead.`);
    console.log(`\n=== Step 2: Ingesting into DB ===\n`);
    await syncOtterly(latest);
  } else {
    console.log(`\n=== Step 2: Ingesting into DB ===\n`);
    await syncOtterly(scraped);
  }
}

console.log("\nSync complete.");
