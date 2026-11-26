// Living Brain (by ChatAndBuild) as CoinGraph Guard's persistent memory.
// Remember: after every check, a note with the token, verdict, reasons and on-chain record is captured into one brain.
// Retrieve: before every check, the brain is searched for what CoinGraph already knows about that token; matches become
// a "memory" finding and are part of the answer's raw data, so they are hashed and recorded on BNB Smart Chain too.
// Env: LIVING_BRAIN_API_KEY (lbk_...), LIVING_BRAIN_SUBJECT_ID, optional LIVING_BRAIN_BRAIN_ID (else found or created by name).
import { LivingBrainClient } from "@living-brain/sdk";
import "./env.js";

const BRAIN_NAME = "CoinGraph Guard memory";
let client: LivingBrainClient | null = null;
let brainId: string | null = process.env.LIVING_BRAIN_BRAIN_ID?.trim() || null;
let brainP: Promise<string | null> | null = null;

export const memoryEnabled = () => !!process.env.LIVING_BRAIN_API_KEY?.trim() && !!process.env.LIVING_BRAIN_SUBJECT_ID?.trim();

function lb() {
  if (!memoryEnabled()) return null;
  if (!client) client = new LivingBrainClient({ apiKey: process.env.LIVING_BRAIN_API_KEY!.trim(), subjectId: process.env.LIVING_BRAIN_SUBJECT_ID!.trim() });
  return client;
}

/** The brain that holds CoinGraph Guard's memory: from env, or found by name, or created once. */
export async function brain(): Promise<string | null> {
  if (brainId) return brainId;
  const c = lb(); if (!c) return null;
  brainP ??= (async () => {
    try {
      const list: any = await c.brains.list();
      const items: any[] = Array.isArray(list) ? list : list?.data ?? list?.items ?? list?.brains ?? [];
      const found = items.find((b) => b?.name === BRAIN_NAME);
      if (found?.id) return (brainId = found.id);
      const b: any = await c.brains.create({ name: BRAIN_NAME, description: "What CoinGraph Guard learned about BNB Smart Chain tokens: verdicts, reasons and on-chain records." } as any);
      return (brainId = b?.id ?? null);
    } catch (e) { console.error("[memory] brain", (e as Error).message); brainP = null; return null; }
  })();
  return brainP;
}

export type MemoryHit = { slug: string; title: string; summary: string; similarity: number; status: string };
export type Recall = { source: "Living Brain"; brainId: string; query: string; hits: MemoryHit[] };

/** What the brain already knows about this token (by contract address and symbol). */
export async function recall(token: string, symbol: string | null): Promise<Recall | null> {
  const c = lb(); const id = await brain(); if (!c || !id) return null;
  const query = `${symbol ?? ""} token ${token} CoinGraph check verdict`.trim();
  const res: any = await c.workspace.searchPages({ brainId: id, query, topK: 5, minSimilarity: 0.25 } as any);
  const items: any[] = Array.isArray(res) ? res : res?.data ?? res?.results ?? [];
  const addr = token.toLowerCase();
  const hits = items
    .filter((h) => h && (h.status === "active" || h.status === "contested"))
    // Keep only pages about this token: its contract address, or its symbol as a whole word, in the title or summary.
    .filter((h) => { const t = `${h.title} ${h.summary}`.toLowerCase(); const sym = (symbol ?? "").trim().toLowerCase(); return t.includes(addr) || (sym.length >= 2 && new RegExp(`(^|[^a-z0-9])${sym.replace(/[^a-z0-9]/g, "")}([^a-z0-9]|$)`).test(t)); })
    .slice(0, 3)
    .map((h) => ({ slug: h.slug, title: h.title, summary: h.summary, similarity: Math.round((h.similarity ?? 0) * 100) / 100, status: h.status }));
  return { source: "Living Brain", brainId: id, query, hits };
}

/** Writes what this check found into the brain (async in the brain; returns as soon as it is accepted). */
export async function remember(note: { token: string; symbol: string | null; name: string | null; verdict: string; orderUsd?: number; demo?: boolean; findings: { level: string; text: string }[]; evidenceHash: string; txHash?: string; checkedAt: string }) {
  const c = lb(); const id = await brain(); if (!c || !id) return null;
  const date = note.checkedAt.slice(0, 10);
  const issues = note.findings.filter((f) => f.level !== "ok").map((f) => `- ${f.level.toUpperCase()}: ${f.text}`);
  const oks = note.findings.filter((f) => f.level === "ok").slice(0, 4).map((f) => `- OK: ${f.text}`);
  const content = [
    `CoinGraph Guard check of ${note.symbol ?? "token"} (${note.name ?? "unknown"}), BNB Smart Chain contract ${note.token}.`,
    note.demo
      ? `Date: ${date}. Mainnet demo: an AI agent asked CoinGraph first, then bought through the guard contract. Verdict: ${note.verdict.toUpperCase()}.`
      : `Date: ${date}. Order size: $${(note.orderUsd ?? 0).toLocaleString("en-US")}. Verdict: ${note.verdict.toUpperCase()}.`,
    ...issues, ...oks,
    note.txHash ? `Recorded on BNB Smart Chain: https://bscscan.com/tx/${note.txHash} (verify raw data: https://guard.coingraph.ai/proof?tx=${note.txHash}).` : "",
    `Evidence hash: ${note.evidenceHash}.`,
  ].filter(Boolean).join("\n");
  return c.captures.capture({ brainId: id, body: { kind: "note", content, label: `${note.symbol ?? note.token} · ${note.verdict} · ${date}`, originRef: `coingraph-check:${note.evidenceHash}` } as any });
}
