/** Input validation and user-protection heuristics. */
import { getAddress, isAddress } from 'viem';
import { base58 } from '@scure/base';
import { ed25519 } from '@noble/curves/ed25519';
import * as btc from '@scure/btc-signer';
import type { ChainFamily } from './chains/registry';

export interface PasswordCheck {
  ok: boolean;
  score: 0 | 1 | 2 | 3 | 4;
  hint: string;
}

const COMMON = ['password', '123456', 'qwerty', 'letmein', 'bitcoin', 'ethereum', 'wallet', 'crypto', 'iloveyou', 'admin'];

export const checkPassword = (pw: string): PasswordCheck => {
  if (pw.length < 10) return { ok: false, score: 0, hint: 'Use at least 10 characters' };
  const lower = pw.toLowerCase();
  if (COMMON.some((c) => lower.includes(c))) return { ok: false, score: 1, hint: 'Avoid common words' };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  const unique = new Set(pw).size;
  if (unique < 6) return { ok: false, score: 1, hint: 'Too many repeated characters' };
  let score = (Math.min(classes, 3) + (pw.length >= 14 ? 1 : 0)) as 1 | 2 | 3 | 4;
  if (pw.length >= 20) score = 4;
  if (score < 2) return { ok: false, score, hint: 'Mix letters, numbers and symbols, or use a longer passphrase' };
  return { ok: true, score, hint: score >= 3 ? 'Strong password' : 'Good — longer is better' };
};

export type AddressCheck = { ok: true; normalized: string; warning?: string } | { ok: false; error: string };

export const validateAddress = (family: ChainFamily, input: string): AddressCheck => {
  const a = input.trim();
  if (!a) return { ok: false, error: 'Enter an address' };
  if (family === 'evm') {
    if (!isAddress(a, { strict: false })) return { ok: false, error: 'Not a valid EVM address' };
    // Mixed-case input must carry a valid EIP-55 checksum.
    const mixed = a !== a.toLowerCase() && a.slice(2) !== a.slice(2).toUpperCase();
    if (mixed && !isAddress(a, { strict: true })) return { ok: false, error: 'Address checksum is invalid — possible typo' };
    const normalized = getAddress(a);
    if (/^0x0{40}$/i.test(a)) return { ok: false, error: 'Refusing to send to the zero address' };
    return { ok: true, normalized };
  }
  if (family === 'solana') {
    try {
      const bytes = base58.decode(a);
      if (bytes.length !== 32) return { ok: false, error: 'Not a valid Solana address' };
      let onCurve = true;
      try { ed25519.ExtendedPoint.fromHex(bytes); } catch { onCurve = false; }
      return onCurve
        ? { ok: true, normalized: a }
        : { ok: true, normalized: a, warning: 'This is a program-derived address, not a regular wallet' };
    } catch {
      return { ok: false, error: 'Not a valid Solana address' };
    }
  }
  try {
    const decoded = btc.Address(btc.NETWORK).decode(a);
    if (decoded.type === 'unknown') return { ok: false, error: 'Unsupported Bitcoin address type' };
    return { ok: true, normalized: a };
  } catch {
    return { ok: false, error: 'Not a valid Bitcoin mainnet address' };
  }
};

/**
 * Address-poisoning guard: flags a recipient that looks like a previously
 * used address (same first/last characters) but is not identical.
 */
export const looksLikePoisoned = (candidate: string, known: string[]): string | null => {
  const c = candidate.toLowerCase();
  for (const k of known) {
    const kk = k.toLowerCase();
    if (kk === c) continue;
    if (kk.slice(0, 6) === c.slice(0, 6) && kk.slice(-4) === c.slice(-4)) return k;
  }
  return null;
};

export const shortAddr = (a: string, n = 4): string => (a.length <= n * 2 + 3 ? a : `${a.slice(0, n + (a.startsWith('0x') ? 2 : 0))}…${a.slice(-n)}`);
