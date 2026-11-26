// Shows a transaction's outcome; for a reverted guard call, replays it to decode the guard's reason.
// Usage: pnpm tsx scripts/tx.ts <txHash>
import { decodeErrorResult, type Hex } from "viem";
import { client } from "../checks/chain.js";
import { CoinGraphGuard } from "../contracts/artifacts.generated.js";
const hash = process.argv[2] as Hex;
const [tx, rc] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
let reason = "";
if (rc.status !== "success") {
  try {
    await client.call({ account: tx.from, to: tx.to!, data: tx.input, value: tx.value, blockNumber: rc.blockNumber - 1n });
  } catch (e) {
    const raw = ((e as Error).message.match(/reason: (0x[0-9a-fA-F]{8,})/) ?? (e as Error).message.match(/data: (0x[0-9a-fA-F]{8,})/))?.[1] as Hex | undefined;
    try { reason = raw ? decodeErrorResult({ abi: CoinGraphGuard.abi, data: raw }).errorName : ""; } catch { reason = raw ?? ""; }
  }
}
console.log({ status: rc.status, block: String(rc.blockNumber), gasUsed: String(rc.gasUsed), feeBnb: Number(rc.gasUsed * rc.effectiveGasPrice) / 1e18, logs: rc.logs.length, reason });
