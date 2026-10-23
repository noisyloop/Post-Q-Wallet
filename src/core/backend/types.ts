import type { Accounts } from '../keyring';
import type { Token } from '../chains/registry';
import type { QuoteRequest, SwapProgress, SwapQuote } from '../swap/types';

export interface Signer {
  accounts: Accounts;
  withKey<T>(family: 'evm' | 'solana' | 'bitcoin', fn: (priv: Uint8Array) => Promise<T> | T): Promise<T>;
}

export interface Holding { token: Token; amount: bigint }

export type Prices = Record<string, { usd: number; change24h: number }>;

export interface Backend {
  kind: 'live' | 'demo';
  balances(accounts: Accounts): Promise<Holding[]>;
  prices(): Promise<Prices>;
  quote(req: QuoteRequest, signal?: AbortSignal): Promise<SwapQuote>;
  executeSwap(q: SwapQuote, signer: Signer, onProgress: (p: SwapProgress) => void): Promise<SwapProgress>;
  send(token: Token, to: string, amount: bigint, signer: Signer): Promise<string>;
}
