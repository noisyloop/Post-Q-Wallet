import type { Token } from '../chains/registry';

export type SwapTx =
  | { kind: 'evm'; chainId: number; to: string; data: string; value: bigint; gasLimit?: bigint }
  | { kind: 'solana'; base64: string }
  | { kind: 'bitcoin'; psbtHex?: string; to?: string; value?: bigint; memo?: string };

export interface SwapQuote {
  id: string;
  from: Token;
  to: Token;
  fromAmount: bigint;
  toAmount: bigint;
  toAmountMin: bigint;
  fromAddress: string;
  toAddress: string;
  /** e.g. "Across", "Mayan", "THORChain". */
  toolName: string;
  route: string[];
  durationSec: number;
  feeUsd: number;
  gasUsd: number;
  fromUsd: number;
  toUsd: number;
  slippage: number;
  approvalAddress?: string;
  tx: SwapTx;
  /** Raw `transactionRequest.to` / `action` fields echoed for validation. */
  echo: {
    fromChainId: number;
    toChainId: number;
    fromToken: string;
    toToken: string;
    fromAmount: string;
    fromAddress: string;
    toAddress: string;
  };
  fetchedAt: number;
}

export interface QuoteRequest {
  from: Token;
  to: Token;
  fromAmount: bigint;
  fromAddress: string;
  toAddress: string;
  slippage: number;
}

export type SwapPhase = 'approving' | 'signing' | 'submitted' | 'bridging' | 'done' | 'failed';

export interface SwapProgress {
  phase: SwapPhase;
  message: string;
  srcHash?: string;
  dstHash?: string;
}
