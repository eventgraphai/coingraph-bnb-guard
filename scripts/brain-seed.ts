// Seeds Living Brain with CoinGraph Guard's mainnet history: every guarded run and the Cournot live check.
// For each record: read the ProofLog event on BNB Smart Chain, load the raw answer whose hash matches, and remember it.
// Usage: npx tsx scripts/brain-seed.ts            (needs LIVING_BRAIN_API_KEY and LIVING_BRAIN_SUBJECT_ID in .env)
import { readFileSync } from "node:fs";
import { brain, memoryEnabled, remember } from "../checks/memory.js";
import { getEvidence, readRecord } from "../web/evidence.js";

if (!memoryEnabled()) { console.error("Add LIVING_BRAIN_API_KEY and LIVING_BRAIN_SUBJECT_ID to .env first."); process.exit(1); }
const id = await brain();
console.log("Brain:", id);
const demo = JSON.parse(readFileSync(new URL("../web/data/demo.json", import.meta.url), "utf8"));
const txs: string[] = [...demo.runs, ...demo.atlasRuns].map((r: { proofTx: string }) => r.proofTx);
txs.push("0x905d50f9a2b331170ada9109330a5713ae35a0b9b066d95b81b3048a44d6261e"); // Cournot live check
for (const tx of txs) {
  const rec: any = await readRecord(tx as `0x${string}`);
  const raw = rec?.evidenceHash ? getEvidence(rec.evidenceHash) : null;
  if (!raw) { console.log("skip (no raw data)", tx); continue; }
  const r = JSON.parse(raw);
  const src: any = await remember({ token: r.token, symbol: r.symbol, name: r.name, verdict: r.verdict, demo: true, findings: r.findings.filter((f: { text: string }) => !/\$[0-9][0-9,.]* (buy|order)|moves the price|order/i.test(f.text)), evidenceHash: rec.evidenceHash, txHash: tx, checkedAt: r.checkedAt ?? rec.time });
  console.log(`${r.symbol} ${r.verdict} -> capture ${src?.id ?? "?"} ${src?.status ?? ""}`);
}
