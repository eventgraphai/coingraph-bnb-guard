// The 10 largest crypto assets by market cap (CoinMarketCap) that have an official BNB Smart Chain contract,
// each run through the full check. Usage: pnpm tsx checks/top10.ts [order size USD, default 500] [--json]
import { writeFileSync, mkdirSync } from "node:fs";
import "./env.js";
import { checkToken, type CheckResult } from "./check.js";

const key = process.env.CMC_API_KEY;
if (!key) throw new Error("Set CMC_API_KEY in .env");
const orderUsd = Number(process.argv[2] ?? 500);
const get = async (p: string) => {
  const r = await fetch(`https://pro-api.coinmarketcap.com${p}`, { headers: { "X-CMC_PRO_API_KEY": key } });
  const j = (await r.json()) as { data: unknown; status: { error_message: string | null } };
  if (!r.ok) throw new Error(`CMC ${r.status}: ${j.status.error_message}`);
  return j.data;
};

type Listing = { id: number; name: string; symbol: string; cmc_rank: number; quote: { USD: { market_cap: number } }; platform: { name: string; token_address: string } | null };
type Info = { contract_address?: { contract_address: string; platform: { name: string } }[] };
const STABLE = /USD|DAI|EUR/i; // stablecoins are not what an agent "checks before buying"

const listings = (await get("/v1/cryptocurrency/listings/latest?limit=60&convert=USD")) as Listing[];
const info = (await get(`/v2/cryptocurrency/info?id=${listings.map((l) => l.id).join(",")}`)) as Record<string, Info>;

const picked: { rank: number; name: string; symbol: string; marketCap: number; address: string }[] = [];
for (const l of listings) {
  if (STABLE.test(l.symbol)) continue;
  const own = l.platform && /BNB Smart Chain|BEP20/i.test(l.platform.name) ? l.platform.token_address : null;
  const bridged = info[String(l.id)]?.contract_address?.find((c) => /BNB Smart Chain|BEP20/i.test(c.platform?.name) && /^0x[0-9a-fA-F]{40}$/.test(c.contract_address))?.contract_address;
  // On BNB Chain, BNB trades as WBNB and Bitcoin as BTCB (CoinMarketCap lists BTCB separately as "Bitcoin BEP2").
  const native: Record<string, string> = { BNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", BTC: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c" };
  const address = native[l.symbol] ?? own ?? bridged ?? null;
  if (address) picked.push({ rank: l.cmc_rank, name: l.name, symbol: l.symbol, marketCap: l.quote.USD.market_cap, address });
  if (picked.length === 10) break;
}

const results: (CheckResult & { cmcRank: number; marketCapUsd: number; asset: string })[] = [];
for (const p of picked) {
  try {
    const r = await checkToken(p.address, orderUsd);
    results.push({ ...r, cmcRank: p.rank, marketCapUsd: p.marketCap, asset: `${p.name} (${p.symbol})` });
    const top = r.findings.find((f) => f.level !== "ok")?.text ?? "All checks passed.";
    console.log(`#${String(p.rank).padEnd(3)} ${p.symbol.padEnd(6)} ${r.verdict.padEnd(8)} ${top.slice(0, 120)}`);
  } catch (e) {
    console.log(`#${String(p.rank).padEnd(3)} ${p.symbol.padEnd(6)} error    ${(e as Error).message.slice(0, 100)}`);
  }
}
mkdirSync(new URL("../web/data/", import.meta.url), { recursive: true });
writeFileSync(new URL("../web/data/top10.json", import.meta.url), JSON.stringify({ orderUsd, checkedAt: new Date().toISOString(), results }, null, 2));
console.log(`\nSaved web/data/top10.json (${results.length} tokens, $${orderUsd} order each)`);
