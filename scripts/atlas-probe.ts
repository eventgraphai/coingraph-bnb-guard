// Probes the Atlas API for fields beyond the signed price (key never printed).
import "../checks/env.js";
const key = process.env.ATLAS_API_KEY!;
const post = async (path: string, body: unknown) => {
  const r = await fetch("https://api.atlasoracle.io" + path, { method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": key }, body: JSON.stringify(body) });
  const t = await r.text();
  console.log(r.status, path, JSON.stringify(body), "->", t.replace(/0x[0-9a-f]{40,}/gi, "0x…").slice(0, 420));
};
await post("/report/v1/price/latest", { signed: false, feedIds: ["626", "979"] });
for (const p of ["/report/v1/feeds", "/report/v1/feed/list", "/api/v1/feeds", "/report/v1/consensus/latest"]) {
  const r = await fetch("https://api.atlasoracle.io" + p, { headers: { "X-API-KEY": key } });
  console.log(r.status, "GET", p, (await r.text()).slice(0, 200));
}
