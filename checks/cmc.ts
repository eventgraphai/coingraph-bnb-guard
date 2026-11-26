// CoinMarketCap Pro API: who a contract really is, and what the market says about it.
// Every call is logged to logs/cmc-calls.jsonl (endpoint, time, HTTP status, credits used) as proof of live usage.
import { appendFileSync, mkdirSync } from "node:fs";
import "./env.js";

const BASE = "https://pro-api.coinmarketcap.com";
const LOG_DIR = new URL("../logs/", import.meta.url);

export const cmcEnabled = () => !!process.env.CMC_API_KEY;

type Status = { error_code: number; error_message: string | null; credit_count: number; timestamp: string };

async function cmc<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const key = process.env.CMC_API_KEY;
  if (!key) return null;
  const url = `${BASE}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { "X-CMC_PRO_API_KEY": key, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  const body = (await res.json().catch(() => ({}))) as { status?: Status; data?: T };
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(new URL("cmc-calls.jsonl", LOG_DIR), JSON.stringify({ at: new Date().toISOString(), path, params, http: res.status, credits: body.status?.credit_count ?? null, cmcTime: body.status?.timestamp ?? null, error: body.status?.error_message ?? null }) + "\n");
  } catch {}
  // 400 with "Invalid value" is how CMC answers "no listed asset for this address/symbol".
  if (!res.ok) return null;
  return body.data ?? null;
}

type Platform = { id: number; name: string; slug: string; symbol: string; token_address: string } | null;
type InfoEntry = { "tag-names"?: string[]; id: number; name: string; symbol: string; slug: string; date_added: string; platform: Platform; contract_address?: { contract_address: string; platform: { name: string; coin: { slug: string } } }[] };
type MapEntry = { id: number; name: string; symbol: string; slug: string; rank: number | null; is_active: number; platform: Platform };
type Quote = { id: number; name: string; symbol: string; cmc_rank: number | null; quote: { USD: { price: number; volume_24h: number; market_cap: number; percent_change_24h: number } } };

export type CmcListing = { id: number; name: string; symbol: string; slug: string; rank: number | null; priceUsd: number | null; volume24hUsd: number | null; marketCapUsd: number | null; change24hPct: number | null; dateAdded: string; tags: string[] };

const isBsc = (slug?: string, name?: string) => slug === "bnb" || slug === "binance-smart-chain" || /bnb smart chain|bep20/i.test(name ?? "");

/** Is this exact BNB Chain contract listed on CoinMarketCap? Returns the listing with live market data. */
export async function listingByAddress(address: string): Promise<CmcListing | null> {
  // CMC only matches lowercase addresses; a checksummed one comes back as "Invalid value for 'slug'".
  const info = await cmc<Record<string, InfoEntry>>("/v2/cryptocurrency/info", { address: address.toLowerCase() });
  const entry = info ? Object.values(info)[0] : undefined;
  if (!entry) return null;
  const quotes = await cmc<Record<string, Quote>>("/v2/cryptocurrency/quotes/latest", { id: String(entry.id) });
  const q = quotes?.[String(entry.id)];
  const usd = q?.quote.USD;
  return { id: entry.id, name: entry.name, symbol: entry.symbol, slug: entry.slug, rank: q?.cmc_rank ?? null, priceUsd: usd?.price ?? null, volume24hUsd: usd?.volume_24h ?? null, marketCapUsd: usd?.market_cap ?? null, change24hPct: usd?.percent_change_24h ?? null, dateAdded: entry.date_added, tags: cleanTags(entry["tag-names"]) };
}

// Category labels worth showing (CoinMarketCap tag names), skipping portfolio and ecosystem noise.
const cleanTags = (t?: string[]) => (t ?? []).filter((x) => !/portfolio|ecosystem|capital|ventures|labs|holdings|launchpad|binance listing|alleged/i.test(x)).slice(0, 4);

type SymbolAsset = { id: number; name: string; symbol: string; rank: number; bscAddresses: string[]; chain: string };

/** The best-ranked CoinMarketCap assets using this symbol, each with every official BNB Chain contract it lists. */
async function assetsForSymbol(symbol: string): Promise<SymbolAsset[]> {
  const map = await cmc<MapEntry[]>("/v1/cryptocurrency/map", { symbol: symbol.trim().toUpperCase() });
  const few = (map ?? []).filter((m) => m.is_active && m.rank).sort((a, b) => a.rank! - b.rank!).slice(0, 5);
  if (!few.length) return [];
  // A native coin (ADA, DOGE, TRX) lists its official BNB Chain versions among its contract addresses (sometimes
  // more than one, old and new); a BNB Chain token has it as its platform address.
  const info = await cmc<Record<string, InfoEntry>>("/v2/cryptocurrency/info", { id: few.map((m) => m.id).join(",") });
  return few.map((m) => {
    const listed = (info?.[String(m.id)]?.contract_address ?? []).filter((c) => /^0x[0-9a-fA-F]{40}$/.test(c.contract_address) && isBsc(c.platform?.coin?.slug, c.platform?.name)).map((c) => c.contract_address.toLowerCase());
    const own = isBsc(m.platform?.slug, m.platform?.name) && /^0x[0-9a-fA-F]{40}$/.test(m.platform?.token_address ?? "") ? [m.platform!.token_address.toLowerCase()] : [];
    return { id: m.id, name: m.name, symbol: m.symbol, rank: m.rank!, bscAddresses: [...new Set([...own, ...listed])], chain: m.platform?.name ?? "its own chain" };
  });
}

async function quoteListing(id: number, name: string, symbol: string, slug = "", dateAdded = ""): Promise<CmcListing> {
  const [qs, info] = await Promise.all([cmc<Record<string, Quote>>("/v2/cryptocurrency/quotes/latest", { id: String(id) }), cmc<Record<string, InfoEntry>>("/v2/cryptocurrency/info", { id: String(id) })]);
  const q = qs?.[String(id)];
  const usd = q?.quote.USD;
  return { id, name, symbol, slug, rank: q?.cmc_rank ?? null, priceUsd: usd?.price ?? null, volume24hUsd: usd?.volume_24h ?? null, marketCapUsd: usd?.market_cap ?? null, change24hPct: usd?.percent_change_24h ?? null, dateAdded, tags: cleanTags(info?.[String(id)]?.["tag-names"]) };
}

export type Identity =
  | { kind: "listed"; listing: CmcListing; via: "address" | "official_bnb_version" }
  | { kind: "copycat"; real: { name: string; symbol: string; rank: number; bscAddresses: string[]; chain: string } }
  | { kind: "unlisted" };

/** Who is this contract, according to CoinMarketCap? Listed, the official BNB Chain version of a listed asset, a copycat of one, or unknown. */
export async function identify(address: string, symbol: string | null): Promise<Identity> {
  const direct = await listingByAddress(address);
  if (direct) return { kind: "listed", listing: direct, via: "address" };
  if (!symbol) return { kind: "unlisted" };
  const assets = await assetsForSymbol(symbol);
  const addr = address.toLowerCase();
  const owner = assets.find((a) => a.bscAddresses.includes(addr));
  if (owner) return { kind: "listed", listing: await quoteListing(owner.id, owner.name, owner.symbol), via: "official_bnb_version" };
  // Copycat: a well-known asset uses this symbol, or one whose official BNB Chain contract is somewhere else.
  const real = assets.find((a) => a.bscAddresses.length) ?? assets.find((a) => a.rank <= 1000);
  if (real && (real.rank <= 1000 || real.bscAddresses.length)) return { kind: "copycat", real };
  return { kind: "unlisted" };
}

// ---- CoinMarketCap DEX data (platform "bsc"): liquidity across every pool, the pools themselves, holders ----
export type DexPool = { dex: string; liquidityUsd: number; volume24hUsd: number; address: string };
export type DexProfile = { liquidityUsd: number | null; pools: DexPool[]; holders: number | null; creator: string | null };

export async function dexProfile(address: string): Promise<DexProfile | null> {
  if (!cmcEnabled()) return null;
  const a = address.toLowerCase();
  const [tok, pools, holders] = await Promise.all([
    cmc<Record<string, string>>("/v1/dex/token", { platform: "bsc", address: a }),
    cmc<Record<string, string>[]>("/v1/dex/token/pools", { platform: "bsc", address: a, size: "8" }),
    cmc<{ count: string }>("/v1/dex/holders/count", { platform: "bsc", tokenAddress: a }),
  ]);
  if (!tok && !pools && !holders) return null;
  const list = (pools ?? []).map((p) => ({ dex: String(p.exn ?? "DEX").replace(" (BSC)", ""), liquidityUsd: Number(p.liqUsd ?? 0), volume24hUsd: Number(p.v24 ?? 0), address: String(p.addr ?? "") })).filter((p) => p.liquidityUsd > 0).sort((x, y) => y.liquidityUsd - x.liquidityUsd);
  // Sum the pools themselves (consistent with the pool we read on chain); fall back to CMC's token figure.
  const liq = list.length ? list.reduce((t, p) => t + p.liquidityUsd, 0) : tok?.liqUsd != null ? Number(tok.liqUsd) : null;
  const h = holders?.count != null ? Number(holders.count) : null;
  return { liquidityUsd: liq, pools: list.slice(0, 5), holders: h && h > 0 ? h : null, creator: tok?.crt ?? null };
}

// ---- Market overview for the page banner and as context in answers (cached) ----
export type MarketOverview = { totalMarketCapUsd: number | null; totalVolume24hUsd: number | null; btcDominance: number | null; marketCapChange24hPct: number | null; fearGreed: { value: number; label: string } | null; altcoinSeason: number | null; at: string };
let marketCache: { at: number; data: MarketOverview } | null = null;
export async function marketOverview(): Promise<MarketOverview | null> {
  if (!cmcEnabled()) return null;
  if (marketCache && Date.now() - marketCache.at < 10 * 60_000) return marketCache.data;
  type G = { btc_dominance: number; quote: { USD: { total_market_cap: number; total_volume_24h: number; total_market_cap_yesterday_percentage_change: number } } };
  const [g, fg, alt] = await Promise.all([
    cmc<G>("/v1/global-metrics/quotes/latest", {}),
    cmc<{ value: number; value_classification: string }>("/v3/fear-and-greed/latest", {}),
    cmc<{ altcoin_index: number }>("/v1/altcoin-season-index/latest", {}),
  ]);
  const data: MarketOverview = {
    totalMarketCapUsd: g?.quote.USD.total_market_cap ?? null,
    totalVolume24hUsd: g?.quote.USD.total_volume_24h ?? null,
    btcDominance: g?.btc_dominance ?? null,
    marketCapChange24hPct: g?.quote.USD.total_market_cap_yesterday_percentage_change ?? null,
    fearGreed: fg ? { value: fg.value, label: fg.value_classification } : null,
    altcoinSeason: alt?.altcoin_index ?? null,
    at: new Date().toISOString(),
  };
  marketCache = { at: Date.now(), data };
  return data;
}
