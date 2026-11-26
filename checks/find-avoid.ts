// Scans recent PancakeSwap v2 pools for tokens CoinGraph would stop: copycats, honeypots, high taxes, drained pools.
// Keeps only pools that once had real money (so "drained" is meaningful) or copy a famous name.
// Usage: pnpm tsx checks/find-avoid.ts [blocks back, default 60000] [max tokens to check, default 60]
import { getAddress, parseAbiItem, type Address } from "viem";
import { ADDR, QUOTES, client } from "./chain.js";
import { checkToken } from "./check.js";

const back = BigInt(process.argv[2] ?? 60000);
const max = Number(process.argv[3] ?? 60);
const latest = await client.getBlockNumber();
const ev = parseAbiItem("event PairCreated(address indexed token0, address indexed token1, address pair, uint256 index)");
const tokens: Address[] = [];
for (let to = latest; to > latest - back && tokens.length < max * 3; to -= 2000n) {
  const logs = await client.getLogs({ address: ADDR.pancakeFactoryV2, event: ev, fromBlock: to - 1999n, toBlock: to }).catch(() => []);
  for (const l of logs.reverse()) {
    const [a, b] = [getAddress(l.args.token0!), getAddress(l.args.token1!)];
    const t = QUOTES.includes(a) ? b : QUOTES.includes(b) ? a : null;
    if (t && !tokens.includes(t)) tokens.push(t);
  }
}
let checked = 0;
for (const t of tokens) {
  if (checked >= max) break;
  try {
    const r = await checkToken(t, 10);
    checked++;
    if (r.verdict !== "avoid") continue;
    const kinds = r.findings.filter((f) => f.level === "avoid").map((f) => f.check);
    // Skip launchpad tokens with empty pools (not a scam, just not graduated) unless they copy a famous name.
    if (kinds.length === 1 && kinds[0] === "liquidity" && (r.numbers.liquidityUsd ?? 0) < 1) continue;
    console.log(`${(r.symbol ?? "?").slice(0, 14).padEnd(14)} ${t}  [${kinds.join(", ")}]  ${r.findings.find((f) => f.level === "avoid")!.text.slice(0, 110)}`);
  } catch {}
}
console.log(`\nChecked ${checked} of ${tokens.length} recent pools.`);
