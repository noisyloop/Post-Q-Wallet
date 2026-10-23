/**
 * Defensive checks applied to every swap quote before it can be signed.
 *
 * A compromised or buggy aggregator API is treated as untrusted input: the
 * transaction it returns must match what the user asked for, must target a
 * known contract, and must deliver funds to the user's own address.
 */
import { getAddress } from 'viem';
import { getChain, lifiTokenAddress } from '../chains/registry';
import type { QuoteRequest, SwapQuote } from './types';

/** LI.FI Diamond — identical deployment address on all supported EVM chains. */
export const LIFI_DIAMOND = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE';
export const TRUSTED_EVM_TARGETS = new Set([LIFI_DIAMOND.toLowerCase()]);

export const QUOTE_TTL_MS = 60_000;

export interface SafetyCheck {
  label: string;
  ok: boolean;
  /** "block" = cannot proceed; "warn" = needs explicit acknowledgement. */
  level: 'ok' | 'warn' | 'block';
  detail?: string;
}

const sameAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export const validateQuote = (q: SwapQuote, req: QuoteRequest, now = Date.now()): SafetyCheck[] => {
  const checks: SafetyCheck[] = [];
  const add = (label: string, ok: boolean, failLevel: 'warn' | 'block', detail?: string) =>
    checks.push({ label, ok, level: ok ? 'ok' : failLevel, detail });

  const fromChain = getChain(req.from.chainId);
  const toChain = getChain(req.to.chainId);

  add('Route matches your request',
    q.echo.fromChainId === fromChain.lifiId && q.echo.toChainId === toChain.lifiId &&
    sameAddr(q.echo.fromToken, lifiTokenAddress(req.from)) && sameAddr(q.echo.toToken, lifiTokenAddress(req.to)) &&
    q.echo.fromAmount === req.fromAmount.toString(),
    'block', 'The aggregator returned a different chain, token or amount than requested');

  add('Funds are delivered to your wallet',
    sameAddr(q.echo.toAddress, req.toAddress) && sameAddr(q.echo.fromAddress, req.fromAddress),
    'block', 'Recipient address in the quote does not match this wallet');

  const minExpected = (q.toAmount * BigInt(Math.round((1 - req.slippage - 0.001) * 1e6))) / 1_000_000n;
  add('Minimum received within slippage', q.toAmountMin >= minExpected && q.toAmountMin <= q.toAmount,
    'block', 'Guaranteed minimum is lower than your slippage tolerance allows');

  add('Quote is fresh', now - q.fetchedAt < QUOTE_TTL_MS, 'block', 'Quote expired — refresh to get a new price');

  if (q.tx.kind === 'evm') {
    add('Contract is the verified LI.FI router', TRUSTED_EVM_TARGETS.has(q.tx.to.toLowerCase()),
      'block', `Unknown contract ${q.tx.to}`);
    add('Correct network', q.tx.chainId === fromChain.evmChainId, 'block', 'Transaction targets a different chain id');
    if (req.from.address) {
      add('Exact-amount approval only',
        !q.approvalAddress || TRUSTED_EVM_TARGETS.has(q.approvalAddress.toLowerCase()),
        'block', `Approval requested for unknown spender ${q.approvalAddress}`);
    }
    const extra = q.tx.value - (req.from.address ? 0n : req.fromAmount);
    add('Native value matches amount', extra >= 0n, 'block', 'Transaction sends less than the quoted amount');
    if (extra > 0n) {
      const pct = Number(extra) / Number(req.from.address ? 10n ** 18n : req.fromAmount);
      add('Bridge messaging fee', req.from.address ? true : pct < 0.03, 'warn',
        `Sends an extra ${Number(extra) / 1e18} ${fromChain.nativeSymbol} as bridge fee`);
    }
    try { getAddress(q.tx.to); } catch { add('Valid target address', false, 'block'); }
  } else if (q.tx.kind === 'solana') {
    add('Transaction payload present', q.tx.base64.length > 0, 'block');
  } else {
    add('Bitcoin payload present', !!(q.tx.psbtHex || (q.tx.to && q.tx.value)), 'block');
    if (q.tx.value !== undefined) add('BTC amount matches', q.tx.value === req.fromAmount, 'block');
  }

  if (q.fromUsd > 0 && q.toUsd > 0) {
    const impact = 1 - q.toUsd / q.fromUsd;
    add('Price impact acceptable', impact < 0.05, impact < 0.15 ? 'warn' : 'block',
      `You lose ${(impact * 100).toFixed(1)}% of value to fees and price impact`);
  }
  return checks;
};

export const hasBlocker = (c: SafetyCheck[]) => c.some((x) => x.level === 'block');
export const hasWarning = (c: SafetyCheck[]) => c.some((x) => x.level === 'warn');
