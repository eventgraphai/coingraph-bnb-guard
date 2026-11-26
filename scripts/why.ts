// Replays a reverted guard transaction one block earlier and prints the raw revert message.
import type { Hex } from "viem";
import { client } from "../checks/chain.js";
const h = process.argv[2] as Hex;
const [tx, rc] = await Promise.all([client.getTransaction({ hash: h }), client.getTransactionReceipt({ hash: h })]);
try {
  await client.call({ account: tx.from, to: tx.to!, data: tx.input, value: tx.value, blockNumber: rc.blockNumber - 1n });
  console.log("no revert in replay");
} catch (e) {
  console.log((e as Error).message.split("\n").slice(0, 2).join(" | "));
}
