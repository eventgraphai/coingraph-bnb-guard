// Records every check served by guard.coingraph.ai on BNB Smart Chain (ProofLog.record), one transaction per answer.
// - The evidence hash is keccak256 of the exact JSON returned to the caller, so anyone can recompute it.
// - Transactions go out one at a time (no nonce clashes) from the recorder wallet (AGENT_PRIVATE_KEY).
// - A daily cap protects the wallet; above it, checks still work and say "not recorded".
// - Every transaction's gas cost is logged (logs/proofs.jsonl) and totalled for the page.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { formatEther, type Hex } from "viem";
import { client } from "../checks/chain.js";
import { evidenceHash, VERDICT_CODE } from "../checks/answer.js";
import type { CheckResult } from "../checks/check.js";
import { ProofLog } from "../contracts/artifacts.generated.js";
import { agentWallet, type Deployment } from "../scripts/wallet.js";

const DAILY_CAP = Number(process.env.PROOF_DAILY_CAP ?? 500);
const deploymentFile = new URL("../deployments/bsc.json", import.meta.url);
const LOG_DIR = new URL("../logs/", import.meta.url);

export type Proof =
  | { recorded: true; txHash: Hex; evidenceHash: Hex; proofLog: string; explorer: string }
  | { recorded: false; evidenceHash: Hex; reason: string };

const stats = { recorded: 0, confirmed: 0, totalWei: 0n, day: "", today: 0, since: new Date().toISOString() };
let queue: Promise<unknown> = Promise.resolve();

function deployment(): Deployment | null {
  return existsSync(deploymentFile) ? (JSON.parse(readFileSync(deploymentFile, "utf8")) as Deployment) : null;
}
let wallet: ReturnType<typeof agentWallet> | null = null;
function recorder() {
  if (!wallet && process.env.AGENT_PRIVATE_KEY) wallet = agentWallet();
  return wallet;
}

export function proofEnabled() {
  return !!deployment() && !!process.env.AGENT_PRIVATE_KEY;
}

/** Sends ProofLog.record for this result and returns the transaction hash as soon as it is broadcast. */
export async function recordProof(r: CheckResult): Promise<Proof> {
  const eh = evidenceHash(r);
  const d = deployment();
  const w = recorder();
  if (!d || !w) return { recorded: false, evidenceHash: eh, reason: "On-chain recording is not configured on this server." };
  const day = new Date().toISOString().slice(0, 10);
  if (stats.day !== day) Object.assign(stats, { day, today: 0 });
  if (stats.today >= DAILY_CAP) return { recorded: false, evidenceHash: eh, reason: `Daily recording limit (${DAILY_CAP}) reached; this answer was not recorded.` };
  stats.today++;

  const send = async () => {
    const txHash = await w.writeContract({
      address: d.proofLog,
      abi: ProofLog.abi,
      functionName: "record",
      // answerHash = evidence hash for public checks (no agent-specific answer); token; verdict; chain; evidence; time.
      args: [eh, r.token, VERDICT_CODE[r.verdict], 56n, eh, BigInt(Math.floor(Date.parse(r.checkedAt) / 1000))],
    });
    stats.recorded++;
    // Log the cost once mined, without making the caller wait.
    client.waitForTransactionReceipt({ hash: txHash }).then((rc) => {
      const cost = rc.gasUsed * rc.effectiveGasPrice;
      stats.confirmed++;
      stats.totalWei += cost;
      try {
        mkdirSync(LOG_DIR, { recursive: true });
        appendFileSync(new URL("proofs.jsonl", LOG_DIR), JSON.stringify({ at: new Date().toISOString(), txHash, token: r.token, verdict: r.verdict, evidenceHash: eh, gasUsed: rc.gasUsed.toString(), costBnb: formatEther(cost), status: rc.status }) + "\n");
      } catch {}
    }).catch(() => {});
    return txHash;
  };
  const p = queue.then(send, send);
  queue = p.catch(() => {});
  try {
    const txHash = await p;
    return { recorded: true, txHash, evidenceHash: eh, proofLog: d.proofLog, explorer: `https://bscscan.com/tx/${txHash}` };
  } catch (e) {
    stats.today--;
    return { recorded: false, evidenceHash: eh, reason: `Recording failed: ${(e as Error).message.split("\n")[0].slice(0, 120)}` };
  }
}

// On start, count every answer already recorded on chain (and its gas cost), so the totals survive redeploys.
let loaded = false;
export async function loadChainTotals() {
  const d = deployment();
  if (!d || loaded) return;
  loaded = true;
  try {
    const deployRc = await client.getTransactionReceipt({ hash: d.proofLogTx as Hex });
    const logs = await client.getLogs({ address: d.proofLog, fromBlock: deployRc.blockNumber, toBlock: "latest" });
    const txs = [...new Set(logs.map((l) => l.transactionHash))];
    let total = 0n;
    for (const h of txs.slice(-500)) {
      const rc = await client.getTransactionReceipt({ hash: h });
      total += rc.gasUsed * rc.effectiveGasPrice;
    }
    stats.recorded += txs.length;
    stats.confirmed += txs.length;
    stats.totalWei += total;
    stats.since = new Date(Number((await client.getBlock({ blockNumber: deployRc.blockNumber })).timestamp) * 1000).toISOString();
  } catch {
    loaded = false; // try again on the next request
  }
}

export function proofStats(bnbPriceUsd?: number) {
  const bnb = Number(formatEther(stats.totalWei));
  const d = deployment();
  return {
    enabled: proofEnabled(),
    proofLog: d?.proofLog ?? null,
    guard: d?.guard ?? null,
    recorded: stats.recorded,
    confirmed: stats.confirmed,
    totalCostBnb: bnb,
    totalCostUsd: bnbPriceUsd ? bnb * bnbPriceUsd : null,
    averageCostUsd: bnbPriceUsd && stats.confirmed ? (bnb * bnbPriceUsd) / stats.confirmed : null,
    today: stats.today,
    dailyCap: DAILY_CAP,
    since: stats.since,
  };
}
