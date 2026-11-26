// guard.coingraph.ai: the web page and API.
// New for BNB Hack: /api/check (the on-chain BNB Chain check). Existing CoinGraph platform, called through its public
// API: token search, the market check (/evaluate), Ask, and the agents list.
// Run: pnpm tsx web/server.ts   (PORT, default 8787)
import { marketRisk } from "../checks/cournot.js";
import { ADDR, client } from "../checks/chain.js";
import { readFileSync, existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { isAddress } from "viem";
import "../checks/env.js";
import { checkToken } from "../checks/check.js";
import { loadChainTotals, proofEnabled, proofStats, recordProof } from "./proof.js";
import { getBoard, refreshBoard } from "./board.js";
import { getEvidence, readRecord, saveEvidence } from "./evidence.js";
import { memoryEnabled, recall, remember } from "../checks/memory.js";

// After a check is recorded, Living Brain remembers it (in the background; never slows the answer).
function rememberCheck(r: Awaited<ReturnType<typeof checkToken>>, proof: { evidenceHash: string; txHash?: string }) {
  if (!memoryEnabled()) return;
  remember({ token: r.token, symbol: r.symbol, name: r.name, verdict: r.verdict, orderUsd: r.orderUsd, findings: r.findings, evidenceHash: proof.evidenceHash, txHash: proof.txHash, checkedAt: r.checkedAt }).catch((e) => console.error("[memory] remember", (e as Error).message));
}
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
    saveEvidence(r);
    // Every answer is recorded on BNB Smart Chain. Its evidence hash is keccak256 of this JSON without the "proof" field.
    const proof = withPage(await recordProof(r));
    lastBnbPrice = r.numbers.bnbPriceUsd;
    rememberCheck(r, proof);
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

// Market risk for BNB (Cournot Intelligence Oracle), cached; the same assessment every BNB-paired check uses.
app.get("/api/market-risk", async (c) => {
  if (!lastBnbPrice) {
    // Fresh server with no check yet: read the BNB price from the deepest PancakeSwap pool.
    const outs = await client.readContract({ address: ADDR.pancakeRouterV2, abi: [{ type: "function", name: "getAmountsOut", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "address[]" }], outputs: [{ type: "uint256[]" }] }], functionName: "getAmountsOut", args: [10n ** 18n, [ADDR.WBNB, ADDR.USDT]] }).catch(() => null);
    if (outs) lastBnbPrice = Number(outs[1]) / 1e18;
  }
  return c.json((await marketRisk("BNB", lastBnbPrice || 0).catch((e) => ({ error: String(e) }))) ?? { error: "no matching market" });
});

app.get("/api/health", (c) => c.json({ ok: true, cmc: !!process.env.CMC_API_KEY, atlas: !!process.env.ATLAS_API_KEY, cournot: process.env.COURNOT_ENABLED !== "0", memory: memoryEnabled(), cournotKey: !!process.env.COURNOT_API_KEY, ask: !!process.env.COINGRAPH_API_KEY, proofs: proofEnabled() }));

// How many answers have been recorded on chain, and what that cost.
app.get("/api/proofs", (c) => c.json(proofStats(lastBnbPrice)));

// Free MCP server (no key, no sign-in): any MCP client can call the guard's check directly.
// Streamable HTTP with JSON responses. Tools: check_token, bnb_top50, market_risk.
const MCP_TOOLS = [
  { name: "check_token", description: "Check a BNB Smart Chain token before buying it. Simulates the buy and sell on PancakeSwap, reads CoinMarketCap data, compares the price with Atlas Oracle, weighs Cournot market risk, and records the signed answer on BNB Smart Chain. Returns proceed, caution or avoid with every reason.",
    inputSchema: { type: "object", properties: { token: { type: "string", description: "The token's BNB Smart Chain contract address (0x...)." }, usd: { type: "number", description: "Order size in US dollars, 1 to 100000. Default 1000." } }, required: ["token"] } },
  { name: "bnb_top50", description: "The 50 largest assets on BNB Chain by market cap, each with a CoinGraph verdict for a $500 buy and its contract address.", inputSchema: { type: "object", properties: {} } },
  { name: "token_memory", description: "What CoinGraph Guard remembers about a BNB Smart Chain token from earlier checks (Living Brain memory): past verdicts, reasons and their on-chain records.",
    inputSchema: { type: "object", properties: { token: { type: "string", description: "The token's BNB Smart Chain contract address (0x...)." }, symbol: { type: "string", description: "Optional symbol, e.g. CAKE." } }, required: ["token"] } },
  { name: "market_risk", description: "Cournot Intelligence Oracle's current probability of a sharp BNB drop, with its evidence. CoinGraph uses it to size orders.", inputSchema: { type: "object", properties: {} } },
];
const mcpText = (obj: unknown, lead: string) => ({ content: [{ type: "text", text: `${lead}\n\n${JSON.stringify(obj, null, 2)}` }] });
async function mcpCall(name: string, args: Record<string, unknown>, ip: string) {
  if (name === "check_token") {
    const token = String(args.token ?? "");
    if (!isAddress(token)) return { content: [{ type: "text", text: "Give a BNB Smart Chain token contract address (0x...)." }], isError: true };
    if (limited(ip, 12)) return { content: [{ type: "text", text: "Too many checks from this connection. Wait a minute." }], isError: true };
    const usd = Math.min(Math.max(Number(args.usd ?? 1000) || 1000, 1), 100_000);
    const r = await checkToken(token, usd);
    saveEvidence(r);
    const proof = withPage(await recordProof(r));
    lastBnbPrice = r.numbers.bnbPriceUsd;
    rememberCheck(r, proof);
    const issues = r.findings.filter((f) => f.level !== "ok").map((f) => f.text).slice(0, 3).join(" ");
    const lead = `${r.symbol ?? "Token"} for $${usd.toLocaleString("en-US")}: ${r.verdict.toUpperCase()}. ${issues || "All checks passed."}${proof?.recorded ? ` Recorded on BNB Smart Chain: ${proof.explorer} · raw data and hash check: ${proof.page}` : ""}`;
    return mcpText({ ...r, proof }, lead);
  }
  if (name === "bnb_top50") {
    const b = getBoard() as { rows?: { rank: number; name: string; symbol: string; address: string; verdict?: string; reason?: string; priceUsd?: number }[] };
    const rows = (b.rows ?? []).map((x) => ({ rank: x.rank, name: x.name, symbol: x.symbol, address: x.address, verdict: x.verdict ?? "checking", reason: x.reason, priceUsd: x.priceUsd }));
    return mcpText(rows, `BNB Chain top ${rows.length}, each checked for a $500 buy.`);
  }
  if (name === "token_memory") {
    const token = String(args.token ?? "");
    if (!isAddress(token)) return { content: [{ type: "text", text: "Give a BNB Smart Chain token contract address (0x...)." }], isError: true };
    if (!memoryEnabled()) return { content: [{ type: "text", text: "Memory is not configured on this server." }], isError: true };
    const m = await recall(token, args.symbol ? String(args.symbol) : null);
    return mcpText(m, m?.hits.length ? `Living Brain remembers ${m.hits.length} earlier check(s) of this token.` : "No earlier memory of this token.");
  }
  if (name === "market_risk") {
    const m = await marketRisk("BNB", lastBnbPrice || 0).catch((e) => ({ error: String(e) }));
    return mcpText(m, m && !("error" in m) ? `Cournot: ${Math.round(m.probability * 100)}% chance of "${m.market.title}".` : "Market risk is not available right now.");
  }
  return { content: [{ type: "text", text: `Unknown tool ${name}.` }], isError: true };
}
app.post("/mcp", async (c) => {
  const msg = (await c.req.json().catch(() => null)) as { jsonrpc?: string; id?: number | string; method?: string; params?: any } | null;
  if (!msg || typeof msg.method !== "string") return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  if (msg.id === undefined) return c.body(null, 202);
  const ok = (result: unknown) => c.json({ jsonrpc: "2.0", id: msg.id, result });
  try {
    switch (msg.method) {
      case "initialize": return ok({ protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "coingraph-guard", version: "1.0.0" }, instructions: "Call check_token before buying any BNB Smart Chain token. Only buy on a proceed verdict." });
      case "ping": return ok({});
      case "tools/list": return ok({ tools: MCP_TOOLS });
      case "tools/call": return ok(await mcpCall(String(msg.params?.name), msg.params?.arguments ?? {}, ipOf(c)));
      default: return c.json({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
    }
  } catch (e) {
    return ok({ content: [{ type: "text", text: `Check failed: ${(e as Error).message}` }], isError: true });
  }
});
app.get("/mcp", (c) => c.json({ name: "coingraph-guard", transport: "streamable-http", tools: MCP_TOOLS.map((t) => t.name), auth: "none", docs: "https://guard.coingraph.ai/docs#mcp" }, 405, { Allow: "POST" }));
// Raw evidence and on-chain records: the exact JSON behind every recorded answer, and the ProofLog record that holds its hash.
function withPage<T extends { recorded: boolean; txHash?: string; evidenceHash: string }>(p: T): T & { page?: string; raw: string } {
  return p.recorded ? { ...p, page: `https://guard.coingraph.ai/proof?tx=${p.txHash}`, raw: `https://guard.coingraph.ai/api/evidence/${p.evidenceHash}` } : { ...p, raw: `https://guard.coingraph.ai/api/evidence/${p.evidenceHash}` };
}
app.get("/api/evidence/:hash", (c) => {
  const raw = getEvidence(c.req.param("hash"));
  return raw ? c.body(raw, 200, { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": "*" }) : c.json({ error: "No raw data stored for this hash." }, 404);
});
app.get("/api/proof/:tx", async (c) => {
  const tx = c.req.param("tx");
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) return c.json({ error: "Give a transaction hash (0x + 64 hex)." }, 400);
  try { return c.json(await readRecord(tx as `0x${string}`)); } catch (e) { return c.json({ error: `Could not read that transaction: ${(e as Error).message.split("\n")[0]}` }, 404); }
});
app.get("/api/records", (c) => {
  const out: { tx: string; token: string; verdict: string; at?: string; kind: string }[] = [];
  try {
    const lines = readFileSync(new URL("../logs/proofs.jsonl", import.meta.url), "utf8").trim().split("\n").slice(-30).reverse();
    for (const l of lines) { const j = JSON.parse(l); out.push({ tx: j.txHash, token: j.token, verdict: j.verdict, at: j.at, kind: "live" }); }
  } catch {}
  try {
    const d = JSON.parse(readFileSync(new URL("data/demo.json", root), "utf8"));
    for (const r of [...d.atlasRuns, ...d.runs]) out.push({ tx: r.proofTx, token: r.token, verdict: r.verdict, kind: "demo" });
  } catch {}
  return c.json({ records: out });
});
app.get("/proof", (c) => c.html(readFileSync(new URL("public/proof.html", root), "utf8")));
app.get("/logo.png", (c) => c.body(readFileSync(new URL("public/logo.png", root)), 200, { "content-type": "image/png", "cache-control": "public, max-age=86400" }));
app.get("/theme.css", (c) => c.body(readFileSync(new URL("public/theme.css", root), "utf8"), 200, { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=300" }));
app.get("/theme.js", (c) => c.body(readFileSync(new URL("public/theme.js", root), "utf8"), 200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300" }));
app.get("/", (c) => c.html(readFileSync(new URL("public/index.html", root), "utf8")));
app.get("/docs", (c) => c.html(readFileSync(new URL("public/docs.html", root), "utf8")));
app.get("/bnb", (c) => c.html(readFileSync(new URL("public/bnb.html", root), "utf8")));
app.get("/poster", (c) => c.html(readFileSync(new URL("public/poster.html", root), "utf8")));

const port = Number(process.env.PORT ?? 8787);
loadChainTotals();
refreshBoard(true).catch(() => {});
serve({ fetch: app.fetch, port }, () => console.log(`guard listening on http://localhost:${port}`));
