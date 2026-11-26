// Creates CoinGraph's answer-signing key in .env (SIGNER_PRIVATE_KEY) if there is none, and prints only its address.
// The key never leaves this machine and is never printed. Usage: pnpm tsx scripts/signer.ts
import { readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import "../checks/env.js";

const envPath = new URL("../.env", import.meta.url);
let key = process.env.SIGNER_PRIVATE_KEY as `0x${string}` | undefined;
if (!key) {
  key = generatePrivateKey();
  const env = readFileSync(envPath, "utf8");
  writeFileSync(envPath, /^SIGNER_PRIVATE_KEY=.*$/m.test(env) ? env.replace(/^SIGNER_PRIVATE_KEY=.*$/m, `SIGNER_PRIVATE_KEY=${key}`) : `${env.trimEnd()}\nSIGNER_PRIVATE_KEY=${key}\n`);
  console.log("Created a new CoinGraph signing key in .env.");
}
console.log(`CoinGraph signer address: ${privateKeyToAccount(key).address}`);
