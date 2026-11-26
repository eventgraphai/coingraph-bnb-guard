// Raw evidence for every recorded answer: the exact JSON an API or MCP caller received, keyed by its keccak256 hash.
// The ProofLog transaction stores that hash on BNB Smart Chain, so anyone can fetch the raw data here, hash it and match it.
// Sources: demo runs (proofs/*.json), the saved Cournot live check (proofs/cournot/live-check-*.json), and every check
// served by this server (EVIDENCE_DIR, default logs/evidence). Only entries whose hash recomputes exactly are indexed.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { decodeEventLog, keccak256, stringToHex, type Hex } from "viem";
import { client } from "../checks/chain.js";
import type { CheckResult } from "../checks/check.js";
import { ProofLog } from "../contracts/artifacts.generated.js";

const PROOFS = new URL("../proofs/", import.meta.url);
const STORE = process.env.EVIDENCE_DIR ? new URL(`file://${process.env.EVIDENCE_DIR.replace(/\/?$/, "/")}`) : new URL("../logs/evidence/", import.meta.url);
const hashOf = (raw: string) => keccak256(stringToHex(raw));
const index = new Map<string, string>(); // evidenceHash (lowercase) -> raw JSON string

function add(raw: string) { index.set(hashOf(raw).toLowerCase(), raw); }

function load() {
  try {
    for (const f of readdirSync(PROOFS).filter((x) => /^0x[0-9a-f]{64}\.json$/i.test(x))) {
      const d = JSON.parse(readFileSync(new URL(f, PROOFS), "utf8"));
      if (d?.check) add(JSON.stringify(d.check));
    }
  } catch {}
  try {
    const dir = new URL("cournot/", PROOFS);
    for (const f of readdirSync(dir).filter((x) => x.startsWith("live-check-"))) {
      const { proof, ...r } = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
      add(JSON.stringify(r));
    }
  } catch {}
  try {
    if (existsSync(STORE)) for (const f of readdirSync(STORE).filter((x) => x.endsWith(".json"))) add(readFileSync(new URL(f, STORE), "utf8"));
  } catch {}
}
load();

/** Keeps the exact JSON of a check result (what the caller received, without the proof field). Returns its hash. */
export function saveEvidence(r: CheckResult): Hex {
  const raw = JSON.stringify(r);
  const h = hashOf(raw);
  index.set(h.toLowerCase(), raw);
  try { mkdirSync(STORE, { recursive: true }); writeFileSync(new URL(`${h}.json`, STORE), raw); } catch {}
  return h;
}

export const getEvidence = (hash: string) => index.get(hash.toLowerCase()) ?? null;

const proofLogs = (() => {
  const set = new Set<string>();
  for (const f of ["bsc.json", "bsc-atlas.json"]) {
    try { const d = JSON.parse(readFileSync(new URL(`../deployments/${f}`, import.meta.url), "utf8")); if (d.proofLog) set.add(String(d.proofLog).toLowerCase()); } catch {}
  }
  return set;
})();
const VERDICTS = ["", "proceed", "caution", "avoid"];
const cache = new Map<string, unknown>();

/** Reads a ProofLog record from BNB Smart Chain and says whether its raw evidence is available here. */
export async function readRecord(tx: Hex) {
  if (cache.has(tx)) return cache.get(tx);
  const rc = await client.getTransactionReceipt({ hash: tx });
  const log = rc.logs.find((l) => proofLogs.has(l.address.toLowerCase()));
  if (!log) return { tx, found: false, reason: "This transaction has no CoinGraph ProofLog record." };
  const ev = decodeEventLog({ abi: ProofLog.abi, data: log.data, topics: log.topics }) as { args: { answerHash: Hex; token: Hex; verdict: number; chainId: bigint; evidenceHash: Hex; issuedAt: bigint } };
  const raw = getEvidence(ev.args.evidenceHash);
  const block = await client.getBlock({ blockNumber: rc.blockNumber });
  const out = {
    tx, found: true, status: rc.status, block: rc.blockNumber.toString(), time: new Date(Number(block.timestamp) * 1000).toISOString(),
    proofLog: log.address, from: rc.from, answerHash: ev.args.answerHash, token: ev.args.token, verdict: VERDICTS[ev.args.verdict] ?? String(ev.args.verdict),
    chainId: Number(ev.args.chainId), evidenceHash: ev.args.evidenceHash, issuedAt: new Date(Number(ev.args.issuedAt) * 1000).toISOString(),
    evidenceAvailable: !!raw, rawUrl: raw ? `/api/evidence/${ev.args.evidenceHash}` : null,
  };
  cache.set(tx, out);
  return out;
}
