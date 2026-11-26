// CoinGraph BNB Guard: checks one BNB Chain token before an agent buys it with a given order size.
// Reads chain state only. The buy/sell test runs inside eth_call with a state override, so nothing is spent.
import { encodeFunctionData, decodeFunctionResult, formatUnits, getAddress, isAddress, parseAbi, parseEther, toFunctionSelector, type Address, type Hex } from "viem";
import { ADDR, KNOWN, QUOTES, STABLES, client } from "./chain.js";
import { simulatorAbi, simulatorCode } from "./simulator.generated.js";
import { atlasEnabled, atlasPrices } from "./atlas.js";
import { atlasFeedFor } from "./atlas-feeds.js";
import { cmcEnabled, listingByAddress, topAssetForSymbol, type CmcListing } from "./cmc.js";

export type Level = "ok" | "caution" | "avoid";
export type Verdict = "proceed" | "caution" | "avoid";
export type Finding = { level: Level; check: string; text: string };

export type CheckResult = {
  chain: "bsc";
  token: Address;
  name: string | null;
  symbol: string | null;
  orderUsd: number;
  verdict: Verdict;
  findings: Finding[];
  numbers: {
    bnbPriceUsd: number;
    liquidityUsd: number | null;
    pool: Address | null;
    poolQuote: string | null;
    buyTaxPct: number | null;
    sellTaxPct: number | null;
    priceImpactPct: number | null;
    lpBurnedPct: number | null;
    owner: Address | null;
    isProxy: boolean;
    poolPriceUsd: number | null;
    cmc: CmcListing | null;
    atlas: { feedId: string; label: string; priceUsd: number; timestamp: number; signature: string } | null;
  };
  checkedAt: string;
  block: string;
};

const erc20 = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function owner() view returns (address)",
  "function getOwner() view returns (address)",
]);
const factoryAbi = parseAbi(["function getPair(address,address) view returns (address)"]);
const pairAbi = parseAbi([
  "function getReserves() view returns (uint112,uint112,uint32)",
  "function token0() view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);
const routerAbi = parseAbi(["function getAmountsOut(uint256,address[]) view returns (uint256[])"]);

// Functions that let the owner change the rules after people buy. Matched against the selectors in the contract's bytecode.
const POWERS: Record<string, string[]> = {
  "mint new tokens": ["mint(address,uint256)", "mint(uint256)", "_mint(address,uint256)"],
  "block wallets from selling": ["blacklist(address)", "addToBlacklist(address)", "setBlacklist(address,bool)", "blacklistAddress(address,bool)", "addBots(address[])", "setBots(address[])", "setBot(address,bool)", "setIsBlacklisted(address,bool)"],
  "change the tax": ["setFee(uint256)", "setFees(uint256,uint256)", "setTaxFee(uint256)", "setSellFee(uint256)", "setBuyFee(uint256)", "updateFees(uint256,uint256)", "setTax(uint256)", "setTaxes(uint256,uint256)", "setSellTax(uint256)", "setBuyTax(uint256)"],
  "pause trading": ["pause()", "setTradingEnabled(bool)", "setTrading(bool)"],
  "cap how much a wallet can sell": ["setMaxTxAmount(uint256)", "setMaxTxPercent(uint256)", "setMaxWalletSize(uint256)", "setMaxSellAmount(uint256)"],
};
const EIP1967_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const SIM_ADDR = "0x00000000000000000000000000000000c0ffee01" as Address;
const SIM_FROM = "0x00000000000000000000000000000000c0ffee02" as Address;
// A pool this deep is an established token: LP burning and owner contracts matter far less than for a new launch.
const ESTABLISHED_USD = 1_000_000;

const pct = (x: number) => Math.round(x * 10000) / 100;
const usd = (x: number) => `$${x >= 100 ? Math.round(x).toLocaleString("en-US") : x.toFixed(2)}`;
const fmtPrice = (x: number) => (x >= 1 ? `$${x.toFixed(2)}` : `$${x.toPrecision(3)}`);
const safe = async <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

function selectorsIn(code: Hex): Set<string> {
  // PUSH4 operands (opcode 0x63) are where function selectors live in the dispatcher.
  const out = new Set<string>();
  const b = code.slice(2);
  for (let i = 0; i < b.length; i += 2) {
    const op = parseInt(b.slice(i, i + 2), 16);
    if (op === 0x63) out.add("0x" + b.slice(i + 2, i + 10));
    if (op >= 0x60 && op <= 0x7f) i += (op - 0x5f) * 2; // skip PUSH data
  }
  return out;
}

export async function checkToken(tokenIn: string, orderUsd = 500): Promise<CheckResult> {
  if (!isAddress(tokenIn)) throw new Error("Not a valid token address.");
  const token = getAddress(tokenIn);
  const findings: Finding[] = [];
  const add = (level: Level, check: string, text: string) => findings.push({ level, check, text });
  const block = await client.getBlockNumber();

  const [code, name, symbol, decimals, implSlot] = await Promise.all([
    client.getCode({ address: token }),
    safe(client.readContract({ address: token, abi: erc20, functionName: "name" })),
    safe(client.readContract({ address: token, abi: erc20, functionName: "symbol" })),
    safe(client.readContract({ address: token, abi: erc20, functionName: "decimals" })),
    safe(client.getStorageAt({ address: token, slot: EIP1967_IMPL })),
  ]);
  if (!code || code === "0x") throw new Error("No contract at this address on BNB Chain.");
  if (decimals === null) throw new Error("This contract does not behave like a token (no decimals).");

  // Identity. With a CoinMarketCap key: is this exact contract listed, and if not, does its symbol belong to a
  // well-known listed asset (a copycat)? Without a key: a built-in list of major BNB Chain tokens.
  let listing: CmcListing | null = null;
  if (cmcEnabled()) {
    listing = await safe(listingByAddress(token));
    if (listing) {
      const vol = listing.volume24hUsd ? `, ${usd(listing.volume24hUsd)} traded in 24h` : "";
      add("ok", "identity", `Listed on CoinMarketCap as ${listing.name} (${listing.symbol})${listing.rank ? `, rank #${listing.rank}` : ""}${vol}.`);
    } else {
      const top = symbol ? await safe(topAssetForSymbol(symbol)) : null;
      // Copycat when CMC lists a well-known asset under this symbol, or any asset whose BNB Chain contract is a different address.
      if (top && (top.rank <= 1000 || (top.bscAddress && top.bscAddress.toLowerCase() !== token.toLowerCase()))) {
        const where = top.bscAddress ? `its BNB Chain contract is ${top.bscAddress}` : `it lives on ${top.chain}`;
        add("avoid", "copycat", `This is not the real ${top.symbol}. On CoinMarketCap, ${top.symbol} is ${top.name} (rank #${top.rank}) and ${where}. This contract only copies the name.`);
      } else add("caution", "identity", "Not listed on CoinMarketCap, so there is no independent record of who is behind it (common for new launches).");
    }
  } else {
    const real = symbol ? KNOWN[symbol.trim().toUpperCase()] : undefined;
    if (real && getAddress(real) !== token) add("avoid", "copycat", `This is not the real ${symbol}. It copies the name of ${symbol} (real contract ${real}) at a different address.`);
  }

  // BNB price from the deepest pool on BNB Chain.
  const bnbOut = await client.readContract({ address: ADDR.pancakeRouterV2, abi: routerAbi, functionName: "getAmountsOut", args: [parseEther("1"), [ADDR.WBNB, ADDR.USDT]] });
  const bnbPriceUsd = Number(formatUnits(bnbOut[1], 18));

  // Owner and owner powers.
  const owner = (await safe(client.readContract({ address: token, abi: erc20, functionName: "owner" }))) ?? (await safe(client.readContract({ address: token, abi: erc20, functionName: "getOwner" })));
  const renounced = !owner || owner === ADDR.zero || getAddress(owner) === ADDR.dead;
  const isProxy = !!implSlot && BigInt(implSlot) !== 0n;
  let implCode = code;
  if (isProxy) implCode = (await client.getCode({ address: getAddress(("0x" + implSlot!.slice(26)) as Hex) })) ?? code;
  const sels = selectorsIn(implCode);
  const powers = Object.entries(POWERS).filter(([, sigs]) => sigs.some((s) => sels.has(toFunctionSelector(s)))).map(([p]) => p);
  const ownerIsContract = !renounced && !!(await safe(client.getCode({ address: owner! })))?.slice(2).length;
  const ownerWho = ownerIsContract ? `owner contract ${owner}` : `owner wallet ${owner}`;
  // Owner findings are added after the pool is known, because a deep, established pool changes how much they matter.
  const ownerFindings = (established: boolean) => {
    if (isProxy) add(renounced || established ? "caution" : "avoid", "upgradeable", `The contract is upgradeable${renounced ? "" : ` by its ${ownerWho}`}, so its code can be replaced after you buy.`);
    if (!renounced && powers.length) add(established && ownerIsContract ? "ok" : "caution", "owner_powers", `The ${ownerWho} can ${powers.join(", ")}.${established && ownerIsContract ? " Normal for a large, established token run by a contract." : ""}`);
    else if (!renounced) add(established ? "ok" : "caution", "owner", `The contract has an ${ownerWho}; no risky owner functions were found in its code.`);
    else add("ok", "owner", "Ownership is renounced: no one can change the contract's rules.");
  };

  // Deepest PancakeSwap v2 pool against BNB or a stablecoin.
  const pairs = await Promise.all(QUOTES.map((q) => client.readContract({ address: ADDR.pancakeFactoryV2, abi: factoryAbi, functionName: "getPair", args: [token, q] })));
  let best: { pool: Address; quote: Address; liquidityUsd: number } | null = null;
  for (let i = 0; i < pairs.length; i++) {
    const pool = pairs[i];
    if (pool === ADDR.zero) continue;
    const quote = QUOTES[i];
    const [[r0, r1], t0] = await Promise.all([
      client.readContract({ address: pool, abi: pairAbi, functionName: "getReserves" }),
      client.readContract({ address: pool, abi: pairAbi, functionName: "token0" }),
    ]);
    const quoteReserve = Number(formatUnits(getAddress(t0) === quote ? r0 : r1, 18));
    const liquidityUsd = 2 * quoteReserve * (STABLES.includes(quote) ? 1 : bnbPriceUsd);
    if (!best || liquidityUsd > best.liquidityUsd) best = { pool, quote, liquidityUsd };
  }

  const numbers: CheckResult["numbers"] = { bnbPriceUsd, liquidityUsd: null, pool: null, poolQuote: null, buyTaxPct: null, sellTaxPct: null, priceImpactPct: null, lpBurnedPct: null, owner: owner ?? null, isProxy, poolPriceUsd: null, cmc: listing, atlas: null };

  const established = !!best && best.liquidityUsd >= ESTABLISHED_USD;
  ownerFindings(established);

  const lower = token.toLowerCase();
  const launchpad = lower.endsWith("4444") ? "Four.meme" : lower.endsWith("7777") ? "Flap" : null;
  const onCurve = launchpad ? ` Its address ends in ${lower.slice(-4)}, the pattern ${launchpad} tokens use, so it is probably still on the ${launchpad} bonding curve and has not graduated to PancakeSwap.` : "";
  if (!best) {
    add("avoid", "liquidity", `No PancakeSwap pool against BNB, USDT or FDUSD was found, so an agent cannot buy or sell it on a DEX.${onCurve}`);
    return finish();
  }
  if (best.liquidityUsd < 1) {
    numbers.pool = best.pool;
    numbers.liquidityUsd = 0;
    add("avoid", "liquidity", `Its PancakeSwap pool exists but is empty, so there is nothing to trade against yet.${onCurve}`);
    return finish();
  }
  const quoteName = best.quote === ADDR.WBNB ? "BNB" : best.quote === ADDR.USDT ? "USDT" : "FDUSD";
  numbers.liquidityUsd = Math.round(best.liquidityUsd);
  numbers.pool = best.pool;
  numbers.poolQuote = quoteName;
  if (best.liquidityUsd < 5_000) add("avoid", "liquidity", `Only ${usd(best.liquidityUsd)} of liquidity in its PancakeSwap pool; the price can be moved or drained easily.`);
  else if (best.liquidityUsd < 50_000) add("caution", "liquidity", `${usd(best.liquidityUsd)} of liquidity in its PancakeSwap pool: thin.`);
  else add("ok", "liquidity", `${usd(best.liquidityUsd)} of liquidity in its PancakeSwap ${quoteName} pool.`);

  // Is the pool's liquidity burned (cannot be pulled)?
  const [lpSupply, lpDead, lpZero] = await Promise.all([
    client.readContract({ address: best.pool, abi: pairAbi, functionName: "totalSupply" }),
    client.readContract({ address: best.pool, abi: pairAbi, functionName: "balanceOf", args: [ADDR.dead] }),
    client.readContract({ address: best.pool, abi: pairAbi, functionName: "balanceOf", args: [ADDR.zero] }),
  ]);
  const burned = lpSupply > 0n ? Number(((lpDead + lpZero) * 10000n) / lpSupply) / 10000 : 0;
  numbers.lpBurnedPct = pct(burned);
  if (established) add("ok", "lp_burned", `Liquidity is spread across many providers (${pct(burned)}% burned), as usual for an established token.`);
  else if (burned >= 0.9) add("ok", "lp_burned", `${pct(burned)}% of the pool's liquidity tokens are burned, so that liquidity cannot be pulled.`);
  else add("caution", "lp_burned", `Only ${pct(burned)}% of the pool's liquidity tokens are burned; the rest could be withdrawn (it may be locked elsewhere, which this check does not see).`);

  // Buy and sell the order size inside eth_call: real PancakeSwap code, real state, nothing spent.
  const path: Address[] = best.quote === ADDR.WBNB ? [ADDR.WBNB, token] : [ADDR.WBNB, best.quote, token];
  const value = parseEther((orderUsd / bnbPriceUsd).toFixed(18));
  const tiny = value / 1000n;
  const [outOrder, outTiny] = await Promise.all([
    safe(client.readContract({ address: ADDR.pancakeRouterV2, abi: routerAbi, functionName: "getAmountsOut", args: [value, path] })),
    safe(client.readContract({ address: ADDR.pancakeRouterV2, abi: routerAbi, functionName: "getAmountsOut", args: [tiny, path] })),
  ]);
  if (outOrder && outTiny && outTiny.at(-1)! > 0n) {
    const impact = 1 - Number((outOrder.at(-1)! * 1_000_000n) / (outTiny.at(-1)! * 1000n)) / 1_000_000;
    numbers.priceImpactPct = pct(Math.max(0, impact));
    if (impact > 0.1) add("avoid", "price_impact", `A ${usd(orderUsd)} buy would move the price ${pct(impact)}%. Size down a lot or skip.`);
    else if (impact > 0.02) add("caution", "price_impact", `A ${usd(orderUsd)} buy would move the price ${pct(impact)}%. Consider a smaller order.`);
    else add("ok", "price_impact", `A ${usd(orderUsd)} buy moves the price ${pct(impact)}%.`);

    // Pool price vs CoinMarketCap's market price: a big gap means the pool is thin, stale or being pushed.
    const tokens = Number(formatUnits(outTiny.at(-1)!, decimals));
    const poolPrice = (Number(formatUnits(tiny, 18)) * bnbPriceUsd) / tokens;
    numbers.poolPriceUsd = poolPrice;
    if (listing?.priceUsd) {
      const gap = Math.abs(poolPrice - listing.priceUsd) / listing.priceUsd;
      const text = `PancakeSwap price ${fmtPrice(poolPrice)} vs CoinMarketCap ${fmtPrice(listing.priceUsd)}: ${pct(gap)}% apart.`;
      add(gap > 0.1 ? "avoid" : gap > 0.03 ? "caution" : "ok", "market_price", text);
    }

    // Pool price vs the Atlas Oracle reference price (signed). For tokenized stocks and wrapped assets this is the
    // question that matters: does the token trade at the price of the thing it claims to represent?
    const feed = atlasFeedFor(symbol);
    if (feed && atlasEnabled()) {
      const a = (await safe(atlasPrices([feed.feedId])))?.[0];
      if (a && a.price > 0) {
        numbers.atlas = { feedId: feed.feedId, label: feed.label, priceUsd: a.price, timestamp: a.timestamp, signature: a.signature };
        const gap = Math.abs(poolPrice - a.price) / a.price;
        const text = `PancakeSwap price ${fmtPrice(poolPrice)} vs Atlas Oracle ${feed.label} ${fmtPrice(a.price)}: ${pct(gap)}% apart.`;
        add(gap > 0.1 ? "avoid" : gap > 0.03 ? "caution" : "ok", "oracle_price", gap > 0.1 ? `${text} It does not trade like the asset it represents.` : text);
      }
    }
  }

  const sim = await safe(
    client.call({
      account: SIM_FROM,
      to: SIM_ADDR,
      value,
      data: encodeFunctionData({ abi: simulatorAbi, functionName: "simulate", args: [ADDR.pancakeRouterV2, path] }),
      stateOverride: [
        { address: SIM_ADDR, code: simulatorCode },
        { address: SIM_FROM, balance: value * 2n + parseEther("1") },
      ],
      gas: 8_000_000n,
    }),
  );
  if (!sim?.data) {
    add("caution", "honeypot", "The buy-and-sell test could not run on the RPC node, so selling was not confirmed.");
  } else {
    const r = decodeFunctionResult({ abi: simulatorAbi, functionName: "simulate", data: sim.data });
    const tax = (exp: bigint, got: bigint) => (exp > 0n ? Math.max(0, 1 - Number((got * 1_000_000n) / exp) / 1_000_000) : 0);
    if (r.status === 2) add("avoid", "honeypot", "Buying failed in the test: the token blocks or breaks purchases.");
    else if (r.status === 3 || r.status === 4) add("avoid", "honeypot", "Selling failed right after buying: this behaves like a honeypot (you can buy but not sell).");
    else if (r.status === 1) add("caution", "honeypot", "PancakeSwap could not quote this trade, so selling was not confirmed.");
    else {
      const buyTax = tax(r.buyExpected, r.buyReceived);
      const sellTax = tax(r.sellExpected, r.sellReceived);
      numbers.buyTaxPct = pct(buyTax);
      numbers.sellTaxPct = pct(sellTax);
      const worst = Math.max(buyTax, sellTax);
      const text = `Buy and sell both work. Buy tax ${pct(buyTax)}%, sell tax ${pct(sellTax)}%.`;
      add(worst >= 0.2 ? "avoid" : worst >= 0.05 ? "caution" : "ok", "honeypot", text);
    }
  }
  return finish();

  function finish(): CheckResult {
    const verdict: Verdict = findings.some((f) => f.level === "avoid") ? "avoid" : findings.some((f) => f.level === "caution") ? "caution" : "proceed";
    const order: Record<Level, number> = { avoid: 0, caution: 1, ok: 2 };
    findings.sort((a, b) => order[a.level] - order[b.level]);
    return { chain: "bsc", token, name: name ?? null, symbol: symbol ?? null, orderUsd, verdict, findings, numbers, checkedAt: new Date().toISOString(), block: block.toString() };
  }
}
