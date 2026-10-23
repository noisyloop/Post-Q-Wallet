/**
 * Fair-launch planner: validates the user's choices, derives pool amounts and
 * builds the two launch transactions.
 *
 * Protections that are always on (not configurable):
 *  - mint authority revoked in the same transaction that mints the supply
 *  - no freeze authority, immutable metadata
 *  - liquidity permanently locked in the same transaction that creates the pool
 *  - anti-sniper tax: a high swap fee at open that decays to the normal fee
 */
import { associatedTokenAddress, createAtaIdempotentIx, systemTransferIx, type Instruction } from '../chains/solana';
import {
  amountsForLiquidity, CollectFeeMode, customizablePoolAddress, initialSqrtPrice, initializeCustomizablePoolIx,
  liquidityFromAmounts, MAX_FEE_BPS, MIN_FEE_BPS, permanentLockPositionIx, sniperTaxAt, type SniperTax,
} from './meteora';
import { closeAccountIx, computeUnitPriceIx, createTokenInstructions, NATIVE_MINT, syncNativeIx } from './token';

export const DECIMALS = 6;
export const MAX_SUPPLY = 10_000_000_000_000n; // keeps raw supply below u64::MAX
export const MIN_LIQUIDITY_LAMPORTS = 100_000_000n; // 0.1 SOL
/** Rent for mint, metadata, token accounts, pool, position + network fees (upper estimate). */
export const LAUNCH_COST_LAMPORTS = 80_000_000n;
export const MAX_CREATOR_PCT = 10;

export const TAX_PRESETS: Record<'light' | 'standard' | 'max', Omit<SniperTax, 'endBps'> & { label: string }> = {
  light: { label: 'Light', startBps: 5000, durationSec: 120, periods: 12 },
  standard: { label: 'Standard', startBps: 7500, durationSec: 300, periods: 30 },
  max: { label: 'Maximum', startBps: 9000, durationSec: 600, periods: 60 },
};
export const END_FEE_OPTIONS = [25, 100, 200];
export const OPEN_DELAYS = [0, 300, 900, 3600];

export interface LaunchConfig {
  name: string;
  symbol: string;
  uri: string;
  /** Whole tokens. */
  supply: bigint;
  /** Lamports of SOL paired into the pool. */
  solLiquidity: bigint;
  /** % of supply the creator keeps outside the pool (0 = everything in the pool). */
  creatorPct: number;
  tax: SniperTax;
  /** Unix seconds when trading opens, or null for immediately. */
  openAt: number | null;
}

export interface LaunchCheck { label: string; detail: string; level: 'ok' | 'warn' }

export interface LaunchPlan {
  config: LaunchConfig;
  rawSupply: bigint;
  poolTokensIn: bigint;
  creatorTokens: bigint;
  sqrtPrice: bigint;
  liquidity: bigint;
  /** Exact amounts the pool program will pull. */
  poolA: bigint;
  poolB: bigint;
  /** SOL per whole token at open. */
  startPriceSol: number;
  startMcapSol: number;
  errors: string[];
  checks: LaunchCheck[];
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

export const fmtBps = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? (bps % 10 ? 2 : 1) : 0)}%`;
/** Round to 0.1% for display. */
export const roundBps = (bps: number) => Math.round(bps / 10) * 10;
export const fmtSecs = (s: number) => (s >= 60 ? `${Math.round(s / 60)} min` : `${s}s`);

export const validateMetadata = (c: Pick<LaunchConfig, 'name' | 'symbol' | 'uri'>): string[] => {
  const e: string[] = [];
  if (!c.name.trim()) e.push('Enter a token name');
  else if (bytes(c.name) > 32) e.push('Name must be at most 32 bytes');
  if (!c.symbol.trim()) e.push('Enter a ticker');
  else if (!/^[A-Za-z0-9$_-]{1,10}$/.test(c.symbol)) e.push('Ticker: 1–10 letters, digits, $ _ or -');
  if (c.uri && (!/^(https:\/\/|ipfs:\/\/|ar:\/\/)\S+$/.test(c.uri) || bytes(c.uri) > 200)) e.push('Metadata URI must be https://, ipfs:// or ar:// (max 200 bytes)');
  return e;
};

export const planLaunch = (cfg: LaunchConfig, solBalance: bigint, nowSec = Math.floor(Date.now() / 1000)): LaunchPlan => {
  const errors = validateMetadata(cfg);
  if (cfg.supply < 1000n || cfg.supply > MAX_SUPPLY) errors.push('Supply must be between 1,000 and 10 trillion');
  if (!Number.isInteger(cfg.creatorPct) || cfg.creatorPct < 0 || cfg.creatorPct > MAX_CREATOR_PCT) errors.push(`Creator allocation must be 0–${MAX_CREATOR_PCT}%`);
  if (cfg.solLiquidity < MIN_LIQUIDITY_LAMPORTS) errors.push('Add at least 0.1 SOL of liquidity');
  if (cfg.solLiquidity + LAUNCH_COST_LAMPORTS > solBalance) errors.push('Not enough SOL for liquidity + ~0.08 SOL launch costs');
  const t = cfg.tax;
  if (t.endBps < MIN_FEE_BPS || t.startBps > MAX_FEE_BPS || t.endBps > t.startBps) errors.push('Invalid sniper tax range');
  if (cfg.openAt !== null && (cfg.openAt < nowSec + 60 || cfg.openAt > nowSec + 7 * 86400)) errors.push('Opening time must be 1 minute to 7 days from now');

  const rawSupply = (cfg.supply > 0n && cfg.supply <= MAX_SUPPLY ? cfg.supply : 1n) * 10n ** BigInt(DECIMALS);
  const creatorTokens = (rawSupply * BigInt(Math.max(0, Math.min(MAX_CREATOR_PCT, Math.trunc(cfg.creatorPct) || 0)))) / 100n;
  const poolTokensIn = rawSupply - creatorTokens;
  const solIn = cfg.solLiquidity > 0n ? cfg.solLiquidity : 1n;

  let sqrtPrice = 0n, liquidity = 0n, poolA = 0n, poolB = 0n;
  try {
    sqrtPrice = initialSqrtPrice(poolTokensIn, solIn);
    liquidity = liquidityFromAmounts(poolTokensIn, solIn, sqrtPrice);
    ({ a: poolA, b: poolB } = amountsForLiquidity(liquidity, sqrtPrice));
    if (poolA > poolTokensIn || poolB > solIn) errors.push('Internal rounding error — adjust amounts');
  } catch (e) {
    errors.push((e as Error).message);
  }

  const startPriceSol = Number(solIn) / 1e9 / (Number(poolTokensIn) / 10 ** DECIMALS);
  const startMcapSol = startPriceSol * Number(cfg.supply);
  const pctInPool = 100 - cfg.creatorPct;

  const checks: LaunchCheck[] = [
    { label: 'Mint authority revoked', detail: 'Supply is fixed forever — nobody can mint more', level: 'ok' },
    { label: 'No freeze authority', detail: "Holders' tokens can never be frozen", level: 'ok' },
    { label: 'Metadata immutable', detail: 'Name, ticker and image link cannot be changed later', level: 'ok' },
    cfg.creatorPct === 0
      ? { label: '100% of supply in the pool', detail: 'No hidden team or insider allocation', level: 'ok' }
      : { label: `${pctInPool}% of supply in the pool`, detail: `You keep ${cfg.creatorPct}% — visible on-chain to every buyer`, level: 'warn' },
    { label: 'Liquidity permanently locked', detail: 'LP can never be withdrawn (no rug pull); you can still claim trading fees', level: 'ok' },
    {
      label: `Sniper tax ${fmtBps(t.startBps)} → ${fmtBps(t.endBps)}`,
      detail: `Decays over ${fmtSecs(t.durationSec)}; a first-second buy pays ${fmtBps(roundBps(sniperTaxAt(t, 0)))}, after 1 min ${fmtBps(roundBps(sniperTaxAt(t, 60)))}`,
      level: 'ok',
    },
    cfg.openAt === null
      ? { label: 'Trading opens immediately', detail: 'Consider a delayed open so buyers can verify the token first', level: 'warn' }
      : { label: `Trading opens at ${new Date(cfg.openAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, detail: 'Pool and lock are verifiable on-chain before anyone can buy', level: 'ok' },
  ];

  return { config: cfg, rawSupply, poolTokensIn, creatorTokens, sqrtPrice, liquidity, poolA, poolB, startPriceSol, startMcapSol, errors, checks };
};

export const PRIORITY_MICROLAMPORTS = 50_000n;

/** Transaction 1. */
export const buildTokenTx = (plan: LaunchPlan, payer: string, mint: string, mintRent: bigint): Instruction[] =>
  createTokenInstructions({
    payer, mint, mintRent, decimals: DECIMALS, supply: plan.rawSupply,
    metadata: { name: plan.config.name.trim(), symbol: plan.config.symbol.trim(), uri: plan.config.uri.trim() },
    priorityMicroLamports: PRIORITY_MICROLAMPORTS,
  });

/** Transaction 2: wrap SOL, create pool with sniper tax, permanently lock LP, unwrap leftovers. */
export const buildPoolTx = (plan: LaunchPlan, payer: string, mint: string, positionNftMint: string): Instruction[] => {
  const wsol = associatedTokenAddress(payer, NATIVE_MINT);
  return [
    computeUnitPriceIx(PRIORITY_MICROLAMPORTS),
    createAtaIdempotentIx(payer, payer, NATIVE_MINT),
    systemTransferIx(payer, wsol, plan.poolB),
    syncNativeIx(wsol),
    initializeCustomizablePoolIx({
      creator: payer, positionNftMint, mintA: mint, mintB: NATIVE_MINT,
      payerTokenA: associatedTokenAddress(payer, mint), payerTokenB: wsol,
      liquidity: plan.liquidity, sqrtPrice: plan.sqrtPrice, tax: plan.config.tax,
      collectFeeMode: CollectFeeMode.OnlyB,
      activationPoint: plan.config.openAt === null ? null : BigInt(plan.config.openAt),
    }),
    permanentLockPositionIx(mint, NATIVE_MINT, positionNftMint, payer, plan.liquidity),
    closeAccountIx(wsol, payer, payer),
  ];
};

export const poolAddressFor = (mint: string) => customizablePoolAddress(mint, NATIVE_MINT);
