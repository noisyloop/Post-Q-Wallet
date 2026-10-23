import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { base58, hex } from '@scure/base';
import ref from './fixtures/launch-ref.json';
import { compileLegacyMessage, signLegacyMessageMulti, systemTransferIx, createAtaIdempotentIx, associatedTokenAddress, TX_SIZE_LIMIT, type Instruction } from '../src/core/chains/solana';
import { closeAccountIx, computeUnitPriceIx, createTokenInstructions, NATIVE_MINT, syncNativeIx } from '../src/core/launch/token';
import {
  amountsForLiquidity, customizablePoolAddress, encodeSniperTax, initialSqrtPrice, initializeCustomizablePoolIx, liquidityFromAmounts,
  permanentLockPositionIx, sniperTaxAt, tokenBadgeAddress,
} from '../src/core/launch/meteora';
import { buildPoolTx, buildTokenTx, planLaunch, TAX_PRESETS, type LaunchConfig } from '../src/core/launch/plan';

type RefIx = { programId: string; keys: [string, number, number][]; data: string };
const norm = (ix: Instruction): RefIx => ({ programId: ix.programId, keys: ix.keys.map((k) => [k.pubkey, k.isSigner ? 1 : 0, k.isWritable ? 1 : 0]), data: hex.encode(ix.data) });
const pub = (seedHex: string) => base58.encode(ed25519.getPublicKey(hex.decode(seedHex)));

const PAYER = pub(ref.payerSeed);
const MINT = pub(ref.mintSeed);
const POSITION = pub(ref.positionSeed);
const SUPPLY = 1_000_000_000n * 10n ** 6n;
const TAX = { startBps: 7500, endBps: 100, durationSec: 300, periods: 30 };

describe('token creation matches web3.js / spl-token / Metaplex', () => {
  it('builds identical create-account, mint, metadata, ATA, mint-to and revoke instructions', () => {
    const ixs = createTokenInstructions({
      payer: PAYER, mint: MINT, mintRent: 1461600n, decimals: 6, supply: SUPPLY,
      metadata: { name: 'Post Q Doge', symbol: 'PQDOGE', uri: 'https://example.com/pqdoge.json' },
    });
    expect(ixs.map(norm)).toEqual(ref.token);
  });

  it('builds identical compute-price and WSOL close instructions', () => {
    expect(norm(computeUnitPriceIx(50_000n))).toEqual(ref.computePrice);
    expect(norm(closeAccountIx(associatedTokenAddress(PAYER, NATIVE_MINT), PAYER, PAYER))).toEqual(ref.closeWsol);
  });
});

describe('Meteora DAMM v2 pool matches @meteora-ag/cp-amm-sdk', () => {
  const sqrt = BigInt(ref.sdkSqrtPrice);
  const liq = BigInt(ref.sdkLiquidity);

  it('encodes the anti-sniper fee scheduler identically', () => {
    expect(hex.encode(encodeSniperTax(TAX))).toBe(ref.baseFee);
  });

  it('derives the same pool address and token badges', () => {
    expect(customizablePoolAddress(MINT, NATIVE_MINT)).toBe(ref.poolAddress);
    expect(customizablePoolAddress(NATIVE_MINT, MINT)).toBe(ref.poolAddress);
    const init = ref.pool.find((i) => i.programId.startsWith('cpamd') && i.keys.length > 6)!;
    expect(init.keys.slice(-2).map((k) => k[0])).toEqual([tokenBadgeAddress(MINT), tokenBadgeAddress(NATIVE_MINT)]);
  });

  it('builds identical wrap, initialize_customizable_pool and permanent_lock_position instructions', () => {
    const wsol = associatedTokenAddress(PAYER, NATIVE_MINT);
    const mine = [
      createAtaIdempotentIx(PAYER, PAYER, MINT),
      createAtaIdempotentIx(PAYER, PAYER, NATIVE_MINT),
      systemTransferIx(PAYER, wsol, 5_000_000_000n),
      syncNativeIx(wsol),
      initializeCustomizablePoolIx({
        creator: PAYER, positionNftMint: POSITION, mintA: MINT, mintB: NATIVE_MINT,
        payerTokenA: associatedTokenAddress(PAYER, MINT), payerTokenB: wsol,
        liquidity: liq, sqrtPrice: sqrt, tax: TAX, collectFeeMode: 1, activationPoint: 1767225600n,
      }),
      permanentLockPositionIx(MINT, NATIVE_MINT, POSITION, PAYER, liq),
    ];
    expect(mine.map(norm)).toEqual(ref.pool);
  });

  it('computes the same liquidity and a matching initial price', () => {
    expect(liquidityFromAmounts(SUPPLY, 5_000_000_000n, sqrt)).toBe(liq);
    const mineSqrt = initialSqrtPrice(SUPPLY, 5_000_000_000n);
    expect(Number(mineSqrt - sqrt) / Number(sqrt)).toBeLessThan(1e-12);
    const { a, b } = amountsForLiquidity(liquidityFromAmounts(SUPPLY, 5_000_000_000n, mineSqrt), mineSqrt);
    expect(a <= SUPPLY && b <= 5_000_000_000n).toBe(true);
    expect(Number(SUPPLY - a) / Number(SUPPLY)).toBeLessThan(1e-6);
  });

  it('decays the sniper tax from start to end', () => {
    expect(sniperTaxAt(TAX, 0)).toBe(7500);
    expect(Math.round(sniperTaxAt(TAX, 60))).toBe(3164); // 75% * (1 - 0.134)^6
    expect(sniperTaxAt(TAX, 300)).toBeCloseTo(100, -1);
    expect(sniperTaxAt(TAX, 10_000)).toBeGreaterThanOrEqual(100);
    expect(() => encodeSniperTax({ ...TAX, startBps: 9950 })).toThrow();
    expect(() => encodeSniperTax({ ...TAX, endBps: 8000 })).toThrow();
  });
});

const cfg = (over: Partial<LaunchConfig> = {}): LaunchConfig => ({
  name: 'Post Q Doge', symbol: 'PQDOGE', uri: '', supply: 1_000_000_000n, solLiquidity: 5_000_000_000n, creatorPct: 0,
  tax: { ...TAX_PRESETS.standard, endBps: 100 }, openAt: null, ...over,
});

describe('launch planning', () => {
  it('puts 100% of supply in the pool by default with every protection on', () => {
    const p = planLaunch(cfg(), 20_000_000_000n);
    expect(p.errors).toEqual([]);
    expect(p.creatorTokens).toBe(0n);
    expect(p.poolA <= p.poolTokensIn && p.poolB <= 5_000_000_000n).toBe(true);
    expect(p.checks.map((c) => c.label)).toEqual(expect.arrayContaining(['Mint authority revoked', 'No freeze authority', 'Liquidity permanently locked', '100% of supply in the pool']));
    expect(p.startMcapSol).toBeCloseTo(5, 6);
  });

  it('flags creator allocation and immediate open as warnings', () => {
    const p = planLaunch(cfg({ creatorPct: 5 }), 20_000_000_000n);
    expect(p.checks.filter((c) => c.level === 'warn').map((c) => c.label)).toEqual(['95% of supply in the pool', 'Trading opens immediately']);
    expect(p.creatorTokens).toBe(p.rawSupply / 20n);
  });

  it('rejects invalid input', () => {
    const now = 1_800_000_000;
    const errs = (c: Partial<LaunchConfig>, bal = 20_000_000_000n) => planLaunch(cfg(c), bal, now).errors.join(' | ');
    expect(errs({ name: '' })).toMatch(/name/);
    expect(errs({ name: 'x'.repeat(33) })).toMatch(/32 bytes/);
    expect(errs({ symbol: 'BAD TICKER' })).toMatch(/Ticker/);
    expect(errs({ uri: 'http://insecure.example/x.json' })).toMatch(/URI/);
    expect(errs({ creatorPct: 50 })).toMatch(/allocation/);
    expect(errs({ solLiquidity: 1000n })).toMatch(/0\.1 SOL/);
    expect(errs({}, 5_000_000_000n)).toMatch(/Not enough SOL/);
    expect(errs({ openAt: now + 10 })).toMatch(/Opening time/);
    expect(errs({ supply: 10n ** 20n })).toMatch(/Supply/);
  });

  it('fits both launch transactions in a single packet even with maximum-length metadata', () => {
    const p = planLaunch(cfg({ name: 'N'.repeat(32), symbol: 'S'.repeat(10), uri: `https://${'u'.repeat(192)}`, openAt: Math.floor(Date.now() / 1000) + 3600 }), 20_000_000_000n);
    expect(p.errors).toEqual([]);
    const bh = base58.encode(new Uint8Array(32).fill(7));
    const payerKey = ed25519.utils.randomPrivateKey();
    const mintKey = ed25519.utils.randomPrivateKey();
    const posKey = ed25519.utils.randomPrivateKey();
    const payer = base58.encode(ed25519.getPublicKey(payerKey));
    const mint = base58.encode(ed25519.getPublicKey(mintKey));
    const pos = base58.encode(ed25519.getPublicKey(posKey));

    const tx1 = signLegacyMessageMulti(compileLegacyMessage(payer, bh, buildTokenTx(p, payer, mint, 1461600n)), [payerKey, mintKey]);
    const tx2 = signLegacyMessageMulti(compileLegacyMessage(payer, bh, buildPoolTx(p, payer, mint, pos)), [payerKey, posKey]);
    expect(tx1.length).toBeLessThanOrEqual(TX_SIZE_LIMIT);
    expect(tx2.length).toBeLessThanOrEqual(TX_SIZE_LIMIT);
    expect(tx1[0]).toBe(2);
    expect(tx2[0]).toBe(2);
  });
});

describe('multi-signer transactions', () => {
  it('places each signature in account order and verifies', () => {
    const a = ed25519.utils.randomPrivateKey();
    const b = ed25519.utils.randomPrivateKey();
    const pa = base58.encode(ed25519.getPublicKey(a));
    const pb = base58.encode(ed25519.getPublicKey(b));
    const msg = compileLegacyMessage(pa, base58.encode(new Uint8Array(32)), [{
      programId: '11111111111111111111111111111111',
      keys: [{ pubkey: pa, isSigner: true, isWritable: true }, { pubkey: pb, isSigner: true, isWritable: true }],
      data: new Uint8Array([0]),
    }]);
    const tx = signLegacyMessageMulti(msg, [b, a]); // order of keys passed doesn't matter
    expect(tx[0]).toBe(2);
    expect(ed25519.verify(tx.slice(1, 65), msg, ed25519.getPublicKey(a))).toBe(true);
    expect(ed25519.verify(tx.slice(65, 129), msg, ed25519.getPublicKey(b))).toBe(true);
    expect(() => signLegacyMessageMulti(msg, [a])).toThrow(/Missing signer/);
  });
});
