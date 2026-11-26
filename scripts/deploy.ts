// Deploys ProofLog and CoinGraphGuard to BNB Smart Chain mainnet from the hackathon wallet.
// Writes deployments/bsc.json. Usage: pnpm tsx scripts/deploy.ts          (shows the plan and the cost)
//                                     pnpm tsx scripts/deploy.ts --yes    (sends the two transactions)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { formatEther } from "viem";
import { ADDR, client } from "../checks/chain.js";
import { CoinGraphGuard, ProofLog } from "../contracts/artifacts.generated.js";
import { agentWallet, scan, signerAccount, type Deployment } from "./wallet.js";

const out = new URL("../deployments/bsc.json", import.meta.url);
if (existsSync(out)) {
  const d = JSON.parse(readFileSync(out, "utf8")) as Deployment;
  console.log(`Already deployed.\n  Guard:    ${scan("address", d.guard)}\n  ProofLog: ${scan("address", d.proofLog)}`);
  process.exit(0);
}

const wallet = agentWallet();
const me = wallet.account.address;
const signer = signerAccount().address;
const [balance, gasPrice] = await Promise.all([client.getBalance({ address: me }), client.getGasPrice()]);
const [gasLog, gasGuard] = await Promise.all([
  client.estimateGas({ account: me, data: (await import("viem")).encodeDeployData({ abi: ProofLog.abi, bytecode: ProofLog.bytecode, args: [me] }) }),
  client.estimateGas({ account: me, data: (await import("viem")).encodeDeployData({ abi: CoinGraphGuard.abi, bytecode: CoinGraphGuard.bytecode, args: [ADDR.pancakeRouterV2, signer] }) }),
]);
const cost = (gasLog + gasGuard) * gasPrice;
console.log(`From wallet:      ${me}  (balance ${formatEther(balance)} BNB)`);
console.log(`CoinGraph signer: ${signer}`);
console.log(`Deploy ProofLog (recorder = your wallet) and CoinGraphGuard (PancakeSwap v2 router, signer above).`);
console.log(`Estimated cost:   ${formatEther(cost)} BNB for both`);
if (balance < cost * 2n) throw new Error("Not enough BNB for gas yet.");
if (!process.argv.includes("--yes")) {
  console.log("\nNothing sent. Run again with --yes to deploy.");
  process.exit(0);
}

const proofLogTx = await wallet.deployContract({ abi: ProofLog.abi, bytecode: ProofLog.bytecode, args: [me] });
console.log(`ProofLog sent: ${scan("tx", proofLogTx)}`);
const r1 = await client.waitForTransactionReceipt({ hash: proofLogTx });
const guardTx = await wallet.deployContract({ abi: CoinGraphGuard.abi, bytecode: CoinGraphGuard.bytecode, args: [ADDR.pancakeRouterV2, signer] });
console.log(`Guard sent:    ${scan("tx", guardTx)}`);
const r2 = await client.waitForTransactionReceipt({ hash: guardTx });

const d: Deployment = { chainId: 56, guard: r2.contractAddress!, proofLog: r1.contractAddress!, signer, recorder: me, guardTx, proofLogTx, deployedAt: new Date().toISOString() };
mkdirSync(new URL("../deployments/", import.meta.url), { recursive: true });
writeFileSync(out, JSON.stringify(d, null, 2));
console.log(`\nDeployed.\n  Guard:    ${scan("address", d.guard)}\n  ProofLog: ${scan("address", d.proofLog)}\nSaved deployments/bsc.json`);
