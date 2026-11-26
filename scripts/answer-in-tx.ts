// Decodes the signed CoinGraph answer inside a guard.buy transaction (verdict 1 proceed, 2 caution, 3 avoid).
import { decodeFunctionData, type Hex } from "viem";
import { client } from "../checks/chain.js";
import { CoinGraphGuard } from "../contracts/artifacts.generated.js";
const tx = await client.getTransaction({ hash: process.argv[2] as Hex });
const { args } = decodeFunctionData({ abi: CoinGraphGuard.abi, data: tx.input });
const a = args![0] as { token: string; verdict: number; maxAmountIn: bigint; agent: string };
console.log({ token: a.token, verdict: ["?", "proceed", "caution", "avoid"][a.verdict], agent: a.agent, maxAmountInWei: String(a.maxAmountIn) });
