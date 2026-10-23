/**
 * Meteora DAMM v2 (cp-amm) — customizable constant-product pool with a
 * time-based fee scheduler, used as an anti-sniper tax.
 *
 * Instruction layouts are checked byte-for-byte against
 * @meteora-ag/cp-amm-sdk in tests/launch.test.ts.
 */
import { base58 } from '@scure/base';
import { concat, findProgramAddress, SYSTEM_PROGRAM, TOKEN_PROGRAM, u64le, type Instruction } from '../chains/solana';

export const CP_AMM_PROGRAM = 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG';
export const POOL_AUTHORITY = 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export const MIN_SQRT_PRICE = 4295048016n;
export const MAX_SQRT_PRICE = 79226673521066979257578248091n;
export const FEE_DENOMINATOR = 1_000_000_000n;
export const MIN_FEE_BPS = 1; // 0.01%
export const MAX_FEE_BPS = 9900; // 99% (pool version 1)
const BASIS_POINT_MAX = 10_000;

export const ActivationType = { Slot: 0, Timestamp: 1 } as const;
export const CollectFeeMode = { BothToken: 0, OnlyB: 1 } as const;
export const FeeSchedulerMode = { Linear: 0, Exponential: 1 } as const;

const DISC_INIT_CUSTOMIZABLE_POOL = [20, 161, 241, 24, 189, 221, 180, 2];
const DISC_PERMANENT_LOCK_POSITION = [165, 176, 125, 6, 231, 171, 186, 213];

const enc = new TextEncoder();
const pda = (seeds: (string | Uint8Array)[]) =>
  findProgramAddress(seeds.map((s) => (typeof s === 'string' ? enc.encode(s) : s)), CP_AMM_PROGRAM)[0];
const pk = (a: string) => base58.decode(a);

const cmpBytes = (a: Uint8Array, b: Uint8Array) => {
  for (let i = 0; i < 32; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

export const customizablePoolAddress = (mintA: string, mintB: string): string => {
  const [a, b] = [pk(mintA), pk(mintB)];
  const [hi, lo] = cmpBytes(a, b) > 0 ? [a, b] : [b, a];
  return pda(['cpool', hi, lo]);
};
export const positionAddress = (nftMint: string) => pda(['position', pk(nftMint)]);
export const positionNftAccount = (nftMint: string) => pda(['position_nft_account', pk(nftMint)]);
export const tokenVaultAddress = (mint: string, pool: string) => pda(['token_vault', pk(mint), pk(pool)]);
export const tokenBadgeAddress = (mint: string) => pda(['token_badge', pk(mint)]);
export const eventAuthority = () => pda(['__event_authority']);

const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
export const u128le = (n: bigint): Uint8Array => {
  if (n < 0n || n >= 1n << 128n) throw new Error('u128 out of range');
  const b = new Uint8Array(16);
  let v = n;
  for (let i = 0; i < 16; i++) { b[i] = Number(v & 0xffn); v >>= 8n; }
  return b;
};

// ---------- fee scheduler (anti-sniper tax) ----------

export interface SniperTax {
  /** Fee charged at the moment trading opens, in bps (e.g. 7500 = 75%). */
  startBps: number;
  /** Long-term pool fee once the schedule ends, in bps. */
  endBps: number;
  /** Seconds over which the fee decays from start to end. */
  durationSec: number;
  /** Number of decay steps. */
  periods: number;
}

export const bpsToNumerator = (bps: number): bigint => (BigInt(bps) * FEE_DENOMINATOR) / 10_000n;

/** 27-byte BorshFeeTimeScheduler (exponential decay, seconds-based). */
export const encodeSniperTax = (t: SniperTax): Uint8Array => {
  if (t.endBps < MIN_FEE_BPS || t.startBps > MAX_FEE_BPS || t.endBps > t.startBps) throw new Error('Invalid fee range');
  if (t.startBps === t.endBps) {
    return concat(u64le(bpsToNumerator(t.startBps)), u16le(0), u64le(0n), u64le(0n), [FeeSchedulerMode.Linear]);
  }
  if (t.periods < 1 || t.periods > 65535 || t.durationSec < t.periods) throw new Error('Invalid fee schedule');
  const decayBase = Math.pow(t.endBps / t.startBps, 1 / t.periods);
  const reduction = BigInt(Math.floor(BASIS_POINT_MAX * (1 - decayBase)));
  return concat(
    u64le(bpsToNumerator(t.startBps)),
    u16le(t.periods),
    u64le(BigInt(Math.floor(t.durationSec / t.periods))),
    u64le(reduction),
    [FeeSchedulerMode.Exponential],
  );
};

/** Fee (bps) a trader pays `elapsedSec` after trading opens. */
export const sniperTaxAt = (t: SniperTax, elapsedSec: number): number => {
  if (t.startBps === t.endBps) return t.startBps;
  const period = Math.min(t.periods, Math.floor(elapsedSec / Math.floor(t.durationSec / t.periods)));
  const decayBase = Math.pow(t.endBps / t.startBps, 1 / t.periods);
  const reduction = Math.floor(BASIS_POINT_MAX * (1 - decayBase)) / BASIS_POINT_MAX;
  return Math.max(t.endBps, t.startBps * Math.pow(1 - reduction, period));
};

// ---------- liquidity math (full-range constant product) ----------

const isqrt = (n: bigint): bigint => {
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) {
      while (x * x > n) x--;
      while ((x + 1n) * (x + 1n) <= n) x++;
      return x;
    }
    x = y;
  }
};

/** Initial sqrt(price) in Q64.64 where price = tokenB per tokenA (raw units). */
export const initialSqrtPrice = (amountA: bigint, amountB: bigint): bigint => {
  if (amountA <= 0n || amountB <= 0n) throw new Error('Amounts must be positive');
  const s = isqrt((amountB << 128n) / amountA);
  if (s <= MIN_SQRT_PRICE || s >= MAX_SQRT_PRICE) throw new Error('Price out of range');
  return s;
};

export const liquidityFromAmounts = (amountA: bigint, amountB: bigint, sqrtPrice: bigint): bigint => {
  const fromA = (amountA * sqrtPrice * MAX_SQRT_PRICE) / (MAX_SQRT_PRICE - sqrtPrice);
  const fromB = (amountB << 128n) / (sqrtPrice - MIN_SQRT_PRICE);
  return fromA < fromB ? fromA : fromB;
};

/** Token amounts the program will pull for `liquidity` (rounded up, as on-chain). */
export const amountsForLiquidity = (liquidity: bigint, sqrtPrice: bigint): { a: bigint; b: bigint } => {
  const numA = liquidity * (MAX_SQRT_PRICE - sqrtPrice);
  const denA = sqrtPrice * MAX_SQRT_PRICE;
  const a = (numA + denA - 1n) / denA;
  const prodB = liquidity * (sqrtPrice - MIN_SQRT_PRICE);
  const one = 1n << 128n;
  const b = (prodB + one - 1n) / one;
  return { a, b };
};

// ---------- instructions ----------

export interface CustomPoolArgs {
  creator: string;
  positionNftMint: string;
  mintA: string;
  mintB: string;
  payerTokenA: string;
  payerTokenB: string;
  liquidity: bigint;
  sqrtPrice: bigint;
  tax: SniperTax;
  collectFeeMode: number;
  /** Unix timestamp when swaps open; null = immediately. */
  activationPoint: bigint | null;
}

export const initializeCustomizablePoolIx = (a: CustomPoolArgs): Instruction => {
  const pool = customizablePoolAddress(a.mintA, a.mintB);
  const ro = (pubkey: string) => ({ pubkey, isSigner: false, isWritable: false });
  const w = (pubkey: string) => ({ pubkey, isSigner: false, isWritable: true });
  return {
    programId: CP_AMM_PROGRAM,
    keys: [
      ro(a.creator),
      { pubkey: a.positionNftMint, isSigner: true, isWritable: true },
      w(positionNftAccount(a.positionNftMint)),
      { pubkey: a.creator, isSigner: true, isWritable: true }, // payer
      ro(POOL_AUTHORITY),
      w(pool),
      w(positionAddress(a.positionNftMint)),
      ro(a.mintA),
      ro(a.mintB),
      w(tokenVaultAddress(a.mintA, pool)),
      w(tokenVaultAddress(a.mintB, pool)),
      w(a.payerTokenA),
      w(a.payerTokenB),
      ro(TOKEN_PROGRAM),
      ro(TOKEN_PROGRAM),
      ro(TOKEN_2022_PROGRAM),
      ro(SYSTEM_PROGRAM),
      ro(eventAuthority()),
      ro(CP_AMM_PROGRAM),
      // remaining accounts: token badges (absent for standard SPL mints)
      ro(tokenBadgeAddress(a.mintA)),
      ro(tokenBadgeAddress(a.mintB)),
    ],
    data: concat(
      DISC_INIT_CUSTOMIZABLE_POOL,
      encodeSniperTax(a.tax),
      u16le(0), // compounding_fee_bps
      [0], // padding
      [0], // dynamic_fee = None
      u128le(MIN_SQRT_PRICE),
      u128le(MAX_SQRT_PRICE),
      [0], // has_alpha_vault
      u128le(a.liquidity),
      u128le(a.sqrtPrice),
      [ActivationType.Timestamp],
      [a.collectFeeMode],
      a.activationPoint === null ? [0] : concat([1], u64le(a.activationPoint)),
    ),
  };
};

/** Permanently locks liquidity: it can never be withdrawn, only fees claimed. */
export const permanentLockPositionIx = (mintA: string, mintB: string, positionNftMint: string, owner: string, liquidity: bigint): Instruction => ({
  programId: CP_AMM_PROGRAM,
  keys: [
    { pubkey: customizablePoolAddress(mintA, mintB), isSigner: false, isWritable: true },
    { pubkey: positionAddress(positionNftMint), isSigner: false, isWritable: true },
    { pubkey: positionNftAccount(positionNftMint), isSigner: false, isWritable: false },
    { pubkey: owner, isSigner: true, isWritable: false },
    { pubkey: eventAuthority(), isSigner: false, isWritable: false },
    { pubkey: CP_AMM_PROGRAM, isSigner: false, isWritable: false },
  ],
  data: concat(DISC_PERMANENT_LOCK_POSITION, u128le(liquidity)),
});
