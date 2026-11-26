import "../checks/env.js";
const key = process.env.CMC_API_KEY!;
const r = await fetch("https://pro-api.coinmarketcap.com/v1/dex/tokens/batch-query", { method: "POST", headers: { "X-CMC_PRO_API_KEY": key, "Content-Type": "application/json" }, body: JSON.stringify({ platform: "bsc", addresses: ["0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", "0x4B0F1812e5Df2A09796481Ff14017e6005508003"] }) });
const j = (await r.json()) as { data?: Record<string, unknown>[]; status?: { error_message?: string } };
console.log(r.status, j.status?.error_message ?? "", Array.isArray(j.data) ? j.data.map((d) => `${d.sym} liq=${Math.round(Number(d.liqUsd))} hld=${d.hld} mcap=${Math.round(Number(d.mcap))}`).join(" | ") : "");
const i = await fetch("https://pro-api.coinmarketcap.com/v2/cryptocurrency/info?id=7186", { headers: { "X-CMC_PRO_API_KEY": key } });
const ij = (await i.json()) as { data: Record<string, { "tag-names"?: string[]; category?: string }> };
console.log("tags", JSON.stringify(ij.data["7186"]?.["tag-names"]?.slice(0, 8)), ij.data["7186"]?.category);
