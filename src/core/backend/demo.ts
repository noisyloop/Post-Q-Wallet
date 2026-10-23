/**
 * Demo backend: deterministic balances, prices and quotes so the wallet can
 * be explored (and screenshotted) without network access or real funds.
 * Key generation, vault encryption and quote safety checks still run for
 * real; only network I/O is simulated and nothing is ever broadcast.
 */
import { bytesToHex } from 'viem';
import { sha256 } from '@noble/hashes/sha256';
import { base58 } from '@scure/base';
import { getChain, lifiTokenAddress, TOKENS, tokenKey, type Token } from '../chains/registry';
import { LIFI_DIAMOND } from '../swap/validate';
import type { QuoteRequest, SwapProgress, SwapQuote, SwapTx } from '../swap/types';
import type { Backend, Holding, Prices } from './types';

const PRICES: Prices = {
  ethereum: { usd: 3842.17, change24h: 2.41 },
  'usd-coin': { usd: 1.0, change24h: 0.01 },
  tether: { usd: 1.0, change24h: -0.02 },
  'polygon-ecosystem-token': { usd: 0.412, change24h: -1.37 },
  binancecoin: { usd: 712.35, change24h: 0.88 },
  'avalanche-2': { usd: 38.9, change24h: 3.12 },
  solana: { usd: 214.62, change24h: 5.27 },
  bitcoin: { usd: 108_420.5, change24h: 1.06 },
};

const START: Record<string, number> = {
  'ethereum:native': 1.284,
  'ethereum:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 2450.0,
  'base:native': 0.412,
  'base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': 812.55,
  'arbitrum:native': 0.735,
  'polygon:native': 640.2,
  'solana:native': 18.42,
  'solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 325.1,
  'bitcoin:native': 0.0521,
  'bsc:native': 0.9,
  'avalanche:native': 12.5,
};

const units = (t: Token, n: number): bigint => BigInt(Math.round(n * 10 ** Math.min(t.decimals, 9))) * 10n ** BigInt(Math.max(0, t.decimals - 9));
const asNumber = (t: Token, v: bigint): number => Number(v) / 10 ** t.decimals;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fakeHash = (seed: string, family: string): string => {
  const h = sha256(new TextEncoder().encode(seed + Date.now()));
  if (family === 'solana') return base58.encode(new Uint8Array([...h, ...sha256(h)]));
  if (family === 'bitcoin') return bytesToHex(h).slice(2);
  return bytesToHex(h);
};

const ROUTES: Record<string, { name: string; route: string[]; secs: number }> = {
  'evm>evm': { name: 'Across', route: ['Across'], secs: 18 },
  'evm>solana': { name: 'Mayan', route: ['Uniswap', 'Mayan Swift'], secs: 42 },
  'solana>evm': { name: 'Mayan', route: ['Jupiter', 'Mayan Swift'], secs: 45 },
  'evm>bitcoin': { name: 'THORChain', route: ['THORChain'], secs: 600 },
  'bitcoin>evm': { name: 'THORChain', route: ['THORChain'], secs: 900 },
  'bitcoin>solana': { name: 'THORChain', route: ['THORChain', 'Jupiter'], secs: 960 },
  'solana>bitcoin': { name: 'THORChain', route: ['Jupiter', 'THORChain'], secs: 700 },
  'solana>solana': { name: 'Jupiter', route: ['Jupiter'], secs: 4 },
};

export const createDemoBackend = (): Backend => {
  const holdings = new Map<string, number>(Object.entries(START));

  return {
    kind: 'demo',

    async balances() {
      await sleep(250);
      return TOKENS.filter((t) => holdings.has(tokenKey(t))).map<Holding>((t) => ({ token: t, amount: units(t, holdings.get(tokenKey(t))!) }));
    },

    async prices() {
      return PRICES;
    },

    async quote(req: QuoteRequest) {
      await sleep(700);
      const fromC = getChain(req.from.chainId);
      const toC = getChain(req.to.chainId);
      const key = `${fromC.family}>${toC.family}`;
      const r = fromC.id === toC.id && fromC.family === 'evm'
        ? { name: 'Uniswap', route: ['Uniswap V3'], secs: 12 }
        : ROUTES[key] ?? ROUTES['evm>evm'];
      const fromUsd = asNumber(req.from, req.fromAmount) * PRICES[req.from.priceId].usd;
      const feeUsd = fromC.id === toC.id ? fromUsd * 0.0025 : Math.max(0.35, fromUsd * 0.0018);
      const gasUsd = fromC.family === 'evm' ? (fromC.id === 'ethereum' ? 3.85 : 0.04) : fromC.family === 'solana' ? 0.002 : 2.1;
      const toUsd = fromUsd - feeUsd;
      const toAmount = units(req.to, toUsd / PRICES[req.to.priceId].usd);
      const toAmountMin = (toAmount * BigInt(Math.round((1 - req.slippage) * 1e6))) / 1_000_000n;
      let tx: SwapTx;
      if (fromC.family === 'evm') {
        tx = { kind: 'evm', chainId: fromC.evmChainId!, to: LIFI_DIAMOND, data: '0x4630a0d8', value: req.from.address ? 0n : req.fromAmount };
      } else if (fromC.family === 'solana') {
        tx = { kind: 'solana', base64: 'AQ==' };
      } else {
        tx = { kind: 'bitcoin', to: 'bc1qdemo0000000000000000000000000000000vault', value: req.fromAmount, memo: '=:demo' };
      }
      return {
        id: `demo-${Date.now()}`,
        from: req.from, to: req.to,
        fromAmount: req.fromAmount, toAmount, toAmountMin,
        fromAddress: req.fromAddress, toAddress: req.toAddress,
        toolName: r.name, route: r.route, durationSec: r.secs,
        feeUsd, gasUsd, fromUsd, toUsd, slippage: req.slippage,
        approvalAddress: req.from.address && fromC.family === 'evm' ? LIFI_DIAMOND : undefined,
        tx,
        echo: {
          fromChainId: fromC.lifiId, toChainId: toC.lifiId,
          fromToken: lifiTokenAddress(req.from), toToken: lifiTokenAddress(req.to),
          fromAmount: req.fromAmount.toString(), fromAddress: req.fromAddress, toAddress: req.toAddress,
        },
        fetchedAt: Date.now(),
      } satisfies SwapQuote;
    },

    async executeSwap(q, _signer, onProgress) {
      const fromC = getChain(q.from.chainId);
      const toC = getChain(q.to.chainId);
      if (q.from.address && fromC.family === 'evm') {
        onProgress({ phase: 'approving', message: `Approving exactly ${asNumber(q.from, q.fromAmount)} ${q.from.symbol}` });
        await sleep(900);
      }
      onProgress({ phase: 'signing', message: 'Signing transaction' });
      await sleep(700);
      const srcHash = fakeHash(q.id, fromC.family);
      onProgress({ phase: 'submitted', message: `Confirming on ${fromC.name}`, srcHash });
      await sleep(1100);
      const fk = tokenKey(q.from);
      const tk = tokenKey(q.to);
      holdings.set(fk, Math.max(0, (holdings.get(fk) ?? 0) - asNumber(q.from, q.fromAmount)));
      if (fromC.id !== toC.id) {
        onProgress({ phase: 'bridging', message: `Bridging to ${toC.name} via ${q.toolName}`, srcHash });
        await sleep(2200);
      }
      holdings.set(tk, (holdings.get(tk) ?? 0) + asNumber(q.to, q.toAmount));
      const done: SwapProgress = { phase: 'done', message: fromC.id === toC.id ? 'Swap complete' : 'Bridge complete', srcHash, dstHash: fromC.id !== toC.id ? fakeHash(srcHash, toC.family) : undefined };
      return done;
    },

    async send(token, _to, amount) {
      await sleep(1200);
      const k = tokenKey(token);
      holdings.set(k, Math.max(0, (holdings.get(k) ?? 0) - asNumber(token, amount)));
      return fakeHash(k, getChain(token.chainId).family);
    },
  };
};
