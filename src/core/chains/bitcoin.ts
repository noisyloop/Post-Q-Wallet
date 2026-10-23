/**
 * Bitcoin (native segwit) via an Esplora-compatible API (mempool.space by default).
 */
import * as btc from '@scure/btc-signer';
import { secp256k1 } from '@noble/curves/secp256k1';
import { hex } from '@scure/base';
import { getChain } from './registry';

export interface Utxo { txid: string; vout: number; value: number; status?: { confirmed: boolean } }

const api = (path: string) => `${getChain('bitcoin').rpcUrl}${path}`;

export const btcUtxos = async (address: string): Promise<Utxo[]> => {
  const r = await fetch(api(`/address/${address}/utxo`));
  if (!r.ok) throw new Error(`Bitcoin API ${r.status}`);
  return r.json();
};

export const btcBalance = async (address: string): Promise<bigint> =>
  (await btcUtxos(address)).reduce((s, u) => s + BigInt(u.value), 0n);

export const btcFeeRate = async (): Promise<number> => {
  const r = await fetch(api('/v1/fees/recommended'));
  if (!r.ok) throw new Error(`Bitcoin API ${r.status}`);
  const j = (await r.json()) as { halfHourFee: number };
  return Math.max(1, j.halfHourFee);
};

export interface BtcOutput { address?: string; script?: Uint8Array; amount: bigint }

/** Build + sign a P2WPKH transaction. Change goes back to our own address. */
export const buildBtcTx = (
  priv: Uint8Array,
  utxos: Utxo[],
  outputs: BtcOutput[],
  feePerByte: number,
): { hex: string; txid: string; fee: bigint } => {
  if (feePerByte > 500) throw new Error('Fee rate looks unreasonably high');
  const pub = secp256k1.getPublicKey(priv, true);
  const pay = btc.p2wpkh(pub, btc.NETWORK);
  const inputs = utxos.map((u) => ({
    txid: u.txid,
    index: u.vout,
    witnessUtxo: { script: pay.script, amount: BigInt(u.value) },
  }));
  const sel = btc.selectUTXO(inputs, outputs as never, 'default', {
    changeAddress: pay.address!,
    feePerByte: BigInt(Math.ceil(feePerByte)),
    bip69: true,
    createTx: true,
    network: btc.NETWORK,
    // Only our own OP_RETURN memo outputs are non-standard here.
    allowUnknownOutputs: outputs.every((o) => o.address || (o.script && o.script[0] === 0x6a && o.amount === 0n)),
  });
  if (!sel || !sel.tx) throw new Error('Insufficient BTC to cover amount + network fee');
  sel.tx.sign(priv);
  sel.tx.finalize();
  return { hex: hex.encode(sel.tx.extract()), txid: sel.tx.id, fee: sel.fee ?? 0n };
};

export const opReturnScript = (data: Uint8Array): Uint8Array => {
  if (data.length > 80) throw new Error('OP_RETURN payload too large');
  return btc.Script.encode(['RETURN', data]);
};

export const btcBroadcast = async (txHex: string): Promise<string> => {
  const r = await fetch(api('/tx'), { method: 'POST', body: txHex });
  if (!r.ok) throw new Error(`Broadcast failed: ${await r.text()}`);
  return r.text();
};
