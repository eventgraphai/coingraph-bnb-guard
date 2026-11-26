// Turns a check result into an answer the guard contract accepts, signed by CoinGraph (EIP-712).
import { keccak256, parseEther, stringToHex, type Address, type Hex, type LocalAccount } from "viem";
import type { CheckResult } from "./check.js";

export const VERDICT_CODE = { proceed: 1, caution: 2, avoid: 3 } as const;

export type Answer = {
  agent: Address;
  token: Address;
  maxAmountIn: bigint;
  verdict: number;
  issuedAt: bigint;
  evidenceHash: Hex;
};

export const answerTypes = {
  Answer: [
    { name: "agent", type: "address" },
    { name: "token", type: "address" },
    { name: "maxAmountIn", type: "uint256" },
    { name: "verdict", type: "uint8" },
    { name: "issuedAt", type: "uint64" },
    { name: "evidenceHash", type: "bytes32" },
  ],
} as const;

export const guardDomain = (chainId: number, guard: Address) => ({ name: "CoinGraph Guard", version: "1", chainId, verifyingContract: guard }) as const;

// The full result (findings, numbers, block) is hashed, so the short on-chain answer points to exactly one evidence record.
export const evidenceHash = (r: CheckResult): Hex => keccak256(stringToHex(JSON.stringify(r)));

export function toAnswer(r: CheckResult, agent: Address, issuedAt: bigint): Answer {
  // Cournot market risk scales the amount CoinGraph signs for; the guard rejects anything above it (AmountTooLarge).
  const c = r.numbers.cournot;
  const factor = c && !("error" in c) && c.sizeFactor > 0 ? c.sizeFactor : 1;
  const maxAmountIn = parseEther(((r.orderUsd * factor) / r.numbers.bnbPriceUsd).toFixed(18));
  return { agent, token: r.token, maxAmountIn, verdict: VERDICT_CODE[r.verdict], issuedAt, evidenceHash: evidenceHash(r) };
}

export async function signAnswer(signer: LocalAccount, a: Answer, chainId: number, guard: Address): Promise<Hex> {
  return signer.signTypedData({ domain: guardDomain(chainId, guard), types: answerTypes, primaryType: "Answer", message: a });
}
