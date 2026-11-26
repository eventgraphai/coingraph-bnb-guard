// BNB Smart Chain mainnet addresses and the client the checks read through.
import { createPublicClient, fallback, http, type Address } from "viem";
import { bsc } from "viem/chains";

export const ADDR = {
  pancakeFactoryV2: "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73",
  pancakeRouterV2: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  USDT: "0x55d398326f99059fF775485246999027B3197955",
  FDUSD: "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409",
  dead: "0x000000000000000000000000000000000000dEaD",
  zero: "0x0000000000000000000000000000000000000000",
} as const satisfies Record<string, Address>;

// The real contracts behind well-known symbols on BNB Chain. A token using one of these symbols at another address is a copycat.
export const KNOWN: Record<string, Address> = {
  WBNB: ADDR.WBNB,
  BNB: ADDR.WBNB,
  USDT: ADDR.USDT,
  FDUSD: ADDR.FDUSD,
  USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  BTCB: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
  ETH: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
  CAKE: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
  LINK: "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD",
  ADA: "0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47",
  XRP: "0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE",
  DOGE: "0xbA2aE424d960c26247Dd6c32edC70B295c744C43",
  DOT: "0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402",
  TWT: "0x4B0F1812e5Df2A09796481Ff14017e6005508003",
};

// Stablecoins we treat as $1 when valuing a pool.
export const STABLES: Address[] = [ADDR.USDT, ADDR.FDUSD];
// Quote tokens a new token is usually paired with on PancakeSwap.
export const QUOTES: Address[] = [ADDR.WBNB, ADDR.USDT, ADDR.FDUSD];

// NOWNodes when a key is set (our infra partner), public BNB Chain RPCs otherwise. Both support eth_call state overrides.
const urls = [
  ...(process.env.NOWNODES_API_KEY ? [`https://bsc.nownodes.io/${process.env.NOWNODES_API_KEY}`] : []),
  "https://bsc-dataseed.bnbchain.org",
  "https://bsc-rpc.publicnode.com",
];

export const client = createPublicClient({
  chain: bsc,
  transport: fallback(urls.map((u) => http(u, { timeout: 15_000, retryCount: 1 }))),
  batch: { multicall: true },
});
