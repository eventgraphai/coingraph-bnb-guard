// The wallet that pays gas and acts as the demo agent: AGENT_PRIVATE_KEY in .env (you paste it there yourself).
import { createWalletClient, fallback, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import "../checks/env.js";

export function agentWallet() {
  const key = process.env.AGENT_PRIVATE_KEY?.trim();
  if (!key) throw new Error("AGENT_PRIVATE_KEY is empty in .env. Paste the hackathon wallet's private key there (never into chat).");
  const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
  const urls = [...(process.env.NOWNODES_API_KEY ? [`https://bsc.nownodes.io/${process.env.NOWNODES_API_KEY}`] : []), "https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com"];
  return createWalletClient({ account, chain: bsc, transport: fallback(urls.map((u) => http(u, { timeout: 20_000 }))) });
}

export function signerAccount() {
  const key = process.env.SIGNER_PRIVATE_KEY?.trim();
  if (!key) throw new Error("SIGNER_PRIVATE_KEY is empty. Run: pnpm tsx scripts/signer.ts");
  return privateKeyToAccount(key as `0x${string}`);
}

export const scan = (kind: "tx" | "address", v: string) => `https://bscscan.com/${kind}/${v}`;
export type Deployment = { chainId: 56; guard: Address; proofLog: Address; signer: Address; recorder: Address; guardTx: string; proofLogTx: string; deployedAt: string };
