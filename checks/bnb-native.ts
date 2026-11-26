// The largest tokens native to BNB Smart Chain by market cap (CoinMarketCap platform = BNB Smart Chain), each checked.
// Usage: pnpm tsx checks/bnb-native.ts [order USD, default 1] [how many, default 25]
import { writeFileSync, mkdirSync } from "node:fs";
import "./env.js";
import { checkToken } from "./check.js";

const key = process.env.CMC_API_KEY;
if (!key) throw new Error("Set CMC_API_KEY in .env");
const usd = Number(process.argv[2] ?? 1);
const want = Number(process.argv[3] ?? 25);
type L = { id: number; name: string; symbol: string; cmc_rank: number; quote: { USD: { market_cap: number } }; platform: { name: string; token_address: string } | null };
const r = await fetch("https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=500&convert=USD", { headers: { "X-CMC_PRO_API_KEY": key } });
const all = ((await r.json()) as { data: L[] }).data;
const bsc = all.filter((l) => l.platform && /BNB Smart Chain|BEP20/i.test(l.platform.name) && /^0x[0-9a-fA-F]{40}$/.test(l.platform.token_address) && !/USD|DAI|EUR/i.test(l.symbol)).slice(0, want);

const rows: { rank: number; symbol: string; name: string; marketCap: number; verdict: string; reason: string; token: string }[] = [];
for (const l of bsc) {
  try {
    const c = await checkToken(l.platform!.token_address, usd);
    const reason = c.findings.find((f) => f.level !== "ok")?.text ?? "All checks passed.";
    rows.push({ rank: l.cmc_rank, symbol: l.symbol, name: l.name, marketCap: l.quote.USD.market_cap, verdict: c.verdict, reason, token: c.token });
    console.log(`#${String(l.cmc_rank).padEnd(4)} ${l.symbol.padEnd(8)} ${c.verdict.padEnd(8)} $${(l.quote.USD.market_cap / 1e6).toFixed(0).padStart(6)}M  ${reason.slice(0, 95)}`);
  } catch (e) {
    console.log(`#${String(l.cmc_rank).padEnd(4)} ${l.symbol.padEnd(8)} error    ${(e as Error).message.slice(0, 80)}`);
  }
}
mkdirSync(new URL("../web/data/", import.meta.url), { recursive: true });
writeFileSync(new URL("../web/data/bnb-native.json", import.meta.url), JSON.stringify({ orderUsd: usd, checkedAt: new Date().toISOString(), rows }, null, 2));
const n = (v: string) => rows.filter((x) => x.verdict === v).length;
console.log(`\n${rows.length} BNB-native tokens: ${n("proceed")} proceed, ${n("caution")} caution, ${n("avoid")} avoid`);
