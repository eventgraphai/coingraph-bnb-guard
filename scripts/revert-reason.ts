// Why did the guard revert a buy? Replays the transaction one block earlier and decodes the error. Usage: npx tsx scripts/revert-reason.ts <txHash>
import { client } from "../checks/chain.js";
import { decodeErrorResult, parseAbi } from "viem";
const tx = await client.getTransaction({ hash: process.argv[2] as `0x${string}` });
try { await client.call({ account: tx.from, to: tx.to!, data: tx.input, value: tx.value, gas: tx.gas, blockNumber: tx.blockNumber! - 1n }); console.log("no revert at prior block"); }
catch (e: any) { let c = e; let d; while (c) { if (c.data && typeof c.data === "string") d = c.data; else if (c.data?.data) d = c.data.data; c = c.cause; } console.log("data", d);
  const abi = parseAbi(["error OracleDeviation(bytes4 feedId, uint256 paidUsd, uint256 atlasUsd, uint256 gapBps)","error NotProceed(uint8 verdict)","error NotProceed()"]);
  try { console.log(decodeErrorResult({ abi, data: d })); } catch (x) { console.log("undecoded"); } }
