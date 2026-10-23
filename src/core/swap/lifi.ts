/**
 * Cross-chain swap routing via the LI.FI aggregation API
 * (bridges + DEXs across EVM chains, Solana and Bitcoin).
 */
import { getChain, lifiTokenAddress } from '../chains/registry';
import type { QuoteRequest, SwapQuote, SwapTx } from './types';

const LIFI_API = 'https://li.quest/v1';
const INTEGRATOR = 'post-q-wallet';

interface LifiQuote {
  id: string;
  tool: string;
  toolDetails?: { name?: string };
  action: {
    fromChainId: number; toChainId: number;
    fromToken: { address: string }; toToken: { address: string };
    fromAmount: string; fromAddress: string; toAddress: string; slippage: number;
  };
  estimate: {
    toAmount: string; toAmountMin: string; approvalAddress?: string; executionDuration: number;
    fromAmountUSD?: string; toAmountUSD?: string;
    feeCosts?: { amountUSD?: string }[]; gasCosts?: { amountUSD?: string }[];
  };
  includedSteps?: { toolDetails?: { name?: string }; tool: string }[];
  transactionRequest?: { to?: string; data?: string; value?: string; gasLimit?: string; chainId?: number };
}

const sumUsd = (xs?: { amountUSD?: string }[]) => (xs ?? []).reduce((s, x) => s + (Number(x.amountUSD) || 0), 0);

const toBig = (v?: string): bigint => (v ? BigInt(v) : 0n);

export const fetchLifiQuote = async (req: QuoteRequest, signal?: AbortSignal): Promise<SwapQuote> => {
  const params = new URLSearchParams({
    fromChain: String(getChain(req.from.chainId).lifiId),
    toChain: String(getChain(req.to.chainId).lifiId),
    fromToken: lifiTokenAddress(req.from),
    toToken: lifiTokenAddress(req.to),
    fromAmount: req.fromAmount.toString(),
    fromAddress: req.fromAddress,
    toAddress: req.toAddress,
    slippage: String(req.slippage),
    integrator: INTEGRATOR,
    order: 'RECOMMENDED',
  });
  const res = await fetch(`${LIFI_API}/quote?${params}`, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `No route found (${res.status})`);
  }
  const q = (await res.json()) as LifiQuote;
  const tr = q.transactionRequest;
  if (!tr) throw new Error('Quote has no transaction');

  const family = getChain(req.from.chainId).family;
  let tx: SwapTx;
  if (family === 'evm') {
    tx = { kind: 'evm', chainId: Number(tr.chainId), to: String(tr.to), data: String(tr.data), value: toBig(tr.value), gasLimit: tr.gasLimit ? BigInt(tr.gasLimit) : undefined };
  } else if (family === 'solana') {
    tx = { kind: 'solana', base64: String(tr.data) };
  } else {
    const d = String(tr.data ?? '');
    tx = /^70736274ff/i.test(d) ? { kind: 'bitcoin', psbtHex: d } : { kind: 'bitcoin', to: tr.to, value: toBig(tr.value), memo: d };
  }

  return {
    id: q.id,
    from: req.from,
    to: req.to,
    fromAmount: BigInt(q.action.fromAmount),
    toAmount: BigInt(q.estimate.toAmount),
    toAmountMin: BigInt(q.estimate.toAmountMin),
    fromAddress: q.action.fromAddress,
    toAddress: q.action.toAddress,
    toolName: q.toolDetails?.name ?? q.tool,
    route: (q.includedSteps ?? []).map((s) => s.toolDetails?.name ?? s.tool),
    durationSec: q.estimate.executionDuration,
    feeUsd: sumUsd(q.estimate.feeCosts),
    gasUsd: sumUsd(q.estimate.gasCosts),
    fromUsd: Number(q.estimate.fromAmountUSD) || 0,
    toUsd: Number(q.estimate.toAmountUSD) || 0,
    slippage: q.action.slippage,
    approvalAddress: q.estimate.approvalAddress,
    tx,
    echo: {
      fromChainId: q.action.fromChainId,
      toChainId: q.action.toChainId,
      fromToken: q.action.fromToken.address,
      toToken: q.action.toToken.address,
      fromAmount: q.action.fromAmount,
      fromAddress: q.action.fromAddress,
      toAddress: q.action.toAddress,
    },
    fetchedAt: Date.now(),
  };
};

export interface LifiStatus { status: 'NOT_FOUND' | 'INVALID' | 'PENDING' | 'DONE' | 'FAILED'; substatus?: string; receiving?: { txHash?: string } }

export const fetchLifiStatus = async (txHash: string, fromLifiChain: number, toLifiChain: number): Promise<LifiStatus> => {
  const params = new URLSearchParams({ txHash, fromChain: String(fromLifiChain), toChain: String(toLifiChain) });
  const res = await fetch(`${LIFI_API}/status?${params}`);
  if (!res.ok) return { status: 'NOT_FOUND' };
  return res.json();
};
