// Tests CoinGraphGuardAtlas against real BNB Chain mainnet state and a live Atlas Oracle payload, without deploying
// or spending anything: the constructor runs in eth_call, its runtime code is placed at its future address with a
// state override, and each case runs a real PancakeSwap buy through it. Run: npx tsx contracts/test-guard-atlas.ts
import { concat, decodeErrorResult, encodeFunctionData, getContractAddress, pad, parseAbi, parseEther, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ADDR, client } from "../checks/chain.js";
import { checkToken } from "../checks/check.js";
import { atlasExtraData } from "../checks/atlas.js";
import { signAnswerAtlas, toAnswerAtlas, type AnswerAtlas } from "../checks/answer-atlas.js";
import { CoinGraphGuardAtlas } from "./artifacts.generated.js";

const TRX = "0xce7de646e7208a4ef112cb6ed5038fa6cc6b12e3" as Address;
const FAKE_BTCB = "0x6583a27d7c7c0d755414b9471bd55ef9a39afd26" as Address;
export const atlasErrors = parseAbi([
  "error PriceFeedExpired(bytes4 feedId, uint256 timestamp, uint256 current)",
  "error PriceFeedFutureDrift(bytes4 feedId, uint256 timestamp, uint256 current)",
  "error InsufficientMetadata()",
  "error InvalidMarker()",
  "error ZeroPackageCount()",
  "error ExceedsMaxPackageCount(uint256 count, uint256 max)",
  "error InsufficientFeedPackages()",
  "error InvalidSignatureS()",
  "error PrecompileCallFailed()",
  "error SignatureRecoveryFailed()",
  "error UnmatchedFeedID(bytes4 feedId)",
  "error UnauthorizedSigner(address recoveredSigner)",
]);
const abi = [...CoinGraphGuardAtlas.abi, ...atlasErrors];

const deployer = "0x00000000000000000000000000000000c0ffee05" as Address;
const agent = "0x00000000000000000000000000000000c0ffee06" as Address;
const signer = privateKeyToAccount(generatePrivateKey()); // throwaway key, test only
const guard = getContractAddress({ from: deployer, nonce: 0n });
const { encodeDeployData } = await import("viem");
const { data: runtime } = await client.call({
  account: deployer,
  data: encodeDeployData({ abi: CoinGraphGuardAtlas.abi, bytecode: CoinGraphGuardAtlas.bytecode, args: [ADDR.pancakeRouterV2, ADDR.WBNB, ADDR.USDT, signer.address] }),
});
if (!runtime) throw new Error("constructor call returned no code");
const stateOverride = [
  { address: guard, code: runtime, stateDiff: [{ slot: pad(toHex(0)), value: pad(signer.address) }, { slot: pad(toHex(2)), value: pad(toHex(300)) }] },
  { address: agent, balance: parseEther("10") },
];
const chainId = await client.getChainId();
const block = await client.getBlock();

function describe(e: unknown): string {
  // Walk viem's error chain for the raw revert bytes (some RPCs only put them on the inner error).
  let raw: string | undefined;
  for (let c: any = e; c && !raw; c = c.cause) if (typeof c.data === "string" && c.data.startsWith("0x")) raw = c.data;
  raw ??= (e as Error).message.match(/reason: (0x[0-9a-fA-F]+)/)?.[1];
  if (!raw) return `reverted: ${(e as Error).message.split("\n")[0]}`;
  try {
    const d = decodeErrorResult({ abi, data: raw as Hex });
    if (d.errorName === "OracleDeviation") {
      const [, paid, atlas, gap] = d.args as unknown as bigint[];
      return `reverted: OracleDeviation (paid $${(Number(paid) / 1e18).toPrecision(5)}, Atlas $${(Number(atlas) / 1e18).toPrecision(5)}, gap ${(Number(gap) / 100).toFixed(2)}%)`;
    }
    return `reverted: ${d.errorName}`;
  } catch {
    return `reverted (${raw.slice(0, 10)})`;
  }
}

async function attempt(label: string, a: AnswerAtlas, extra: Hex | null, expect: string) {
  const sig = await signAnswerAtlas(signer, a, chainId, guard);
  const data = encodeFunctionData({ abi: CoinGraphGuardAtlas.abi, functionName: "buy", args: [a, sig, 0n, [ADDR.WBNB, a.token], block.timestamp + 600n] });
  let got: string;
  try {
    await client.call({ account: agent, to: guard, value: a.maxAmountIn, data: extra ? concat([data, extra]) : data, stateOverride, gas: 3_000_000n });
    got = "swap went through";
  } catch (e) {
    got = describe(e);
  }
  const pass = got.startsWith(expect);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(48)} ${got}`);
  return pass;
}

const trx = await checkToken(TRX, 1);
const fake = await checkToken(FAKE_BTCB, 1);
console.log(`TRX check: ${trx.verdict}; copycat BTCB check: ${fake.verdict}`);
const extra = await atlasExtraData(["627", "626"]); // TRX/USD and BTC/USD, signed by Atlas
const now = block.timestamp;
const trxOk = toAnswerAtlas({ ...trx, verdict: "proceed" }, agent, now, { feedId: "627" });
const fakeAsProceed = toAnswerAtlas({ ...fake, verdict: "proceed" }, agent, now, { feedId: "626" });
// Flip one byte inside the first price package (a price byte): the Atlas signature no longer matches.
const i = 2 + 2 * 8;
const tampered = (extra.slice(0, i) + (extra.slice(i, i + 2) === "ff" ? "00" : "ff") + extra.slice(i + 2)) as Hex;

const results = [
  await attempt("TRX, proceed, Atlas TRX/USD attached", trxOk, extra, "swap went through"),
  await attempt("TRX, proceed, no Atlas data attached", trxOk, null, "reverted"),
  await attempt("TRX, proceed, Atlas price bytes tampered", trxOk, tampered, "reverted: UnauthorizedSigner"),
  await attempt("TRX priced against the wrong feed (BTC/USD)", { ...trxOk, atlasFeedId: fakeAsProceed.atlasFeedId }, extra, "reverted: OracleDeviation"),
  await attempt("Copycat BTCB, even with a signed proceed", fakeAsProceed, extra, "reverted: OracleDeviation"),
  await attempt("TRX, proceed, feed not in the payload (ADA)", { ...trxOk, atlasFeedId: "0x00000276" }, extra, "reverted: UnmatchedFeedID"),
  await attempt("TRX, caution, Atlas price fine", { ...trxOk, verdict: 2 }, extra, "reverted: NotProceed"),
];
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
