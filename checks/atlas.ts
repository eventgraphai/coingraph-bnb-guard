// Atlas Oracle: signed reference prices (pull API). Used to check a pool's price against an independent oracle,
// which matters most for tokenized real-world assets: a tokenized stock trading far from its reference price is a trap.
// Payload layout follows Atlas's official SDK (@atlas-oracle/pull-oracle-consumer-sdk): packages, count, signature, marker.
// Every call is logged to logs/atlas-calls.jsonl as proof of live usage.
import { appendFileSync, mkdirSync } from "node:fs";
import { keccak256, recoverAddress, type Hex } from "viem";
import "./env.js";

// Atlas Oracle's official signing key, as published in its pull-oracle consumer SDK.
export const ATLAS_SIGNER = "0x59eD4701224fD9e2a85Ef2946c2ab828C1dDC600";

const BASE = "https://api.atlasoracle.io";
const LOG_DIR = new URL("../logs/", import.meta.url);
const MAGIC_MARKER = 28822;
const SIG = 65;
const PKG = 20; // feedId 4 bytes, value 10 bytes (18 decimals), timestamp 6 bytes

export const atlasEnabled = () => !!process.env.ATLAS_API_KEY;

export type AtlasQuality = { consensusScore: number; consensusStatus: string; twapUsd: number; medianUsd: number; volatility: number; changePct: number };
export type AtlasPrice = { feedId: string; price: number; timestamp: number; signature: string; signer?: string; signatureValid?: boolean; quality?: AtlasQuality };

function hexBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Uint8Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16));
}
const big = (b: Uint8Array) => b.reduce((acc, x) => (acc << 8n) | BigInt(x), 0n);

/** Decodes Atlas extraData (payload + signature + marker) into prices. */
export function decodeAtlas(extraData: string): AtlasPrice[] {
  const b = hexBytes(extraData);
  let o = b.length - 2;
  if (Number(big(b.slice(o, o + 2))) !== MAGIC_MARKER) throw new Error("Atlas payload has an invalid marker");
  o -= SIG;
  const signature = "0x" + Buffer.from(b.slice(o, o + SIG)).toString("hex");
  o -= 1;
  const count = b[o];
  const out: AtlasPrice[] = [];
  for (let i = 0; i < count; i++) {
    o -= PKG;
    const p = b.slice(o, o + PKG);
    const raw = big(p.slice(4, 14));
    out.push({ feedId: big(p.slice(0, 4)).toString(), price: Number(raw / 10n ** 12n) / 1e6, timestamp: Number(big(p.slice(14, 20))), signature });
  }
  return out;
}

/** Latest signed prices for the given Atlas feed IDs (the numbers shown as #ID on atlasoracle.io/feeds). */
export async function atlasPrices(feedIds: string[]): Promise<AtlasPrice[]> {
  const key = process.env.ATLAS_API_KEY;
  if (!key || !feedIds.length) return [];
  const res = await fetch(`${BASE}/report/v1/price/latest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": key },
    body: JSON.stringify({ signed: true, feedIds }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as { status?: { error_code: string; error_message?: string }; data?: { payload: string; signature: string; magicMarker: string } };
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(new URL("atlas-calls.jsonl", LOG_DIR), JSON.stringify({ at: new Date().toISOString(), feedIds, http: res.status, error: json.status?.error_code !== "0" ? json.status?.error_message ?? null : null }) + "\n");
  } catch {}
  if (!res.ok || !json.data) throw new Error(`Atlas API ${res.status}: ${json.status?.error_message ?? "no data"}`);
  const strip = (s: string) => (s.startsWith("0x") ? s.slice(2) : s);
  const extra = "0x" + strip(json.data.payload) + strip(json.data.signature) + strip(json.data.magicMarker);
  const prices = decodeAtlas(extra);
  // Verify the signature the way Atlas's on-chain consumer does: keccak256(packages + count byte), no EIP-191 prefix,
  // signature laid out as r, s, v. The recovered address must be Atlas's official signer.
  const signer = await recoverAtlasSigner(extra).catch(() => null);
  for (const p of prices) { p.signer = signer ?? undefined; p.signatureValid = !!signer && signer.toLowerCase() === ATLAS_SIGNER.toLowerCase(); }
  // Data quality (only in the unsigned response): how strongly sources agree, TWAP, median, short-term volatility.
  const q = await atlasQuality(feedIds).catch(() => new Map<string, AtlasQuality>());
  for (const p of prices) p.quality = q.get(p.feedId);
  return prices;
}

/** Atlas's signed payload as raw bytes (packages + count + signature + marker), ready to append to a contract call. */
export async function atlasExtraData(feedIds: string[]): Promise<`0x${string}`> {
  const key = process.env.ATLAS_API_KEY;
  if (!key) throw new Error("ATLAS_API_KEY is empty in .env");
  const res = await fetch(`${BASE}/report/v1/price/latest`, { method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": key }, body: JSON.stringify({ signed: true, feedIds }), signal: AbortSignal.timeout(10_000) });
  const json = (await res.json().catch(() => ({}))) as { data?: { payload: string; signature: string; magicMarker: string } };
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(new URL("atlas-calls.jsonl", LOG_DIR), JSON.stringify({ at: new Date().toISOString(), feedIds, http: res.status, use: "onchain" }) + "\n");
  } catch {}
  if (!res.ok || !json.data) throw new Error(`Atlas API ${res.status}`);
  const strip = (s: string) => (s.startsWith("0x") ? s.slice(2) : s);
  return `0x${strip(json.data.payload)}${strip(json.data.signature)}${strip(json.data.magicMarker)}`;
}

export async function atlasQuality(feedIds: string[]): Promise<Map<string, AtlasQuality>> {
  const key = process.env.ATLAS_API_KEY;
  const out = new Map<string, AtlasQuality>();
  if (!key || !feedIds.length) return out;
  const res = await fetch(`${BASE}/report/v1/price/latest`, { method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": key }, body: JSON.stringify({ signed: false, feedIds }), signal: AbortSignal.timeout(10_000) });
  const json = (await res.json().catch(() => ({}))) as { data?: { consensusScores?: { feedId: string; consensusScore: number; consensusStatus: string; twapPrice: string; medianPrice: string; priceVolatility: number; priceChangePct: number }[] } };
  for (const c of json.data?.consensusScores ?? []) out.set(String(c.feedId), { consensusScore: c.consensusScore, consensusStatus: c.consensusStatus, twapUsd: Number(c.twapPrice), medianUsd: Number(c.medianPrice), volatility: c.priceVolatility, changePct: c.priceChangePct });
  return out;
}

/** Recovers the address that signed an Atlas payload (packages + count byte + 65-byte signature + 2-byte marker). */
export async function recoverAtlasSigner(extraData: string): Promise<string> {
  const h = extraData.startsWith("0x") ? extraData.slice(2) : extraData;
  const end = h.length - 4; // drop the 2-byte magic marker
  const sig = ("0x" + h.slice(end - 130, end)) as Hex; // 65 bytes: r, s, v
  const signed = ("0x" + h.slice(0, end - 130)) as Hex; // packages + count byte
  return recoverAddress({ hash: keccak256(signed), signature: sig });
}
