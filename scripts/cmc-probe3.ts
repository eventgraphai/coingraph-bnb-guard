import "../checks/env.js";
const key = process.env.CMC_API_KEY!;
const CAKE = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82";
for (const plat of ["14", "bsc"]) {
  for (const p of [`/v1/dex/token?platform=${plat}&address=${CAKE}`, `/v1/dex/token/pools?platform=${plat}&address=${CAKE}&size=3`, `/v1/dex/holders/count?platform=${plat}&tokenAddress=${CAKE}`, `/v1/dex/security/detail?platformName=${plat}&address=${CAKE}`, `/v1/k-line/candles?platform=${plat}&address=${CAKE}&interval=1h&limit=2`]) {
    const r = await fetch("https://pro-api.coinmarketcap.com" + p, { headers: { "X-CMC_PRO_API_KEY": key } });
    const j = (await r.json().catch(() => ({}))) as { data?: unknown; status?: { error_message?: string } };
    const d = j.data as Record<string, unknown> | unknown[] | undefined;
    const shape = Array.isArray(d) ? `array(${d.length})` : d && typeof d === "object" ? Object.keys(d).slice(0, 14).join(",") : String(d ?? "");
    console.log(`${r.ok ? "YES" : "no "} ${r.status} [${plat}] ${p.split("?")[0].padEnd(26)} ${r.ok ? shape.slice(0, 140) : (j.status?.error_message ?? "").slice(0, 70)}`);
  }
}
