// Cournot Intelligence Oracle: fair-value probabilities for prediction-market claims, with the market's own price and
// the external evidence behind the estimate. CoinGraph uses it as a market-risk input: before an agent buys, how likely
// is a sharp drop in the asset the trade depends on (BNB for every BNB-paired buy, or the token's own underlying asset)?
// Same endpoints as Cournot's official skill client (interface.cournot.ai/intelligence/v1). Resolve is free; each
// probability call uses Cournot's free allowance (3 per IP) or a prepaid key (COURNOT_API_KEY). Results are cached,
// and every call is logged to logs/cournot-calls.jsonl as proof of live usage.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import "./env.js";

const BASE = "https://interface.cournot.ai/intelligence/v1";
const LOG_DIR = new URL("../logs/", import.meta.url);
const CACHE_FILE = new URL("../logs/cournot-cache.json", import.meta.url);
const CACHE_MS = Number(process.env.COURNOT_CACHE_HOURS ?? 6) * 3600_000;

export type CournotMarket = { id: string; title: string; endTime?: string; marketPrice: number | null; confidence: number };
export type CournotAssessment = {
  claim: string;              // the exact claim sent to Cournot
  market: CournotMarket;      // the prediction market it resolved to
  probability: number;        // Cournot's fair-value probability (0..1)
  result: Record<string, unknown> | null; // every field Cournot returned for the assessment
  basis: unknown;             // Cournot's external evidence, as returned
  billing: string;            // how the call was paid (free allowance, prepaid key, x402)
  at: string;                 // when Cournot answered
  cached?: boolean;
};

function log(entry: Record<string, unknown>) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(new URL("cournot-calls.jsonl", LOG_DIR), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  } catch {}
}

async function post(path: "resolve" | "probability", body: unknown) {
  const key = process.env.COURNOT_API_KEY?.trim();
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key && path === "probability" ? { "COURNOT-API-KEY": key } : {}) },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(path === "probability" ? 120_000 : 30_000),
  });
  const json = (await res.json().catch(() => null)) as { code?: number; msg?: string; data?: any } | null;
  log({ path, http: res.status, code: json?.code ?? null, claim: (body as { message: string }).message });
  return { status: res.status, json };
}

/** Free: which prediction market matches this claim? Returns the best match only if it is clear. */
export async function resolveClaim(claim: string): Promise<CournotMarket | null> {
  const { json } = await post("resolve", { message: claim, limit: 5 });
  const ms = (json?.data?.markets ?? []) as { matching_confidence: number; market_info: { id: string | number; title: string; end_time?: string; market_outcome_price?: number } }[];
  if (!ms.length) return null;
  // Markets that only differ by end date tie on confidence: among the top ties, take the one ending closest to the
  // date in the claim. Otherwise the official skill's rule: one match, or a clear leader (>= 0.85, 0.15 ahead).
  const top = ms[0].matching_confidence;
  const wanted = Date.parse(claim.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "");
  const ties = ms.filter((m) => top - m.matching_confidence < 0.01);
  if (ties.length > 1 && top >= 0.85 && Number.isFinite(wanted)) ties.sort((x, y) => Math.abs(Date.parse(x.market_info.end_time ?? "") - wanted) - Math.abs(Date.parse(y.market_info.end_time ?? "") - wanted));
  const a = ties.length > 1 && top >= 0.85 ? ties[0] : ms[0];
  const b = ms.find((m) => m !== a && !ties.includes(m)) ?? (ties.length > 1 ? undefined : ms[1]);
  if (a.matching_confidence < 0.85 || (b && a.matching_confidence - b.matching_confidence < 0.15 && !(ties.length > 1))) return null;
  if (ties.length > 1 && Number.isFinite(wanted) && Math.abs(Date.parse(a.market_info.end_time ?? "") - wanted) > 7 * 86400_000) return null;
  return { id: String(a.market_info.id), title: a.market_info.title, endTime: a.market_info.end_time, marketPrice: a.market_info.market_outcome_price ?? null, confidence: a.matching_confidence };
}

let lastNoAllowance = 0;

function readCache(): Record<string, CournotAssessment> {
  try { return JSON.parse(readFileSync(CACHE_FILE, "utf8")); } catch { return {}; }
}

/** Paid (free allowance or prepaid key): Cournot's probability for one market, cached for COURNOT_CACHE_HOURS. */
export async function assess(claim: string, market: CournotMarket, opts: { fresh?: boolean } = {}): Promise<CournotAssessment | { error: string }> {
  const cache = readCache();
  const hit = cache[market.id];
  if (hit && !opts.fresh && Date.now() - Date.parse(hit.at) < CACHE_MS) return { ...hit, cached: true };
  // After a "no allowance left" answer, wait 15 minutes before asking again (no repeated paid-endpoint calls).
  if (!opts.fresh && Date.now() - lastNoAllowance < 15 * 60_000) return hit ? { ...hit, cached: true } : { error: "Cournot allowance used up (add a prepaid key)" };
  const { status, json } = await post("probability", { message: claim, market_ids: [market.id] });
  if (status === 402 || json?.code === 22002) { lastNoAllowance = Date.now(); return hit ? { ...hit, cached: true } : { error: "Cournot allowance used up (add a prepaid key)" }; }
  if (status === 429) return { error: "Cournot rate limit" };
  if (!json || json.code !== 0) return { error: `Cournot error ${status}${json?.code != null ? ` (${json.code})` : ""}` };
  const d = json.data ?? {};
  const p = d.probability && typeof d.probability === "object" ? d.probability : null;
  const result = (p?.result ?? d.result ?? null) as Record<string, unknown> | null;
  const raw = result?.point_estimate ?? (typeof d.probability === "number" ? d.probability : null) ?? result?.probability;
  const probability = Number(raw);
  if (!Number.isFinite(probability)) return { error: "Cournot returned no probability" };
  const billing = d.billing?.x402 ? "paid on chain (x402)" : d.billing?.api_key ? `prepaid call${d.api_key_quota?.remaining != null ? `, ${d.api_key_quota.remaining} left` : ""}` : d.billing?.free_quota ? `free call${d.free_quota?.remaining != null ? `, ${d.free_quota.remaining} left` : ""}` : "billing not returned";
  const out: CournotAssessment = { claim, market, probability, result, basis: p?.basis ?? d.basis ?? null, billing, at: new Date().toISOString() };
  cache[market.id] = out;
  try { mkdirSync(LOG_DIR, { recursive: true }); writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2)); } catch {}
  // Keep the full response for the proof of a successful call.
  try { mkdirSync(new URL("../proofs/cournot/", import.meta.url), { recursive: true }); writeFileSync(new URL(`../proofs/cournot/${market.id}-${Date.now()}.json`, import.meta.url), JSON.stringify({ request: { message: claim, market_ids: [market.id] }, response: json }, null, 2)); } catch {}
  return out;
}

// Which asset a buy depends on. Every buy through the guard is paid in BNB, so BNB is the default;
// tokens that track another asset use that asset's market instead.
const UNDERLYING: Record<string, string> = { BTCB: "Bitcoin", BTC: "Bitcoin", ETH: "Ethereum", WETH: "Ethereum", SOL: "Solana", DOGE: "Dogecoin", XRP: "XRP" };
export const underlyingFor = (symbol: string | null) => UNDERLYING[(symbol ?? "").trim().toUpperCase()] ?? "BNB";

/** A downside claim CoinGraph asks Cournot about: a fall of `drop` (0.1 = 10%) from today's price by the end of the year,
 *  rounded to a round-number threshold like the ones prediction markets list. */
export function downsideClaim(asset: string, priceUsd: number, drop = 0.1, now = new Date()): string {
  const target = priceUsd * (1 - drop);
  const step = target > 20_000 ? 10_000 : target > 2_000 ? 500 : target > 200 ? 50 : target > 20 ? 5 : target > 2 ? 0.5 : 0.05;
  const rounded = Math.max(step, Math.round(target / step) * step);
  return `Will ${asset} price fall below $${rounded.toLocaleString("en-US")} before ${now.getUTCFullYear() + 1}-01-01?`;
}

/** Market risk for a buy: find the nearest downside market (resolve is free), then Cournot's probability (cached). */
export async function marketRisk(symbol: string | null, priceUsd: number): Promise<CournotAssessment | { error: string } | null> {
  if (!(priceUsd > 0)) return null;
  const asset = underlyingFor(symbol);
  for (const drop of [0.1, 0.15, 0.2, 0.25]) {
    const claim = downsideClaim(asset, priceUsd, drop);
    const market = await resolveClaim(claim).catch(() => null);
    if (market) return assess(claim, market);
  }
  return null;
}
