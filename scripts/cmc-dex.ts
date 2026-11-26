import "../checks/env.js";
const key = process.env.CMC_API_KEY!;
for (const p of ["/v4/dex/spot-pairs/latest?network_slug=bnb&dex_slug=pancakeswap-v2&limit=3", "/v4/dex/spot-pairs/latest?network_slug=bnb-smart-chain&dex_slug=pancakeswap-v2&limit=3", "/v4/dex/spot-pairs/latest?network_id=14&dex_slug=pancakeswap-v2&limit=3"]) {
  const r = await fetch("https://pro-api.coinmarketcap.com" + p, { headers: { "X-CMC_PRO_API_KEY": key } });
  const j = (await r.json().catch(() => ({}))) as { data?: unknown; status?: { error_message?: string } };
  const arr = Array.isArray(j.data) ? (j.data as Record<string, unknown>[]) : [];
  console.log(r.status, p.split("&limit")[0], (j.status?.error_message ?? "").slice(0, 80), "items:", arr.length, arr[0] ? Object.keys(arr[0]).slice(0, 12).join(",") : "");
}
