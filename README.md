# CoinGraph BNB Guard

Before an AI agent trades on BNB Chain, it asks CoinGraph. The answer is paid per call, recorded on BNB Chain, and anyone can check it. A guard contract lets the swap through only on a signed "proceed".

Built for BNB Hack at BNB Bangkok (25 to 27 Nov 2026). This repository was started on 25 Nov 2026; all code here is new work for the hackathon. It calls the existing [CoinGraph](https://coingraph.ai) API for top-1,000 token data.

> Status: setup only. Everything in the demo runs on BNB Chain testnet and opBNB testnet.

## How it works

1. The agent asks CoinGraph to check a token before a trade (API, MCP, or x402 pay per check).
2. CoinGraph reads BNB Chain data (NOWNodes BSC nodes, PancakeSwap pools, BscScan) and answers proceed, caution or avoid, sized to the order.
3. CoinGraph signs the answer and records its hash on opBNB.
4. The guard contract wraps the PancakeSwap swap: a valid recent "proceed" lets it through; "avoid" makes the transaction revert.

## Folders

| Folder | What goes there |
| --- | --- |
| `checks/` | BNB Chain token checks: honeypot, sell tax, holders, liquidity, owner powers, deployer history |
| `contracts/` | Guard contract and the proof recorder (BNB Chain testnet, opBNB testnet) |
| `agent/` | Demo trading agent: one refused trade, one approved trade |
| `worker/` | Check endpoint and MCP server on Cloudflare Workers, with x402 pay per check |
| `docs/` | Build plan |

## Setup

```bash
cp .env.example .env   # fill in keys locally; never commit .env
```

Use a wallet made for testnet only. Never put a key that holds real funds in this project.

## Notes

CoinGraph is not affiliated with Binance or BNB Chain. Answers are provable (recorded on chain), not a guarantee about any token, and not financial advice.

## Licence

MIT, see [LICENSE](LICENSE).
