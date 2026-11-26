// Reads the deployed contracts back from BNB Smart Chain. Usage: pnpm tsx scripts/status.ts
import { readFileSync } from "node:fs";
import { client } from "../checks/chain.js";
import { CoinGraphGuard, ProofLog } from "../contracts/artifacts.generated.js";
import type { Deployment } from "./wallet.js";
const d = JSON.parse(readFileSync(new URL("../deployments/bsc.json", import.meta.url), "utf8")) as Deployment;
const [signer, router, maxAge, recorder] = await Promise.all([
  client.readContract({ address: d.guard, abi: CoinGraphGuard.abi, functionName: "signer" }),
  client.readContract({ address: d.guard, abi: CoinGraphGuard.abi, functionName: "router" }),
  client.readContract({ address: d.guard, abi: CoinGraphGuard.abi, functionName: "maxAge" }),
  client.readContract({ address: d.proofLog, abi: ProofLog.abi, functionName: "recorder" }),
]);
console.log({ guard: d.guard, signer, router, maxAgeSeconds: String(maxAge), proofLog: d.proofLog, recorder });
