// Quick live test of the data partners. Usage: pnpm tsx checks/try-apis.ts
import { atlasEnabled, atlasPrices } from "./atlas.js";
import { cmcEnabled, listingByAddress, topAssetForSymbol } from "./cmc.js";
if (atlasEnabled()) {
  try { console.log("Atlas BTC/USD, ADA/USD, Apple:", await atlasPrices(["626", "630", "979"])); } catch (e) { console.log("Atlas error:", (e as Error).message); }
} else console.log("Atlas: no key");
if (cmcEnabled()) {
  console.log("CMC CAKE by contract:", await listingByAddress("0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"));
  console.log("CMC top asset for BTCB:", await topAssetForSymbol("BTCB"));
} else console.log("CMC: no key");
