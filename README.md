# CoinGraph BNB Guard

Before an AI agent trades on BNB Chain, it asks CoinGraph. The answer is paid per call, recorded on BNB Chain, and anyone can check it. A guard contract lets the swap through only on a signed "proceed".

Built for BNB Hack at BNB Bangkok (25 to 27 Nov 2026). This repository was started on 25 Nov 2026; all code here is new work for the hackathon. It calls the existing [CoinGraph](https://coingraph.ai) API for top-1,000 token data.

> Status: the check engine, the web page and the API are live. The guard and proof contracts run on BNB Smart Chain mainnet; the demo uses small amounts.

## Deployed on BNB Smart Chain mainnet

| Contract | Address |
| --- | --- |
| CoinGraphGuard (refuses any buy without a recent signed "proceed") | [0x7f914975c2af57253a707fb2c2e44776dc45000b](https://bscscan.com/address/0x7f914975c2af57253a707fb2c2e44776dc45000b) |
| ProofLog (every answer recorded before the trade) | [0x186ef344dcd0dd74d292a5d2b4433d77e19f5f7d](https://bscscan.com/address/0x186ef344dcd0dd74d292a5d2b4433d77e19f5f7d) |
| CoinGraph answer signer | 0x5c514443a2e40F74960822851aF3fab75C44F4C6 |

Live site: https://guard.coingraph.ai

### Live demo on mainnet (26 Nov 2026)

An AI agent asked CoinGraph before each $1 buy, recorded the signed answer on BNB Smart Chain, then bought through the guard. Only "proceed" goes through.

| Token | Verdict | Answer recorded | What the guard did |
| --- | --- | --- | --- |
| ASTER | proceed | [record](https://bscscan.com/tx/0x96bab07f0d8dc7567995d8788a447c81e8f529a5e9b4206f6c7824a02cceb135) | [bought](https://bscscan.com/tx/0x21f574b6aff2a2de746276b898339cd699bfa8be33e6d71eee4c918d45d82e65) |
| TWT | proceed | [record](https://bscscan.com/tx/0xf8f678ebfeb723275e7c8eb2c87010a02a435ded969c69633a19b2afe884e36e) | [bought](https://bscscan.com/tx/0x8a9917d558dd816ec8410edae67890c3c97b24a2f125cfcb279d6b751bb122df) |
| SFP | proceed | [record](https://bscscan.com/tx/0xf0a60d9f84d79f3f8b8fff9e30237d05076309f3861acd026404259a39465b01) | [bought](https://bscscan.com/tx/0x35790feced6b5bbe4476e9dcfe817c64386ba3b840f89f17de65bd2277882d47) |
| CAKE | proceed | [record](https://bscscan.com/tx/0xc658181593f990e4d6cd0aa5a391618cc2129dc78585f19706a74d4fdc8f308c) | [bought](https://bscscan.com/tx/0x03e5021db14c948b6c3b8425ede04c27a8f33b5394546117128f4aa0fa0a9c09) |
| NVDAB | caution | [record](https://bscscan.com/tx/0x46d06b40acafaa6b63d6a58f0c54b0f6b45eedee1016cc980ea8a4608f41e61b) | [held back](https://bscscan.com/tx/0xbf1dcd51ef697e34fe27bf309d5ad8e6ed69d82dd25a284482cbbf917d0fa5c6) |
| Copycat "BTCB" (0x6583…fd26) | avoid | [record](https://bscscan.com/tx/0x340c4adf9d5fbb85fffb169ca96d5da444607668b677cfd610ac388ad419f871) | [stopped](https://bscscan.com/tx/0x3778d8c4a28a3faeb5ce5f4e2788360e86a8b0a3ba9117c5ca184861701f39b6) |

A held or stopped buy shows as "Fail" on BscScan: the guard reverted it, the BNB never left the wallet, and only gas was paid. The signed verdict inside each transaction can be decoded with `scripts/answer-in-tx.ts`.
The full evidence for each answer is in [`proofs/`](proofs). Its keccak256 hash matches the `evidenceHash` recorded on chain.
Each answer record costs about 26,000 gas (about $0.0007 at 0.05 gwei). Every check served on guard.coingraph.ai is recorded the same way.

## Atlas Oracle price, checked inside the contract

`contracts/CoinGraphGuardAtlas.sol` inherits Atlas Oracle's own pull-oracle consumer (`PullOracleConsumerStandard`, vendored unchanged in `contracts/vendor/atlas`). The agent appends Atlas's signed payload to the buy transaction, and in that same transaction the guard:

1. checks CoinGraph's signed answer (agent, token, amount, 5-minute expiry, one use);
2. verifies Atlas's signature on chain against Atlas's signer and rejects prices older than 180 seconds;
3. compares the price the agent is about to pay on PancakeSwap with Atlas's price, and reverts with `OracleDeviation` if the gap is larger than the answer allows (3% by default);
4. only then applies the verdict: proceed buys, caution or avoid reverts.

So even a signed "proceed" cannot buy a token whose pool price is far from the real asset, and nobody, CoinGraph included, can fake the reference price.

Tested against live mainnet state and a live Atlas payload without spending anything (`npx tsx contracts/test-guard-atlas.ts`):

| Case | Result |
| --- | --- |
| TRX, proceed, Atlas TRX/USD attached | swap goes through |
| No Atlas data attached | reverts `InvalidMarker` |
| One Atlas price byte changed | reverts `UnauthorizedSigner` |
| TRX checked against the wrong feed (BTC/USD) | reverts `OracleDeviation` |
| Copycat "BTCB", even with a signed proceed | reverts `OracleDeviation` (pays $0.000012 vs Atlas BTC $60,722) |
| Feed missing from the payload | reverts `UnmatchedFeedID` |
| TRX, caution | reverts `NotProceed` |

Deploy: `npx tsx scripts/deploy-atlas.ts` (dry run, then `--yes`). Demo: `npx tsx scripts/demo-atlas.ts <token> <usd> [feedId] --yes`.

## Cournot Integration (market risk)

Before an agent buys, CoinGraph asks the [Cournot Intelligence Oracle](https://skill.cournot.ai/) how likely a sharp drop is in the asset the trade depends on, and uses the answer to decide how much it will sign for. Code: `checks/cournot.ts`, wired in `checks/check.ts` and `checks/answer.ts`.

1. **The claim.** Every buy through the guard is paid in BNB, so the default claim is about BNB; tokens that track another asset (BTCB, ETH, SOL) use that asset. CoinGraph builds a downside claim about 10% below today's price, for example *"Will BNB price fall below $500 before 2027-01-01?"*
2. **Resolve (free).** The claim is matched to a prediction market with Cournot's `resolve` endpoint, using the official skill's rule (one match, or a clear leader; ties that only differ by end date go to the date in the claim).
3. **Probability.** Cournot's `probability` endpoint returns its fair-value probability, the market's own price and the external evidence (`basis`). Results are cached for 6 hours per market, and every call is logged in `logs/cournot-calls.jsonl`; the full response of each successful call is saved in `proofs/cournot/`.
4. **The decision.** The probability sets the order CoinGraph signs for:

| Cournot probability of the drop | What CoinGraph does |
| --- | --- |
| under 40% | signs for the full order |
| 40% to 75% | signs for (1 − probability) of the order, at least 25% |
| 75% or more | caution: no buy for now |

The scaled amount goes into the signed answer's `maxAmountIn`, so **the guard contract enforces Cournot's decision on chain**: a bigger buy reverts with `AmountTooLarge`. The probability and evidence are part of the answer's evidence file, whose hash is recorded on BNB Smart Chain.

5. **Shown to the user.** Each check on guard.coingraph.ai shows the exact claim, Cournot's probability, the prediction-market price, the order size CoinGraph signs for, and every field of Cournot's assessment and evidence, links unchanged. `GET /api/market-risk` returns the current BNB assessment.

Setup: works without a key on Cournot's free allowance (3 calls per IP); set `COURNOT_API_KEY` for a prepaid pack. `COURNOT_CACHE_HOURS` (default 6) and `COURNOT_ENABLED=0` (off) are optional. Run one live call: `npx tsx scripts/cournot-probe.ts BNB`.

## How it works

1. The agent asks CoinGraph to check a token before a trade (API, MCP, or x402 pay per check).
2. CoinGraph reads BNB Chain data (BNB Smart Chain nodes, PancakeSwap pools, BscScan) and answers proceed, caution or avoid, sized to the order.
3. CoinGraph signs the answer and records its hash on BNB Smart Chain.
4. The guard contract wraps the PancakeSwap swap: a valid recent "proceed" lets it through; "avoid" makes the transaction revert.

## Known limits

- **Trades go through PancakeSwap v2.** The honeypot simulation and the guarded buy use the PancakeSwap v2 router (largest BNB Chain DEX, handles taxed tokens). Liquidity is read across every DEX pool (PancakeSwap v2/v3, Uniswap v3 and others) through CoinMarketCap DEX data, so a token that mainly trades on v3 is judged on its real liquidity, but the guard still routes through v2. Next: PancakeSwap v3 and an aggregator route.
- **Atlas inside the contract needs a free feed.** CoinGraphGuardAtlas checks the price on chain only when the token has an Atlas feed; for other tokens the answer carries feed 0 and the guard applies CoinGraph's verdict alone. Atlas's consumer library is BUSL-1.1; we use it unchanged for this hackathon build and will confirm production terms with the Atlas team.
- **Free Atlas feeds** cover BTC, ADA, DOGE, TRX, AVAX, NEAR, SUI, HYPE, stablecoins and tokenized stocks, not BNB-native tokens like CAKE or ASTER.

## CoinMarketCap × Atlas

See the one-page integration write-up: [docs/CMC-ATLAS-WRITEUP.md](docs/CMC-ATLAS-WRITEUP.md).

## Folders

| Folder | What goes there |
| --- | --- |
| `checks/` | BNB Chain token checks: honeypot, sell tax, holders, liquidity, owner powers, deployer history |
| `contracts/` | Guard contract and the proof recorder (BNB Smart Chain) |
| `agent/` | Demo trading agent: one refused trade, one approved trade |
| `worker/` | Check endpoint and MCP server on Cloudflare Workers, with x402 pay per check |
| `docs/` | Build plan |

## Setup

```bash
cp .env.example .env   # fill in keys locally; never commit .env
```

Use a fresh wallet holding only a few dollars of BNB for gas. Never put a key that holds your savings in this project.

## Notes

CoinGraph is not affiliated with Binance or BNB Chain. Answers are provable (recorded on chain), not a guarantee about any token, and not financial advice.

## Licence

MIT, see [LICENSE](LICENSE). Exception: `contracts/vendor/atlas/` is Atlas Oracle's pull-oracle consumer SDK (@atlas-oracle/pull-oracle-consumer 1.0.0), BUSL-1.1, included unchanged with its licence headers.
