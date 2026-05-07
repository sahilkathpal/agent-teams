import { initDb } from "../db/schema.js";
import { trackVersions, getAgentHistory, getPromptSnapshot } from "../meta/version-tracker.js";
import "dotenv/config";

initDb();

const args = process.argv.slice(2);
const agentFlag = args.indexOf("--agent");
const diffFlag = args.indexOf("--diff");

if (diffFlag !== -1 && agentFlag !== -1) {
  // Show diff between two versions
  const agent = args[agentFlag + 1];
  const v1 = args[diffFlag + 1];
  const v2 = args[diffFlag + 2];

  if (!agent || !v1 || !v2) {
    console.log("Usage: npm run versions -- --agent <name> --diff <v1> <v2>");
    process.exit(1);
  }

  const snap1 = getPromptSnapshot(agent, v1);
  const snap2 = getPromptSnapshot(agent, v2);

  if (!snap1) { console.log(`Version ${v1} not found for ${agent}`); process.exit(1); }
  if (!snap2) { console.log(`Version ${v2} not found for ${agent}`); process.exit(1); }

  console.log(`\n${agent}: ${v1} → ${v2}\n`);
  console.log(`--- ${v1} (${snap1.length} chars)`);
  console.log(`+++ ${v2} (${snap2.length} chars)`);
  console.log(`\nCharacter diff: ${snap2.length - snap1.length > 0 ? "+" : ""}${snap2.length - snap1.length}`);

} else if (agentFlag !== -1) {
  // Show history for a specific agent
  const agent = args[agentFlag + 1];
  if (!agent) { console.log("Usage: npm run versions -- --agent <name>"); process.exit(1); }

  const history = getAgentHistory(agent);
  console.log(`\n${agent} version history:\n`);
  for (const h of history) {
    console.log(`  v${h.version}  ${h.changed_at}  ${h.change_summary}`);
  }

} else {
  // Show all current versions
  const versions = trackVersions();
  console.log("\nAgent versions:\n");
  for (const [agent, version] of Object.entries(versions).sort()) {
    console.log(`  ${agent.padEnd(15)} v${version}`);
  }
}
