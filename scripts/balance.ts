// Usage: pnpm tsx scripts/balance.ts <address>
import { formatEther, getAddress } from "viem";
import { client } from "../checks/chain.js";
const a = getAddress(process.argv[2]);
const [b, n, g] = await Promise.all([client.getBalance({ address: a }), client.getTransactionCount({ address: a }), client.getGasPrice()]);
console.log(`balance ${formatEther(b)} BNB | transactions sent ${n} | gas price ${Number(g) / 1e9} gwei`);
