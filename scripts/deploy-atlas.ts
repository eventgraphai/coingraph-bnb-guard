// Deploys CoinGraphGuardAtlas (the guard that also checks Atlas Oracle's signed price on chain) to BNB Smart Chain.
// Reuses the existing ProofLog. Writes deployments/bsc-atlas.json.
// Usage: npx tsx scripts/deploy-atlas.ts          (shows the plan and the cost)
//        npx tsx scripts/deploy-atlas.ts --yes    (sends the transaction)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { encodeDeployData, formatEther } from "viem";
import { ADDR, client } from "../checks/chain.js";
import { CoinGraphGuardAtlas } from "../contracts/artifacts.generated.js";
import { agentWallet, scan, signerAccount, type Deployment } from "./wallet.js";

const out = new URL("../deployments/bsc-atlas.json", import.meta.url);
if (existsSync(out)) {
  const d = JSON.parse(readFileSync(out, "utf8")) as { guardAtlas: string };
  console.log(`Already deployed: ${scan("address", d.guardAtlas)}`);
  process.exit(0);
}
const v1 = JSON.parse(readFileSync(new URL("../deployments/bsc.json", import.meta.url), "utf8")) as Deployment;
const wallet = agentWallet();
const me = wallet.account.address;
const signer = signerAccount().address;
const args = [ADDR.pancakeRouterV2, ADDR.WBNB, ADDR.USDT, signer] as const;
const [balance, gasPrice, gas] = await Promise.all([
  client.getBalance({ address: me }),
  client.getGasPrice(),
  client.estimateGas({ account: me, data: encodeDeployData({ abi: CoinGraphGuardAtlas.abi, bytecode: CoinGraphGuardAtlas.bytecode, args }) }),
]);
console.log(`From wallet:      ${me}  (balance ${formatEther(balance)} BNB)`);
console.log(`CoinGraph signer: ${signer}`);
console.log(`Deploy CoinGraphGuardAtlas (PancakeSwap v2 router, WBNB, USDT, signer above). ProofLog stays ${v1.proofLog}.`);
console.log(`Estimated cost:   ${formatEther(gas * gasPrice)} BNB`);
if (balance < gas * gasPrice * 2n) throw new Error("Not enough BNB for gas.");
if (!process.argv.includes("--yes")) {
  console.log("\nNothing sent. Run again with --yes to deploy.");
  process.exit(0);
}
const tx = await wallet.deployContract({ abi: CoinGraphGuardAtlas.abi, bytecode: CoinGraphGuardAtlas.bytecode, args });
console.log(`Sent: ${scan("tx", tx)}`);
const r = await client.waitForTransactionReceipt({ hash: tx });
writeFileSync(out, JSON.stringify({ chainId: 56, guardAtlas: r.contractAddress, proofLog: v1.proofLog, signer, deployer: me, tx, deployedAt: new Date().toISOString() }, null, 2));
console.log(`\nDeployed: ${scan("address", r.contractAddress!)}\nSaved deployments/bsc-atlas.json`);
