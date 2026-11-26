// BNB Chain top 50 board: the 50 largest assets by market cap that trade on BNB Smart Chain (native tokens and the
// official BNB Chain versions of major coins), with CoinMarketCap market data and a CoinGraph verdict for a $500 buy.
// Market data is cached for an hour. Verdicts refresh in the background every 12 hours, without CoinMarketCap calls
// per token (identity already comes from the listing), so the board stays light on API credits.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import "../checks/env.js";
import { checkToken, type Verdict } from "../checks/check.js";
import type { CmcListing } from "../checks/cmc.js";
import { atlasPrices } from "../checks/atlas.js";
import { atlasFeedFor } from "../checks/atlas-feeds.js";

export type BoardRow = {
  rank: number; name: string; symbol: string; address: string; priceUsd: number; change24hPct: number; change7dPct: number;
  marketCapUsd: number; volume24hUsd: number; kind: "native" | "bridged"; tags: string[];
  verdict?: Verdict; reason?: string; checkedAt?: string;
  atlas?: { label: string; priceUsd: number; gapPct: number; consensus?: number; status?: string };
};

const CACHE = new URL("./data/board.json", import.meta.url);
const NATIVE: Record<string, string> = { BNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", BTC: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c" };
const STABLE = /^(USD|DAI|EUR|FDUSD|TUSD|USDE|PYUSD|USD1|RLUSD|BUSD|XAUT|PAXG)/i;
const isBsc = (n?: string) => /BNB Smart Chain|BEP20/i.test(n ?? "");

let board: { builtAt: string; rows: BoardRow[] } = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : { builtAt: "", rows: [] };
let building = false;

async function cmc<T>(path: string): Promise<T | null> {
  const key = process.env.CMC_API_KEY;
  if (!key) return null;
  const r = await fetch(`https://pro-api.coinmarketcap.com${path}`, { headers: { "X-CMC_PRO_API_KEY": key }, signal: AbortSignal.timeout(20_000) });
  return r.ok ? (((await r.json()) as { data: T }).data ?? null) : null;
}

type L = { id: number; name: string; symbol: string; slug: string; cmc_rank: number; tags: string[]; platform: { name: string; token_address: string } | null; quote: { USD: { price: number; percent_change_24h: number; percent_change_7d: number; market_cap: number; volume_24h: number } } };
type Info = { contract_address?: { contract_address: string; platform: { name: string } }[]; "tag-names"?: string[] };

async function buildMarket(): Promise<BoardRow[]> {
  const list = (await cmc<L[]>("/v1/cryptocurrency/listings/latest?limit=300&convert=USD")) ?? [];
  const top = list.filter((l) => !STABLE.test(l.symbol)).slice(0, 120);
  const info = (await cmc<Record<string, Info>>(`/v2/cryptocurrency/info?id=${top.map((l) => l.id).join(",")}`)) ?? {};
  const rows: BoardRow[] = [];
  for (const l of list) {
    if (STABLE.test(l.symbol)) continue;
    const own = l.platform && isBsc(l.platform.name) && /^0x[0-9a-fA-F]{40}$/.test(l.platform.token_address) ? l.platform.token_address : null;
    const bridged = info[String(l.id)]?.contract_address?.find((c) => isBsc(c.platform?.name) && /^0x[0-9a-fA-F]{40}$/.test(c.contract_address))?.contract_address ?? null;
    const address = NATIVE[l.symbol] ?? own ?? bridged;
    if (!address) continue;
    const q = l.quote.USD;
    const tags = (info[String(l.id)]?.["tag-names"] ?? []).filter((t) => !/portfolio|ecosystem|capital|ventures|labs|holdings|launchpad|binance listing|alleged/i.test(t)).slice(0, 3);
    rows.push({ rank: l.cmc_rank, name: l.name, symbol: l.symbol, address, priceUsd: q.price, change24hPct: q.percent_change_24h, change7dPct: q.percent_change_7d, marketCapUsd: q.market_cap, volume24hUsd: q.volume_24h, kind: own || l.symbol === "BNB" ? "native" : "bridged", tags });
    if (rows.length === 50) break;
  }
  // Atlas Oracle reference price for every row with a free feed, in one call.
  const feeds = rows.map((r) => ({ r, f: atlasFeedFor(r.symbol === "BTC" ? "BTCB" : r.symbol) })).filter((x) => x.f);
  if (feeds.length) {
    const prices = await atlasPrices([...new Set(feeds.map((x) => x.f!.feedId))]).catch(() => []);
    const byId = new Map(prices.map((p) => [p.feedId, p]));
    for (const { r, f } of feeds) {
      const p = byId.get(f!.feedId);
      if (p && p.price > 0) r.atlas = { label: f!.label, priceUsd: p.price, gapPct: (Math.abs(r.priceUsd - p.price) / p.price) * 100, consensus: p.quality?.consensusScore, status: p.quality?.consensusStatus };
    }
  }
  return rows;
}

async function refreshVerdicts(rows: BoardRow[]) {
  for (const r of rows) {
    try {
      const listing: CmcListing = { id: 0, name: r.name, symbol: r.symbol, slug: "", rank: r.rank, priceUsd: r.priceUsd, volume24hUsd: r.volume24hUsd, marketCapUsd: r.marketCapUsd, change24hPct: r.change24hPct, dateAdded: "", tags: r.tags };
      const c = await checkToken(r.address, 500, { cmc: false, listing });
      r.verdict = c.verdict;
      r.reason = (c.findings.find((f) => f.level !== "ok")?.text ?? "All checks passed.").replace(/0x([0-9a-fA-F]{4})[0-9a-fA-F]{32}([0-9a-fA-F]{4})/g, "0x$1…$2");
      r.checkedAt = c.checkedAt;
    } catch (e) {
      r.reason = `Not checked: ${(e as Error).message.slice(0, 80)}`;
    }
  }
}

function save() {
  try {
    mkdirSync(new URL("./data/", import.meta.url), { recursive: true });
    writeFileSync(CACHE, JSON.stringify(board));
  } catch {}
}

/** Rebuilds market data hourly; carries verdicts over and re-checks every 12 hours. */
export async function refreshBoard(force = false) {
  if (building) return;
  const age = board.builtAt ? Date.now() - Date.parse(board.builtAt) : Infinity;
  if (!force && age < 60 * 60_000) return;
  building = true;
  try {
    const rows = await buildMarket();
    if (!rows.length) return;
    const old = new Map(board.rows.map((r) => [r.address.toLowerCase(), r]));
    for (const r of rows) {
      const o = old.get(r.address.toLowerCase());
      if (o?.verdict) Object.assign(r, { verdict: o.verdict, reason: o.reason, checkedAt: o.checkedAt });
    }
    board = { builtAt: new Date().toISOString(), rows };
    save();
    const stale = rows.filter((r) => !r.checkedAt || Date.now() - Date.parse(r.checkedAt) > 12 * 60 * 60_000);
    if (stale.length) {
      await refreshVerdicts(stale);
      save();
    }
  } finally {
    building = false;
  }
}

export function getBoard() {
  return board;
}
