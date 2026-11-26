// guard.coingraph.ai: the web page and API.
// New for BNB Hack: /api/check (the on-chain BNB Chain check). Existing CoinGraph platform, called through its public
// API: token search, the market check (/evaluate), Ask, and the agents list.
// Run: pnpm tsx web/server.ts   (PORT, default 8787)
import { readFileSync, existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { isAddress } from "viem";
import "../checks/env.js";
import { checkToken } from "../checks/check.js";
import { loadChainTotals, proofEnabled, proofStats, recordProof } from "./proof.js";
import { getBoard, refreshBoard } from "./board.js";
import { marketOverview } from "../checks/cmc.js";

const CG = "https://coingraph.ai/api/v1";
const app = new Hono();
let lastBnbPrice: number | undefined;
const root = new URL("./", import.meta.url);

// A small per-IP limit so a public page cannot burn the CoinMarketCap, Atlas or CoinGraph credits.
const hits = new Map<string, number[]>();
function limited(ip: string, perMinute: number) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > perMinute;
}
const ipOf = (c: { req: { header: (k: string) => string | undefined } }) => (c.req.header("x-forwarded-for") ?? "").split(",")[0].trim() || "local";

async function coingraph(path: string, init?: RequestInit & { auth?: boolean }) {
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  if (init?.auth && process.env.COINGRAPH_API_KEY) headers.Authorization = `Bearer ${process.env.COINGRAPH_API_KEY}`;
  const res = await fetch(`${CG}${path}`, { ...init, headers, signal: AbortSignal.timeout(90_000) });
  return { status: res.status, body: await res.json().catch(() => ({ error: "bad response" })) };
}

// New: the BNB Chain on-chain check, sized to the order.
app.get("/api/check", async (c) => {
  if (limited(ipOf(c), 12)) return c.json({ error: "Too many checks. Wait a minute." }, 429);
  const token = c.req.query("token") ?? "";
  const usd = Math.min(Math.max(Number(c.req.query("usd") ?? 500) || 500, 1), 100_000);
  if (!isAddress(token)) return c.json({ error: "Paste a BNB Smart Chain token contract address (0x...)." }, 400);
  try {
    const r = await checkToken(token, usd);
    // Every answer is recorded on BNB Smart Chain. Its evidence hash is keccak256 of this JSON without the "proof" field.
    const proof = await recordProof(r);
    lastBnbPrice = r.numbers.bnbPriceUsd;
    return c.json({ ...r, proof });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

// Existing CoinGraph: search the top 1,000 tokens by name or symbol.
app.get("/api/search", async (c) => {
  if (limited(ipOf(c), 30)) return c.json({ error: "Slow down a little." }, 429);
  const q = (c.req.query("q") ?? "").trim().slice(0, 40);
  if (!q) return c.json({ results: [] });
  const r = await coingraph(`/tokens?q=${encodeURIComponent(q)}`);
  return c.json({ results: (r.body as { data?: { results?: unknown[] } }).data?.results ?? [] }, r.status as 200);
});

// Existing CoinGraph: the market check across exchanges (momentum, order books, futures, flows, supply, contract).
app.get("/api/evaluate/:id", async (c) => {
  if (limited(ipOf(c), 20)) return c.json({ error: "Slow down a little." }, 429);
  const r = await coingraph(`/evaluate/${encodeURIComponent(c.req.param("id"))}`);
  return c.json(r.body as object, r.status as 200);
});

// Existing CoinGraph: ask anything about a token, or check a claim. Spends credits on the CoinGraph account key.
app.post("/api/ask", async (c) => {
  if (limited(ipOf(c), 4)) return c.json({ error: "Ask is limited to a few questions a minute." }, 429);
  if (!process.env.COINGRAPH_API_KEY) return c.json({ error: "Ask needs a CoinGraph API key on the server." }, 503);
  const { token, question } = (await c.req.json().catch(() => ({}))) as { token?: string; question?: string };
  if (!token || !question) return c.json({ error: "Pick a token and type a question." }, 400);
  const r = await coingraph("/ask", { method: "POST", auth: true, body: JSON.stringify({ token, question: question.slice(0, 500) }) });
  return c.json(r.body as object, r.status as 200);
});

app.get("/api/agents", async (c) => c.json((await coingraph("/agents")).body as object));

app.get("/api/demo", (c) => {
  const f = new URL("data/demo.json", root);
  return existsSync(f) ? c.json(JSON.parse(readFileSync(f, "utf8"))) : c.json({ runs: [] });
});

// BNB Chain top 50 by market cap with CoinGraph verdicts (cached; refreshed in the background).
app.get("/api/board", (c) => { refreshBoard().catch(() => {}); return c.json(getBoard()); });

// Market mood for the banner: total market cap, BTC dominance, Fear & Greed, altcoin season (CoinMarketCap, cached 10 min).
app.get("/api/market", async (c) => c.json((await marketOverview().catch(() => null)) ?? {}));

app.get("/api/top10", (c) => {
  const f = new URL("data/top10.json", root);
  return existsSync(f) ? c.json(JSON.parse(readFileSync(f, "utf8"))) : c.json({ results: [] });
});

app.get("/api/health", (c) => c.json({ ok: true, cmc: !!process.env.CMC_API_KEY, atlas: !!process.env.ATLAS_API_KEY, ask: !!process.env.COINGRAPH_API_KEY, proofs: proofEnabled() }));

// How many answers have been recorded on chain, and what that cost.
app.get("/api/proofs", (c) => c.json(proofStats(lastBnbPrice)));

app.get("/", (c) => c.html(readFileSync(new URL("public/index.html", root), "utf8")));
app.get("/bnb", (c) => c.html(readFileSync(new URL("public/bnb.html", root), "utf8")));
app.get("/poster", (c) => c.html(readFileSync(new URL("public/poster.html", root), "utf8")));

const port = Number(process.env.PORT ?? 8787);
loadChainTotals();
refreshBoard(true).catch(() => {});
serve({ fetch: app.fetch, port }, () => console.log(`guard listening on http://localhost:${port}`));
