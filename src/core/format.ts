import { formatUnits, parseUnits } from 'viem';
import { getChain, type Token } from './chains/registry';

export const fmtUsd = (n: number, opts: { compact?: boolean } = {}): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    notation: opts.compact && Math.abs(n) >= 100_000 ? 'compact' : 'standard',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);

export const fmtPct = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

export const fmtAmount = (v: bigint, decimals: number, maxFrac = 6): string => {
  const s = formatUnits(v, decimals);
  const [i, f = ''] = s.split('.');
  const frac = f.slice(0, maxFrac).replace(/0+$/, '');
  const int = Number(i).toLocaleString('en-US');
  return frac ? `${int}.${frac}` : int;
};

export const toNumber = (v: bigint, decimals: number): number => Number(formatUnits(v, decimals));

/** Parse user-entered decimal text; returns null for invalid / too-precise input. */
export const parseAmount = (text: string, decimals: number): bigint | null => {
  const t = text.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return null;
  const [, f = ''] = t.split('.');
  if (f.length > decimals) return null;
  try {
    return parseUnits(t, decimals);
  } catch {
    return null;
  }
};

export const fmtDuration = (s: number): string => (s < 60 ? `~${Math.max(1, Math.round(s))}s` : `~${Math.round(s / 60)} min`);

/** Balance minus a reserve for network fees when sending a chain's native asset. */
export const maxSendable = (t: Token, balance: bigint): bigint => {
  if (t.address) return balance;
  const fam = getChain(t.chainId).family;
  const reserve = fam === 'evm' ? (t.chainId === 'ethereum' ? 2n * 10n ** 15n : 2n * 10n ** 14n) : fam === 'solana' ? 5_000_000n : 3_000n;
  return balance > reserve ? balance - reserve : 0n;
};
