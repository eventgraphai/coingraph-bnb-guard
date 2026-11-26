// Shows what Living Brain remembers about a token. Usage: npx tsx scripts/brain-probe.ts <token> [symbol]
import { brain, recall } from "../checks/memory.js";
const token = process.argv[2] ?? "0xCE7de646e7208a4Ef112cb6ed5038FA6cC6b12e3";
console.log("brain", await brain());
console.log(JSON.stringify(await recall(token, process.argv[3] ?? "TRX"), null, 2));
