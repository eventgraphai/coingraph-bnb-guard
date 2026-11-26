// Loads .env from the repository root (Node 20.12+). Imported first so every module sees the keys.
try {
  process.loadEnvFile(new URL("../.env", import.meta.url).pathname);
} catch {
  // No .env: public RPCs and the built-in copycat list still work; CoinMarketCap checks are skipped.
}
