// One live Cournot call for the BNB downside claim, printing the claim, market, probability and evidence.
// Usage: npx tsx scripts/cournot-probe.ts [symbol] [priceUsd]     (uses one Cournot call unless cached)
import { ADDR, client } from "../checks/chain.js";
import { downsideClaim, marketRisk, resolveClaim, underlyingFor } from "../checks/cournot.js";

const symbol = process.argv[2] ?? "BNB";
let price = Number(process.argv[3]);
if (!price) {
  const outs = await client.readContract({ address: ADDR.pancakeRouterV2, abi: [{ type: "function", name: "getAmountsOut", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "address[]" }], outputs: [{ type: "uint256[]" }] }], functionName: "getAmountsOut", args: [10n ** 18n, [ADDR.WBNB, ADDR.USDT]] });
  price = Number(outs[1]) / 1e18;
}
for (const drop of [0.1, 0.15, 0.2, 0.25]) {
  const claim = downsideClaim(underlyingFor(symbol), price, drop);
  console.log(`Price $${price.toFixed(2)}, -${drop * 100}% -> ${claim}\n  market:`, await resolveClaim(claim));
}
if (process.argv.includes("--resolve-only")) process.exit(0);
const r = await marketRisk(symbol, price);
console.log(JSON.stringify(r, null, 2).slice(0, 4000));
