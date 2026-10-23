import type { Accounts } from '../keyring';
import type { Token } from '../chains/registry';
import type { QuoteRequest, SwapProgress, SwapQuote } from '../swap/types';
import type { LaunchPlan } from '../launch/plan';

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
  /**
   * Launch a token + locked, sniper-taxed pool. `onRecord` is called whenever
   * on-chain state changes so a partially completed launch can be resumed.
   */
  launchToken(plan: LaunchPlan, signer: Signer, onProgress: (p: LaunchProgress) => void, onRecord: (r: LaunchRecord) => void, resume?: LaunchRecord): Promise<LaunchRecord>;
}

export type LaunchPhase = 'token' | 'pool' | 'done';

export interface LaunchProgress { phase: LaunchPhase; message: string }

export interface LaunchRecord {
  id: string;
  name: string;
  symbol: string;
  mint: string;
  pool?: string;
  status: 'token-created' | 'live';
  createdAt: number;
  opensAt: number | null;
  tokenTx?: string;
  poolTx?: string;
  /** JSON-safe copy of the config, for resuming. */
  config: Record<string, unknown>;
}
