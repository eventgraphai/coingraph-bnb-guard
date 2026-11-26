// Usage: pnpm check <token address> [order size in USD]
import { checkToken } from "./check.js";

const [token, size] = process.argv.slice(2);
if (!token) {
  console.error("Usage: pnpm check <token address> [order size in USD, default 500]");
  process.exit(1);
}
const r = await checkToken(token, size ? Number(size) : 500);
const icon = { ok: "  ok     ", caution: "  caution", avoid: "  AVOID  " } as const;
console.log(`\n${r.symbol ?? "?"} (${r.name ?? "unknown"})  ${r.token}`);
console.log(`Order $${r.orderUsd}  ->  ${r.verdict.toUpperCase()}\n`);
for (const f of r.findings) console.log(`${icon[f.level]}  ${f.text}`);
if (process.argv.includes("--json")) console.log("\n" + JSON.stringify(r, null, 2));
