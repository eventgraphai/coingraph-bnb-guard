// Answers for CoinGraphGuardAtlas: the same signed answer, plus the Atlas feed the guard must check on chain
// and the largest allowed gap (basis points) between the price paid and Atlas's signed price.
import { pad, toHex, type Address, type Hex, type LocalAccount } from "viem";
import type { CheckResult } from "./check.js";
import { atlasFeedFor } from "./atlas-feeds.js";
import { toAnswer } from "./answer.js";

export type AnswerAtlas = ReturnType<typeof toAnswer> & { atlasFeedId: Hex; maxDevBps: number };

export const answerAtlasTypes = {
  Answer: [
    { name: "agent", type: "address" },
    { name: "token", type: "address" },
    { name: "maxAmountIn", type: "uint256" },
    { name: "verdict", type: "uint8" },
    { name: "issuedAt", type: "uint64" },
    { name: "evidenceHash", type: "bytes32" },
    { name: "atlasFeedId", type: "bytes4" },
    { name: "maxDevBps", type: "uint16" },
  ],
} as const;

/** Atlas feed numbers (#627 on atlasoracle.io) as the bytes4 the contract and payload use. */
export const feedBytes4 = (feedId: string | number): Hex => pad(toHex(Number(feedId)), { size: 4 });

export function toAnswerAtlas(r: CheckResult, agent: Address, issuedAt: bigint, opts: { feedId?: string; maxDevBps?: number } = {}): AnswerAtlas {
  const feed = opts.feedId ?? atlasFeedFor(r.symbol)?.feedId;
  return { ...toAnswer(r, agent, issuedAt), atlasFeedId: feed ? feedBytes4(feed) : "0x00000000", maxDevBps: opts.maxDevBps ?? 300 };
}

export async function signAnswerAtlas(signer: LocalAccount, a: AnswerAtlas, chainId: number, guard: Address): Promise<Hex> {
  return signer.signTypedData({ domain: { name: "CoinGraph Guard", version: "2", chainId, verifyingContract: guard }, types: answerAtlasTypes, primaryType: "Answer", message: a });
}
