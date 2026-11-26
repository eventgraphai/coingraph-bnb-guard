// Probes CoinMarketCap DEX, holder, security, OHLCV, AI and index endpoints with this plan (keys never printed).
import "../checks/env.js";
const key = process.env.CMC_API_KEY!;
const CAKE = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82";
const get = async (p: string, body?: unknown) => {
  const r = await fetch("https://pro-api.coinmarketcap.com" + p, { method: body ? "POST" : "GET", headers: { "X-CMC_PRO_API_KEY": key, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = (await r.json().catch(() => ({}))) as { data?: unknown; status?: { error_message?: string; error_code?: string | number } };
  const d = j.data as Record<string, unknown> | unknown[] | undefined;
  const shape = Array.isArray(d) ? `array(${d.length}) ${d[0] && typeof d[0] === "object" ? Object.keys(d[0] as object).slice(0, 10).join(",") : ""}` : d && typeof d === "object" ? `keys ${Object.keys(d).slice(0, 12).join(",")}` : String(d ?? "");
  console.log(`${r.ok ? "YES" : "no "} ${r.status} ${p.split("?")[0].padEnd(36)} ${r.ok ? shape.slice(0, 150) : (j.status?.error_message ?? "").slice(0, 90)}`);
  return j;
};
const pl = await get("/v1/dex/platform/list");
const bsc = Array.isArray(pl.data) ? (pl.data as { id: number; n: string }[]).filter((p) => /bsc|bnb/i.test(p.n)) : [];
console.log("   BSC platform entries:", JSON.stringify(bsc).slice(0, 200));
const plat = bsc[0]?.n ?? "bsc";
await get(`/v1/dex/token?platform=${plat}&address=${CAKE}`);
await get(`/v1/dex/token/pools?platform=${plat}&address=${CAKE}&size=5`);
await get(`/v1/dex/token/price?platform=${plat}&address=${CAKE}`);
await get(`/v1/dex/holders/count?platform=${plat}&tokenAddress=${CAKE}`);
await get(`/v1/dex/holders/trend/list?platform=${plat}&tokenAddress=${CAKE}&interval=1d&limit=2`);
await get(`/v1/dex/security/detail?platformName=${plat}&address=${CAKE}`);
await get(`/v1/k-line/candles?platform=${plat}&address=${CAKE}&interval=1h&limit=3`);
await get(`/v4/dex/pairs/quotes/latest?contract_address=0x0eD7e52944161450477ee417DE9Cd3a859b14fD0&network_id=14`);
await get(`/v5/cmc-ai/coins/latest?symbol=CAKE`);
await get(`/v1/altcoin-season-index/latest`);
await get(`/v5/real-world-assets/map?limit=3`);
await get(`/v1/dex/new/list`, { platformIds: bsc.map((b) => b.id), sortBy: "createTime", sortType: "desc" });
