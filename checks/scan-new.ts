// Checks the tokens behind the newest PancakeSwap v2 pools (the ones Four.meme and Flap launches graduate into).
// Usage: pnpm tsx checks/scan-new.ts [blocks back, default 3000] [max tokens, default 15]
import { getAddress, parseAbiItem, type Address } from "viem";
import { ADDR, QUOTES, client } from "./chain.js";
import { checkToken } from "./check.js";

const back = BigInt(process.argv[2] ?? 3000);
const max = Number(process.argv[3] ?? 15);
const funded = process.argv.includes("--funded"); // only show tokens with at least $1,000 in their pool
const latest = await client.getBlockNumber();
const event = parseAbiItem("event PairCreated(address indexed token0, address indexed token1, address pair, uint256 index)");

const tokens: Address[] = [];
for (let to = latest; to > latest - back && tokens.length < max * (funded ? 6 : 1); to -= 500n) {
  const logs = await client.getLogs({ address: ADDR.pancakeFactoryV2, event, fromBlock: to - 499n, toBlock: to });
  for (const l of logs.reverse()) {
    const [a, b] = [getAddress(l.args.token0!), getAddress(l.args.token1!)];
    const t = QUOTES.includes(a) ? b : QUOTES.includes(b) ? a : null;
    if (t && !tokens.includes(t)) tokens.push(t);
  }
}

const tally = { proceed: 0, caution: 0, avoid: 0, error: 0 };
for (const t of tokens) {
  try {
    const r = await checkToken(t, 100);
    if (funded && (r.numbers.liquidityUsd ?? 0) < 1000) continue;
    tally[r.verdict]++;
    const top = r.findings[0];
    console.log(`${r.verdict.padEnd(8)} ${(r.symbol ?? "?").slice(0, 12).padEnd(12)} ${t}  ${top?.text.slice(0, 110) ?? ""}`);
  } catch (e) {
    tally.error++;
    console.log(`error    ${t}  ${(e as Error).message.slice(0, 80)}`);
  }
}
console.log(`\n${tokens.length} new pools scanned from the last ${back} blocks${funded ? " (shown: pools with $1,000+)" : ""}:`, tally);
