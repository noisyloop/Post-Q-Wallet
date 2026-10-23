/** Live backend: real RPCs, real prices, real LI.FI routes. */
import type { Address, Hex } from 'viem';
import * as btc from '@scure/btc-signer';
import { secp256k1 } from '@noble/curves/secp256k1';
import { base64, hex } from '@scure/base';
import { CHAINS, getChain, TOKENS, type Token } from '../chains/registry';
import { evmAllowance, evmApproveRequest, evmBalances, evmSendRaw, evmTransferRequest, evmWaitForReceipt } from '../chains/evm';
import { buildSolanaTransfer, signSerializedTransaction, solanaBalances, solanaSendRaw } from '../chains/solana';
import { btcBalance, btcBroadcast, btcFeeRate, btcUtxos, buildBtcTx, opReturnScript } from '../chains/bitcoin';
import { fetchLifiQuote, fetchLifiStatus } from '../swap/lifi';
import { hasBlocker, validateQuote } from '../swap/validate';
import type { SwapProgress, SwapQuote } from '../swap/types';
import type { Backend, Holding, Prices, Signer } from './types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const signBtcPsbt = (priv: Uint8Array, psbtHex: string, maxSpend: bigint): string => {
  const ours = btc.p2wpkh(secp256k1.getPublicKey(priv, true), btc.NETWORK);
  const tx = btc.Transaction.fromPSBT(hex.decode(psbtHex), { allowUnknownOutputs: true });
  let inSum = 0n;
  for (let i = 0; i < tx.inputsLength; i++) {
    const w = tx.getInput(i).witnessUtxo;
    if (!w || hex.encode(w.script) !== hex.encode(ours.script)) throw new Error('PSBT spends inputs that are not from this wallet');
    inSum += w.amount;
  }
  let external = 0n;
  let outSum = 0n;
  for (let i = 0; i < tx.outputsLength; i++) {
    const o = tx.getOutput(i);
    outSum += o.amount ?? 0n;
    if (!o.script || hex.encode(o.script) !== hex.encode(ours.script)) external += o.amount ?? 0n;
  }
  const fee = inSum - outSum;
  if (external > maxSpend) throw new Error('PSBT sends more than the quoted amount');
  if (fee < 0n || fee > 100_000n) throw new Error('PSBT network fee is out of bounds');
  tx.sign(priv);
  tx.finalize();
  return hex.encode(tx.extract());
};

export const createLiveBackend = (): Backend => ({
  kind: 'live',

  async balances(accounts) {
    const out: Holding[] = [];
    const jobs = CHAINS.map(async (c) => {
      try {
        let m: Map<Token, bigint>;
        if (c.family === 'evm') m = await evmBalances(c.id, accounts.evm as Address);
        else if (c.family === 'solana') m = await solanaBalances(accounts.solana);
        else m = new Map([[TOKENS.find((t) => t.chainId === 'bitcoin')!, await btcBalance(accounts.bitcoin)]]);
        for (const [token, amount] of m) out.push({ token, amount });
      } catch (e) {
        console.warn(`balance fetch failed for ${c.id}`, e);
      }
    });
    await Promise.all(jobs);
    return out;
  },

  async prices() {
    const ids = [...new Set(TOKENS.map((t) => t.priceId))].join(',');
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
    if (!r.ok) throw new Error('Price feed unavailable');
    const j = (await r.json()) as Record<string, { usd: number; usd_24h_change?: number }>;
    const p: Prices = {};
    for (const [k, v] of Object.entries(j)) p[k] = { usd: v.usd, change24h: v.usd_24h_change ?? 0 };
    return p;
  },

  quote: (req, signal) => fetchLifiQuote(req, signal),

  async executeSwap(q: SwapQuote, signer: Signer, onProgress) {
    // Re-validate at execution time: never sign a quote that fails checks.
    const req = { from: q.from, to: q.to, fromAmount: q.fromAmount, fromAddress: q.fromAddress, toAddress: q.toAddress, slippage: q.slippage };
    if (hasBlocker(validateQuote(q, req))) throw new Error('Quote failed safety checks — refresh and try again');

    const fromChain = getChain(q.from.chainId);
    const toChain = getChain(q.to.chainId);
    let srcHash: string;

    if (q.tx.kind === 'evm') {
      const tx = q.tx;
      if (q.from.address && q.approvalAddress) {
        const allowance = await evmAllowance(q.from.chainId, q.from.address as Address, q.fromAddress as Address, q.approvalAddress as Address);
        if (allowance < q.fromAmount) {
          onProgress({ phase: 'approving', message: `Approving exactly ${q.from.symbol} for this swap` });
          const h = await signer.withKey('evm', (k) => evmSendRaw(k, evmApproveRequest(q.from.chainId, q.from.address as Address, q.approvalAddress as Address, q.fromAmount)));
          await evmWaitForReceipt(q.from.chainId, h);
        }
      }
      onProgress({ phase: 'signing', message: 'Signing swap transaction' });
      srcHash = await signer.withKey('evm', (k) => evmSendRaw(k, { chainId: q.from.chainId, to: tx.to as Address, data: tx.data as Hex, value: tx.value, gas: tx.gasLimit }));
      onProgress({ phase: 'submitted', message: 'Waiting for confirmation', srcHash });
      const rc = await evmWaitForReceipt(q.from.chainId, srcHash as Hex);
      if (rc.status !== 'success') return { phase: 'failed', message: 'Transaction reverted', srcHash };
    } else if (q.tx.kind === 'solana') {
      const raw = base64.decode(q.tx.base64);
      onProgress({ phase: 'signing', message: 'Signing Solana transaction' });
      const signed = await signer.withKey('solana', (k) => signSerializedTransaction(k, raw));
      srcHash = await solanaSendRaw(signed);
    } else {
      const btcTx = q.tx;
      onProgress({ phase: 'signing', message: 'Signing Bitcoin transaction' });
      const rawHex = await signer.withKey('bitcoin', async (k) => {
        if (btcTx.psbtHex) return signBtcPsbt(k, btcTx.psbtHex, q.fromAmount);
        const memo = btcTx.memo ?? '';
        const memoBytes = /^(0x)?[0-9a-f]+$/i.test(memo) && memo.length % 2 === 0 ? hex.decode(memo.replace(/^0x/, '')) : new TextEncoder().encode(memo);
        const outputs = [{ address: btcTx.to!, amount: btcTx.value! }, ...(memoBytes.length ? [{ script: opReturnScript(memoBytes), amount: 0n }] : [])];
        return buildBtcTx(k, await btcUtxos(signer.accounts.bitcoin), outputs, await btcFeeRate()).hex;
      });
      srcHash = await btcBroadcast(rawHex);
    }

    if (fromChain.id === toChain.id) return { phase: 'done', message: 'Swap complete', srcHash };

    onProgress({ phase: 'bridging', message: `Bridging to ${toChain.name}`, srcHash });
    const deadline = Date.now() + 60 * 60_000;
    while (Date.now() < deadline) {
      await sleep(10_000);
      const s = await fetchLifiStatus(srcHash, fromChain.lifiId, toChain.lifiId);
      if (s.status === 'DONE') {
        const res: SwapProgress = s.substatus === 'PARTIAL' || s.substatus === 'REFUNDED'
          ? { phase: 'done', message: `Completed with ${s.substatus?.toLowerCase()} — check your balance`, srcHash, dstHash: s.receiving?.txHash }
          : { phase: 'done', message: 'Bridge complete', srcHash, dstHash: s.receiving?.txHash };
        return res;
      }
      if (s.status === 'FAILED') return { phase: 'failed', message: 'Bridge failed — funds are usually refunded on the source chain', srcHash };
    }
    return { phase: 'bridging', message: 'Still bridging — check Activity later', srcHash };
  },

  async send(token, to, amount, signer) {
    const fam = getChain(token.chainId).family;
    if (fam === 'evm') return signer.withKey('evm', (k) => evmSendRaw(k, evmTransferRequest(token, to as Address, amount)));
    if (fam === 'solana') {
      const tx = await signer.withKey('solana', (k) => buildSolanaTransfer(k, token, to, amount));
      return solanaSendRaw(tx);
    }
    const [utxos, rate] = await Promise.all([btcUtxos(signer.accounts.bitcoin), btcFeeRate()]);
    const built = await signer.withKey('bitcoin', (k) => buildBtcTx(k, utxos, [{ address: to, amount }], rate));
    return btcBroadcast(built.hex);
  },
});
