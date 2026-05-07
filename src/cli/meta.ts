import { resolve } from "node:path";
import { initDb } from "../db/schema.js";
import { runScorer } from "../tools/scorer.js";
import { runMetaAgent } from "../agents/meta-agent.js";
import { sendProposalEmail } from "../notifications/email.js";
import "dotenv/config";

initDb();

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outPath = outIdx !== -1 && outIdx + 1 < args.length
  ? args[outIdx + 1]
  : resolve("data", "meta-output.json");

console.log("Running scorer...");
const scorecard = await runScorer();

console.log("\nRunning meta-agent...");
const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

const output = await runMetaAgent({
  scorecard,
  runId,
  outPath,
});

if (output) {
  console.log(`\nMeta-agent output saved to ${outPath}`);

  if (output.proposals.length > 0) {
    console.log("\nPending proposals:");
    for (const p of output.proposals) {
      console.log(`  [${p.confidence}] ${p.agent}: ${p.proposed_change}`);
    }
    console.log("\nRun 'npm run proposals' to review and accept/reject.");
  }

  await sendProposalEmail(output, scorecard);
}
