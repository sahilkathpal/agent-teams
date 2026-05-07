import { initDb } from "../db/schema.js";
import { runScorer } from "../tools/scorer.js";
import "dotenv/config";

initDb();
const scorecard = await runScorer();
console.log(JSON.stringify(scorecard, null, 2));
