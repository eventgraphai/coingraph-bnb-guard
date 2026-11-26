# CoinGraph Guard: CoinMarketCap × Atlas integration write-up

**Project:** CoinGraph Guard: Every AI Agent Trade, Checked First. Verifiable On-Chain.
**Team:** CoinGraph (BlockEXC Pte. Ltd.), Ajay Prashanth, founder. X: @CoinGraphAI
**Live:** https://guard.coingraph.ai · **Code:** https://github.com/eventgraphai/coingraph-bnb-guard

## Problem and audience

AI agents now trade real money on BNB Chain. Thousands of tokens launch every day through Four.meme, Flap and PancakeSwap, and some are built to trap buyers: copycats of well-known names, honeypots, hidden taxes and pools drained after launch. Nothing checks the token before an agent buys, and when money is lost nobody can see what the agent knew.

**Audience:** developers building trading agents, wallets and launchpads on BNB Chain, and the people who use them. They need one call that says proceed, caution or avoid before money moves, plus a record they can check afterwards.

## What CoinGraph Guard does

Before a buy, the agent asks CoinGraph about the token and the order size. CoinGraph simulates a real buy and sell on PancakeSwap, reads liquidity, taxes and owner powers, confirms the token's identity with **CoinMarketCap**, and compares its price with **Atlas Oracle**. It answers proceed, caution or avoid with every reason. Each answer is recorded on BNB Smart Chain, and the CoinGraphGuard contract refuses any buy without a recent signed "proceed".

## Data used, and why

| Source | Endpoint or feed | What it decides |
| --- | --- | --- |
| CoinMarketCap Pro API | `GET /v2/cryptocurrency/info?address=` | Is this exact BNB Chain contract listed, and as which asset? |
| CoinMarketCap Pro API | `GET /v1/cryptocurrency/map?symbol=` and `/v2/cryptocurrency/info?id=` | **Copycat detection:** a token using a listed asset's symbol at a different address gets avoid, and the answer names the official contract. It also recognises official bridged contracts such as Binance-Peg ADA. |
| CoinMarketCap Pro API | `GET /v2/cryptocurrency/quotes/latest` | Market price, 24h volume and rank. The PancakeSwap pool price is compared with it: a gap over 10% means a thin, stale or pushed pool (avoid). |
| CoinMarketCap DEX API | `GET /v1/dex/token`, `GET /v1/dex/token/pools` (platform `bsc`) | **Liquidity across every DEX pool** (PancakeSwap v2 and v3, Uniswap v3), shown as a "where it trades" chart, so large tokens are judged on real liquidity, not one pool. |
| CoinMarketCap DEX API | `GET /v1/dex/holders/count` | **Holder count.** Under 50 holders means avoid: the copycat BTCB has 9, CAKE has 1.89M. |
| CoinMarketCap | `GET /v1/global-metrics/quotes/latest`, `GET /v3/fear-and-greed/latest`, `GET /v1/altcoin-season-index/latest` | **Market mood banner:** total market cap, BTC dominance, Fear & Greed, altcoin season. |
| CoinMarketCap | `GET /v1/cryptocurrency/listings/latest` + `info` tag names | **BNB Chain top 50 board** (guard.coingraph.ai/bnb): the largest assets tradable on BNB Chain with price, 24h and 7d change, market cap, volume, category tags and a CoinGraph verdict for each. |
| Atlas Oracle | Pull API `POST /report/v1/price/latest` (signed payload, decoded per Atlas's SDK layout) | **Independent reference price.** Pool price vs Atlas price for BTC (#626), ADA (#630), DOGE, TRX and tokenized stocks and ETFs on BNB Chain (Apple #979, NVIDIA, S&P 500 ETF and more). A token trading far from the asset it represents gets avoid. |
| BNB Smart Chain | PancakeSwap v2 factory, pairs, router; token bytecode | Buy and sell simulated inside eth_call (nothing spent): taxes, honeypot, liquidity, burned LP, owner powers, price impact. |

**Using both together** is what catches the hardest case. The copycat "BTCB" (0x6583…fd26) passed the honeypot test, since buying and selling both worked. But CoinMarketCap showed it isn't the listed BTCB, and Atlas showed its price 100% away from BTC/USD. Its pool was then drained from $65,333 to $3.21 of liquidity within a day.

**Verifiable usage:** every call is logged with time, endpoint, HTTP status and credits used (`logs/cmc-calls.jsonl`, `logs/atlas-calls.jsonl`; API keys are server-side only, never in the front end or the repo). On 26 Nov 2026 the logs held 123 CoinMarketCap calls (info, quotes, map) and 27 Atlas calls (feeds 626, 630, 627, 628, 979).

## BNB Chain contracts and transactions (mainnet)

| | Address or transaction |
| --- | --- |
| CoinGraphGuard | [0x7f914975c2af57253a707fb2c2e44776dc45000b](https://bscscan.com/address/0x7f914975c2af57253a707fb2c2e44776dc45000b) |
| ProofLog (every answer recorded) | [0x186ef344dcd0dd74d292a5d2b4433d77e19f5f7d](https://bscscan.com/address/0x186ef344dcd0dd74d292a5d2b4433d77e19f5f7d) |
| CAKE: proceed, buy went through | [0x03e5…9c09](https://bscscan.com/tx/0x03e5021db14c948b6c3b8425ede04c27a8f33b5394546117128f4aa0fa0a9c09) |
| Copycat BTCB: avoid, buy refused (NotProceed) | [0x3778…39b6](https://bscscan.com/tx/0x3778d8c4a28a3faeb5ce5f4e2788360e86a8b0a3ba9117c5ca184861701f39b6) |

Each answer record costs about 26,000 gas, roughly $0.0007. The evidence for every demo answer is in `proofs/`, and its keccak256 hash matches the record on chain.

## What we would build next

1. **The guard reads Atlas on chain:** the swap reverts when the PancakeSwap price strays from Atlas's signed price, using Atlas's pull-oracle consumer.
2. **CoinMarketCap DEX data** for brand-new BNB Chain pairs and holder data, so launches are checked minutes after they list.
3. **x402 pay-per-check**, so agents pay per call without an account, and PancakeSwap v3 pools.
4. **More chains** for the same check and proof, as part of CoinGraph, the trust layer for AI agents in crypto.
