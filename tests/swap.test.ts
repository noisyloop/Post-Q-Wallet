import { describe, expect, it } from 'vitest';
import { findToken, getChain, lifiTokenAddress } from '../src/core/chains/registry';
import { hasBlocker, hasWarning, LIFI_DIAMOND, validateQuote } from '../src/core/swap/validate';
import type { QuoteRequest, SwapQuote } from '../src/core/swap/types';
import { createDemoBackend } from '../src/core/backend/demo';

const EVM = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const SOL = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';

const req = (over: Partial<QuoteRequest> = {}): QuoteRequest => ({
  from: findToken('arbitrum:native')!,
  to: findToken('solana:native')!,
  fromAmount: 10n ** 17n,
  fromAddress: EVM,
  toAddress: SOL,
  slippage: 0.005,
  ...over,
});

const quoteFor = (r: QuoteRequest, over: Partial<SwapQuote> = {}): SwapQuote => ({
  id: 'q', from: r.from, to: r.to, fromAmount: r.fromAmount, toAmount: 1_000_000_000n, toAmountMin: 995_000_000n,
  fromAddress: r.fromAddress, toAddress: r.toAddress, toolName: 'Mayan', route: ['Mayan'], durationSec: 40,
  feeUsd: 0.3, gasUsd: 0.05, fromUsd: 384, toUsd: 383, slippage: r.slippage, approvalAddress: undefined,
  tx: { kind: 'evm', chainId: getChain(r.from.chainId).evmChainId!, to: LIFI_DIAMOND, data: '0x', value: r.fromAmount },
  echo: {
    fromChainId: getChain(r.from.chainId).lifiId, toChainId: getChain(r.to.chainId).lifiId,
    fromToken: lifiTokenAddress(r.from), toToken: lifiTokenAddress(r.to), fromAmount: r.fromAmount.toString(),
    fromAddress: r.fromAddress, toAddress: r.toAddress,
  },
  fetchedAt: Date.now(),
  ...over,
});

const failing = (q: SwapQuote, r: QuoteRequest) => validateQuote(q, r).filter((c) => c.level === 'block').map((c) => c.label);

describe('swap quote validation', () => {
  it('accepts a well-formed quote', () => {
    const r = req();
    const c = validateQuote(quoteFor(r), r);
    expect(hasBlocker(c)).toBe(false);
    expect(hasWarning(c)).toBe(false);
  });

  it('blocks an unknown router contract', () => {
    const r = req();
    const q = quoteFor(r);
    q.tx = { ...(q.tx as Extract<SwapQuote['tx'], { kind: 'evm' }>), to: '0x000000000000000000000000000000000000dEaD' };
    expect(failing(q, r)).toContain('Contract is the verified LI.FI router');
  });

  it('blocks a quote that delivers to someone else', () => {
    const r = req();
    const q = quoteFor(r, { echo: { ...quoteFor(r).echo, toAddress: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM' } });
    expect(failing(q, r)).toContain('Funds are delivered to your wallet');
  });

  it('blocks a wrong chain id or changed amount', () => {
    const r = req();
    const q = quoteFor(r);
    q.tx = { ...(q.tx as Extract<SwapQuote['tx'], { kind: 'evm' }>), chainId: 1 };
    expect(failing(q, r)).toContain('Correct network');
    const q2 = quoteFor(r, { echo: { ...quoteFor(r).echo, fromAmount: '1' } });
    expect(failing(q2, r)).toContain('Route matches your request');
  });

  it('blocks an unknown approval spender for ERC-20 swaps', () => {
    const r = req({ from: findToken('arbitrum:0xaf88d065e77c8cC2239327C5EDb3A432268e5831')! });
    const q = quoteFor(r, { approvalAddress: '0x000000000000000000000000000000000000bEEF' });
    q.tx = { ...(q.tx as Extract<SwapQuote['tx'], { kind: 'evm' }>), value: 0n };
    expect(failing(q, r)).toContain('Exact-amount approval only');
  });

  it('blocks an excessive slippage floor and expired quotes', () => {
    const r = req();
    expect(failing(quoteFor(r, { toAmountMin: 900_000_000n }), r)).toContain('Minimum received within slippage');
    expect(failing(quoteFor(r, { fetchedAt: Date.now() - 120_000 }), r)).toContain('Quote is fresh');
  });

  it('warns on moderate and blocks on severe price impact', () => {
    const r = req();
    expect(hasWarning(validateQuote(quoteFor(r, { toUsd: 360 }), r))).toBe(true);
    expect(failing(quoteFor(r, { toUsd: 200 }), r)).toContain('Price impact acceptable');
  });

  it('demo backend quotes pass every safety check', async () => {
    const b = createDemoBackend();
    const cases: [string, string, bigint][] = [
      ['ethereum:native', 'solana:native', 10n ** 17n],
      ['solana:native', 'base:native', 10n ** 9n],
      ['bitcoin:native', 'ethereum:native', 10n ** 6n],
      ['base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'arbitrum:native', 250n * 10n ** 6n],
    ];
    for (const [f, t, fromAmount] of cases) {
      const from = findToken(f)!;
      const to = findToken(t)!;
      const accts = { evm: EVM, solana: SOL, bitcoin: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu' };
      const r: QuoteRequest = { from, to, fromAmount, slippage: 0.005, fromAddress: accts[getChain(from.chainId).family], toAddress: accts[getChain(to.chainId).family] };
      const q = await b.quote(r);
      expect(validateQuote(q, r).filter((c) => c.level !== 'ok')).toEqual([]);
    }
  });
});
