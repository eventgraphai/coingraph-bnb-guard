// Confirms the NOWNodes BNB Smart Chain endpoint answers with the key in .env (the key is never printed).
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";
import "../checks/env.js";
const key = process.env.NOWNODES_API_KEY;
if (!key) { console.log("NOWNODES_API_KEY is empty"); process.exit(1); }
const c = createPublicClient({ chain: bsc, transport: http(`https://bsc.nownodes.io/${key}`, { timeout: 15_000 }) });
const t = Date.now();
try {
  const [block, chainId] = await Promise.all([c.getBlockNumber(), c.getChainId()]);
  console.log(`NOWNodes BSC OK: chain ${chainId}, block ${block}, ${Date.now() - t} ms`);
} catch (e) { console.log("NOWNodes BSC failed:", (e as Error).message.split("\n")[0].replace(key, "<key>")); }
