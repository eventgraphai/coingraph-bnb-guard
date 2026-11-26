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

An AI agent asked CoinGraph before each $1 buy, recorded the signed answer, then bought through the guard.

| Token | CoinGraph verdict | Answer recorded | Buy through the guard |
| --- | --- | --- | --- |
| CAKE | proceed | [record](https://bscscan.com/tx/0xc658181593f990e4d6cd0aa5a391618cc2129dc78585f19706a74d4fdc8f308c) | [went through](https://bscscan.com/tx/0x03e5021db14c948b6c3b8425ede04c27a8f33b5394546117128f4aa0fa0a9c09) |
| Copycat "BTCB" (0x6583…fd26) | avoid | [record](https://bscscan.com/tx/0x340c4adf9d5fbb85fffb169ca96d5da444607668b677cfd610ac388ad419f871) | [refused on chain: NotProceed](https://bscscan.com/tx/0x3778d8c4a28a3faeb5ce5f4e2788360e86a8b0a3ba9117c5ca184861701f39b6) |

The full evidence for each answer is in [`proofs/`](proofs). Its keccak256 hash matches the `evidenceHash` recorded on chain.
Each answer record costs about 26,000 gas (about $0.0007 at 0.05 gwei). Every check served on guard.coingraph.ai is recorded the same way.

## How it works

1. The agent asks CoinGraph to check a token before a trade (API, MCP, or x402 pay per check).
2. CoinGraph reads BNB Chain data (NOWNodes BSC nodes, PancakeSwap pools, BscScan) and answers proceed, caution or avoid, sized to the order.
3. CoinGraph signs the answer and records its hash on BNB Smart Chain.
4. The guard contract wraps the PancakeSwap swap: a valid recent "proceed" lets it through; "avoid" makes the transaction revert.

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

MIT, see [LICENSE](LICENSE).
