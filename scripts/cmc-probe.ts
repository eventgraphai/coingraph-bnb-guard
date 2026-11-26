// Tries CoinMarketCap endpoints with the key in .env and reports which ones this plan allows (no data or key printed).
import "../checks/env.js";
const key = process.env.CMC_API_KEY!;
const eps: [string, string][] = [
  ["Global metrics (total market cap, BTC dominance)", "/v1/global-metrics/quotes/latest"],
  ["Fear & Greed index", "/v3/fear-and-greed/latest"],
  ["Trending tokens", "/v1/cryptocurrency/trending/latest"],
  ["Gainers & losers", "/v1/cryptocurrency/trending/gainers-losers"],
  ["Categories (AI, memes, RWA…)", "/v1/cryptocurrency/categories?limit=5"],
  ["Category members", "/v1/cryptocurrency/category?id=6051a82566fc1b42617d6dc6"],
  ["Market pairs (where a token trades)", "/v2/cryptocurrency/market-pairs/latest?symbol=CAKE&limit=5"],
  ["Price history (OHLCV)", "/v2/cryptocurrency/ohlcv/historical?symbol=CAKE&count=3"],
  ["Price performance stats", "/v2/cryptocurrency/price-performance-stats/latest?symbol=CAKE"],
  ["Airdrops", "/v1/cryptocurrency/airdrops"],
  ["New listings", "/v1/cryptocurrency/listings/new?limit=5"],
  ["DEX: networks", "/v4/dex/networks/list"],
  ["DEX: BSC spot pairs (new pools, liquidity)", "/v4/dex/spot-pairs/latest?network_slug=BSC&limit=5"],
  ["Content: news and posts", "/v1/content/latest?limit=3"],
  ["Exchange list", "/v1/exchange/map?limit=3"],
];
for (const [name, path] of eps) {
  const r = await fetch("https://pro-api.coinmarketcap.com" + path, { headers: { "X-CMC_PRO_API_KEY": key } });
  const j = (await r.json().catch(() => ({}))) as { status?: { error_message?: string; credit_count?: number } };
  console.log(`${r.ok ? "YES" : "no "}  ${name.padEnd(46)} ${r.ok ? `(${j.status?.credit_count ?? "?"} credit)` : `${r.status} ${(j.status?.error_message ?? "").slice(0, 70)}`}`);
}
