// The demo agent with the Atlas guard. It asks CoinGraph, records the signed answer on chain (ProofLog), fetches
// Atlas Oracle's signed price and appends it to the buy. The guard verifies Atlas's signature on chain, compares the
// price the agent would pay with Atlas's price, and only then applies CoinGraph's verdict.
// Usage: npx tsx scripts/demo-atlas.ts <token> <usd> [feedId]          (shows what would be sent)
//        npx tsx scripts/demo-atlas.ts <token> <usd> [feedId] --yes    (records the proof and sends the buy)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { formatEther, type Address, type Hex } from "viem";
import { ADDR, client } from "../checks/chain.js";
import { checkToken } from "../checks/check.js";
import { evidenceHash } from "../checks/answer.js";
import { atlasExtraData } from "../checks/atlas.js";
import { signAnswerAtlas, toAnswerAtlas } from "../checks/answer-atlas.js";
import { CoinGraphGuardAtlas, ProofLog } from "../contracts/artifacts.generated.js";
import { agentWallet, scan, signerAccount } from "./wallet.js";

const args = process.argv.slice(2).filter((a) => a !== "--yes");
const [token, usdArg, feedArg] = args;
const send = process.argv.includes("--yes");
if (!token) throw new Error("Usage: npx tsx scripts/demo-atlas.ts <token> <usd> [feedId] [--yes]");
const d = JSON.parse(readFileSync(new URL("../deployments/bsc-atlas.json", import.meta.url), "utf8")) as { guardAtlas: Address; proofLog: Address };
const wallet = agentWallet();
const agent = wallet.account.address;

// 1. Ask CoinGraph.
const r = await checkToken(token, Number(usdArg ?? 0.5));
console.log(`\nCoinGraph: ${r.symbol} for $${r.orderUsd} -> ${r.verdict.toUpperCase()}`);
for (const f of r.findings) console.log(`  ${f.level.padEnd(7)} ${f.text}`);

// 2. Sign the answer, naming the Atlas feed the guard must check on chain.
const block = await client.getBlock();
const answer = toAnswerAtlas(r, agent, block.timestamp, feedArg ? { feedId: feedArg } : {});
if (answer.atlasFeedId === "0x00000000") console.log("\nNo Atlas feed for this token: the guard will skip the oracle check.");
const sig = await signAnswerAtlas(signerAccount(), answer, 56, d.guardAtlas);
const hash = (await client.readContract({ address: d.guardAtlas, abi: CoinGraphGuardAtlas.abi, functionName: "answerHash", args: [answer] })) as Hex;
mkdirSync(new URL("../proofs/", import.meta.url), { recursive: true });
writeFileSync(new URL(`../proofs/${hash}.json`, import.meta.url), JSON.stringify({ guard: "CoinGraphGuardAtlas", answerHash: hash, evidenceHash: evidenceHash(r), answer: { ...answer, maxAmountIn: answer.maxAmountIn.toString(), issuedAt: answer.issuedAt.toString() }, signature: sig, check: r }, null, 2));
console.log(`\nAnswer hash ${hash} (Atlas feed ${parseInt(answer.atlasFeedId, 16) || "none"}, max gap ${answer.maxDevBps / 100}%)`);

const path = [ADDR.WBNB, r.token] as const;
const value = answer.maxAmountIn;
console.log(`Buy: ${formatEther(value)} BNB of ${r.symbol} through ${d.guardAtlas}`);
if (!send) {
  console.log("\nNothing sent. Run again with --yes to record the proof and send the buy.");
  process.exit(0);
}

// 3. Record the answer on chain, before the trade.
const proofTx = await wallet.writeContract({ address: d.proofLog, abi: ProofLog.abi, functionName: "record", args: [hash, r.token, answer.verdict, 56n, answer.evidenceHash, answer.issuedAt] });
await client.waitForTransactionReceipt({ hash: proofTx });
console.log(`Proof recorded:  ${scan("tx", proofTx)}`);

// 4. Fetch Atlas's signed price right before sending (it must be under 180 seconds old on chain) and append it.
const outs = await client.readContract({ address: ADDR.pancakeRouterV2, abi: [{ type: "function", name: "getAmountsOut", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "address[]" }], outputs: [{ type: "uint256[]" }] }], functionName: "getAmountsOut", args: [value, [...path]] }).catch(() => [0n, 0n]);
const minOut = (outs.at(-1)! * 95n) / 100n;
const extra = answer.atlasFeedId === "0x00000000" ? undefined : await atlasExtraData([String(parseInt(answer.atlasFeedId, 16))]);
const buyTx = await wallet.writeContract({ address: d.guardAtlas, abi: CoinGraphGuardAtlas.abi, functionName: "buy", args: [answer, sig, minOut, [...path], block.timestamp + 600n], value, gas: 500_000n, dataSuffix: extra });
const receipt = await client.waitForTransactionReceipt({ hash: buyTx });
console.log(`${receipt.status === "success" ? "Buy went through (Atlas price checked on chain)" : "Buy refused by the guard"}: ${scan("tx", buyTx)}`);
