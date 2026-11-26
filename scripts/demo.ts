// The demo agent. Before buying, it asks CoinGraph, records the signed answer on BNB Smart Chain (ProofLog),
// then buys through CoinGraphGuard. The guard lets a "proceed" through and reverts on anything else.
// The full evidence is saved to proofs/<answerHash>.json so anyone can recompute the hash on chain.
// Usage: pnpm tsx scripts/demo.ts <token> <usd>          (shows the check and what would be sent)
//        pnpm tsx scripts/demo.ts <token> <usd> --yes    (records the proof and sends the buy)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { formatEther } from "viem";
import { ADDR, client } from "../checks/chain.js";
import { checkToken } from "../checks/check.js";
import { evidenceHash, signAnswer, toAnswer } from "../checks/answer.js";
import { CoinGraphGuard, ProofLog } from "../contracts/artifacts.generated.js";
import { agentWallet, scan, signerAccount, type Deployment } from "./wallet.js";

const [token, usdArg] = process.argv.slice(2);
const send = process.argv.includes("--yes");
if (!token) throw new Error("Usage: pnpm tsx scripts/demo.ts <token> <usd> [--yes]");
const d = JSON.parse(readFileSync(new URL("../deployments/bsc.json", import.meta.url), "utf8")) as Deployment;
const wallet = agentWallet();
const agent = wallet.account.address;

// 1. Ask CoinGraph.
const r = await checkToken(token, Number(usdArg ?? 1));
console.log(`\nCoinGraph: ${r.symbol} for $${r.orderUsd} -> ${r.verdict.toUpperCase()}`);
for (const f of r.findings) console.log(`  ${f.level.padEnd(7)} ${f.text}`);

// 2. Sign the answer (CoinGraph) and compute its on-chain hash.
const block = await client.getBlock();
const answer = toAnswer(r, agent, block.timestamp);
const sig = await signAnswer(signerAccount(), answer, 56, d.guard);
const hash = (await client.readContract({ address: d.guard, abi: CoinGraphGuard.abi, functionName: "answerHash", args: [answer] })) as `0x${string}`;
mkdirSync(new URL("../proofs/", import.meta.url), { recursive: true });
writeFileSync(new URL(`../proofs/${hash}.json`, import.meta.url), JSON.stringify({ answerHash: hash, evidenceHash: evidenceHash(r), answer: { ...answer, maxAmountIn: answer.maxAmountIn.toString(), issuedAt: answer.issuedAt.toString() }, signature: sig, check: r }, null, 2));
console.log(`\nAnswer hash ${hash}\nEvidence saved: proofs/${hash}.json`);

const path = [ADDR.WBNB, r.token] as const;
const value = answer.maxAmountIn;
console.log(`Buy: ${formatEther(value)} BNB of ${r.symbol} through the guard at ${d.guard}`);
if (!send) {
  console.log("\nNothing sent. Run again with --yes to record the proof and send the buy.");
  process.exit(0);
}

// 3. Record the answer on chain, before the trade.
const proofTx = await wallet.writeContract({ address: d.proofLog, abi: ProofLog.abi, functionName: "record", args: [hash, r.token, answer.verdict, 56n, answer.evidenceHash, answer.issuedAt] });
await client.waitForTransactionReceipt({ hash: proofTx });
console.log(`Proof recorded:  ${scan("tx", proofTx)}`);

// 4. Buy through the guard. A fixed gas limit makes the wallet send it even when the guard is expected to refuse,
//    so the refusal itself is on chain.
const outs = await client.readContract({ address: ADDR.pancakeRouterV2, abi: [{ type: "function", name: "getAmountsOut", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "address[]" }], outputs: [{ type: "uint256[]" }] }], functionName: "getAmountsOut", args: [value, [...path]] }).catch(() => [0n, 0n]);
const minOut = (outs.at(-1)! * 95n) / 100n;
const buyTx = await wallet.writeContract({ address: d.guard, abi: CoinGraphGuard.abi, functionName: "buy", args: [answer, sig, minOut, [...path], block.timestamp + 600n], value, gas: 400_000n });
const receipt = await client.waitForTransactionReceipt({ hash: buyTx });
console.log(`${receipt.status === "success" ? "Buy went through" : "Buy refused by the guard"}: ${scan("tx", buyTx)}`);
