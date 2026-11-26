// Tests CoinGraphGuard against real BNB Chain mainnet state without deploying or spending anything:
// the constructor runs inside eth_call, its runtime code is placed at the address it would have, and each case
// runs a real PancakeSwap buy through it with a state override. Run: pnpm tsx contracts/test-guard.ts
import { decodeErrorResult, encodeFunctionData, getContractAddress, pad, parseEther, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ADDR, client } from "../checks/chain.js";
import { checkToken } from "../checks/check.js";
import { signAnswer, toAnswer, type Answer } from "../checks/answer.js";
import { CoinGraphGuard } from "./artifacts.generated.js";

const deployer = "0x00000000000000000000000000000000c0ffee03" as Address;
const agent = "0x00000000000000000000000000000000c0ffee04" as Address;
const signer = privateKeyToAccount(generatePrivateKey()); // throwaway key, test only
const stranger = privateKeyToAccount(generatePrivateKey());

// Run the constructor in eth_call to get runtime code with its immutables filled for this address.
const guard = getContractAddress({ from: deployer, nonce: 0n });
const { encodeDeployData } = await import("viem");
const deployData = encodeDeployData({ abi: CoinGraphGuard.abi, bytecode: CoinGraphGuard.bytecode, args: [ADDR.pancakeRouterV2, signer.address] });
const { data: runtime } = await client.call({ account: deployer, data: deployData });
if (!runtime) throw new Error("constructor call returned no code");

const chainId = await client.getChainId();
const block = await client.getBlock();
const stateOverride = [
  { address: guard, code: runtime, stateDiff: [
    { slot: pad(toHex(0)), value: pad(signer.address) }, // signer
    { slot: pad(toHex(2)), value: pad(toHex(300)) },      // maxAge
  ] },
  { address: agent, balance: parseEther("10") },
];

async function attempt(label: string, a: Answer, sig: Hex, value: bigint, expect: string) {
  const data = encodeFunctionData({ abi: CoinGraphGuard.abi, functionName: "buy", args: [a, sig, 0n, [ADDR.WBNB, a.token], block.timestamp + 600n] });
  let got: string;
  try {
    await client.call({ account: agent, to: guard, value, data, stateOverride, gas: 3_000_000n });
    got = "swap went through";
  } catch (e) {
    // Public RPCs return the custom error as hex inside the message; pull it out and decode it with the guard's ABI.
    // Walk viem's error chain for the raw revert bytes (some RPCs only put them on the inner error).
    let raw: Hex | undefined;
    for (let c: any = e; c && !raw; c = c.cause) if (typeof c.data === "string" && c.data.startsWith("0x")) raw = c.data as Hex;
    raw ??= (e as Error).message.match(/reason: (0x[0-9a-fA-F]+)/)?.[1] as Hex | undefined;
    try {
      got = raw ? `reverted: ${decodeErrorResult({ abi: CoinGraphGuard.abi, data: raw }).errorName}` : `reverted: ${(e as Error).message.split("\n")[0]}`;
    } catch {
      got = `reverted (${raw?.slice(0, 10)})`;
    }
  }
  const pass = got.startsWith(expect);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(44)} ${got}`);
  return pass;
}

const cake = await checkToken("0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", 50);
const fake = await checkToken("0x6583a27d7c7C0d755414b9471BD55EF9a39afd26", 50); // the copycat BTCB found by the scan
console.log(`CAKE check: ${cake.verdict}; fake BTCB check: ${fake.verdict}\n`);

const now = block.timestamp;
const ok = toAnswer(cake, agent, now);
const bad = toAnswer(fake, agent, now);
const amount = ok.maxAmountIn;
const results = [
  await attempt("CAKE, signed proceed", ok, await signAnswer(signer, ok, chainId, guard), amount, "swap went through"),
  await attempt("fake BTCB, signed avoid", bad, await signAnswer(signer, bad, chainId, guard), bad.maxAmountIn, "reverted: NotProceed"),
  await attempt("CAKE, answer signed by someone else", ok, await signAnswer(stranger, ok, chainId, guard), amount, "reverted: WrongSigner"),
  await attempt("CAKE, buying more than the answer covers", ok, await signAnswer(signer, ok, chainId, guard), amount * 3n, "reverted: AmountTooLarge"),
  await attempt("CAKE, answer older than 5 minutes", { ...ok, issuedAt: now - 1000n }, await signAnswer(signer, { ...ok, issuedAt: now - 1000n }, chainId, guard), amount, "reverted: AnswerExpired"),
  await attempt("CAKE answer used to buy another token", { ...ok, token: ADDR.USDT }, await signAnswer(signer, ok, chainId, guard), amount, "reverted: WrongSigner"),
];
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
