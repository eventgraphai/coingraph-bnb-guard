import "../checks/env.js";
const r = await fetch("https://api.atlasoracle.io/report/v1/price/latest", { method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": process.env.ATLAS_API_KEY! }, body: JSON.stringify({ signed: false, feedIds: ["626", "630", "979", "624"] }) });
const j = (await r.json()) as { data: Record<string, unknown> };
console.log("data keys:", Object.keys(j.data).join(", "));
console.log(JSON.stringify(j.data.priceDetails, null, 1).slice(0, 1800));
