/**
 * Minimal Solana support: JSON-RPC, legacy-message compilation, SPL token
 * transfers and signing of externally built (swap) transactions.
 *
 * Implemented directly on @noble/@scure primitives instead of @solana/web3.js
 * to keep the dependency surface small and auditable.
 */
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { base58, base64 } from '@scure/base';
import { getChain, TOKENS, type Token } from './registry';

export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

// ---------- encoding helpers ----------

export const encodeCompactU16 = (n: number): number[] => {
  const out: number[] = [];
  let v = n;
  for (;;) {
    let b = v & 0x7f;
    v >>= 7;
    if (v === 0) { out.push(b); return out; }
    b |= 0x80;
    out.push(b);
  }
};

export const decodeCompactU16 = (bytes: Uint8Array, offset: number): [value: number, size: number] => {
  let value = 0;
  for (let i = 0; i < 3; i++) {
    const b = bytes[offset + i];
    value |= (b & 0x7f) << (7 * i);
    if ((b & 0x80) === 0) return [value, i + 1];
  }
  throw new Error('Invalid compact-u16');
};

const u64le = (n: bigint): Uint8Array => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
};

const concat = (...parts: (Uint8Array | number[])[]): Uint8Array => {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

const isOnCurve = (pk: Uint8Array): boolean => {
  try { ed25519.ExtendedPoint.fromHex(pk); return true; } catch { return false; }
};

/** Program-derived address search (findProgramAddress). */
export const findProgramAddress = (seeds: Uint8Array[], programId: string): [string, number] => {
  const pid = base58.decode(programId);
  const marker = new TextEncoder().encode('ProgramDerivedAddress');
  for (let bump = 255; bump >= 0; bump--) {
    const h = sha256(concat(...seeds, [bump], pid, marker));
    if (!isOnCurve(h)) return [base58.encode(h), bump];
  }
  throw new Error('Unable to find a viable program address');
};

export const associatedTokenAddress = (owner: string, mint: string): string =>
  findProgramAddress([base58.decode(owner), base58.decode(TOKEN_PROGRAM), base58.decode(mint)], ATA_PROGRAM)[0];

// ---------- message compilation ----------

export interface AccountMeta { pubkey: string; isSigner: boolean; isWritable: boolean }
export interface Instruction { programId: string; keys: AccountMeta[]; data: Uint8Array }

export const compileLegacyMessage = (feePayer: string, recentBlockhash: string, ixs: Instruction[]): Uint8Array => {
  const metas = new Map<string, { s: boolean; w: boolean }>();
  const touch = (k: string, s: boolean, w: boolean) => {
    const m = metas.get(k) ?? { s: false, w: false };
    metas.set(k, { s: m.s || s, w: m.w || w });
  };
  touch(feePayer, true, true);
  for (const ix of ixs) {
    for (const k of ix.keys) touch(k.pubkey, k.isSigner, k.isWritable);
    touch(ix.programId, false, false);
  }
  const entries = [...metas.entries()];
  const rank = ([k, m]: [string, { s: boolean; w: boolean }]) =>
    k === feePayer ? -1 : m.s && m.w ? 0 : m.s ? 1 : m.w ? 2 : 3;
  // Same deterministic ordering as @solana/web3.js: role first, then pubkey.
  entries.sort((a, b) => rank(a) - rank(b) || (rank(a) === -1 ? 0 : a[0].localeCompare(b[0], 'en', {
    localeMatcher: 'best fit', usage: 'sort', sensitivity: 'variant', ignorePunctuation: false, numeric: false, caseFirst: 'lower',
  })));
  const keys = entries.map(([k]) => k);
  const header = [
    entries.filter(([, m]) => m.s).length,
    entries.filter(([, m]) => m.s && !m.w).length,
    entries.filter(([, m]) => !m.s && !m.w).length,
  ];
  const idx = (k: string) => keys.indexOf(k);
  const compiledIxs = ixs.map((ix) => concat(
    [idx(ix.programId)],
    encodeCompactU16(ix.keys.length), ix.keys.map((k) => idx(k.pubkey)),
    encodeCompactU16(ix.data.length), ix.data,
  ));
  return concat(
    header,
    encodeCompactU16(keys.length), ...keys.map((k) => base58.decode(k)),
    base58.decode(recentBlockhash),
    encodeCompactU16(ixs.length), ...compiledIxs,
  );
};

export const systemTransferIx = (from: string, to: string, lamports: bigint): Instruction => ({
  programId: SYSTEM_PROGRAM,
  keys: [{ pubkey: from, isSigner: true, isWritable: true }, { pubkey: to, isSigner: false, isWritable: true }],
  data: concat([2, 0, 0, 0], u64le(lamports)),
});

export const splTransferIxs = (owner: string, to: string, mint: string, amount: bigint, decimals: number): Instruction[] => {
  const src = associatedTokenAddress(owner, mint);
  const dst = associatedTokenAddress(to, mint);
  return [
    {
      // CreateIdempotent: no-op if the recipient's token account already exists.
      programId: ATA_PROGRAM,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: dst, isSigner: false, isWritable: true },
        { pubkey: to, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      ],
      data: new Uint8Array([1]),
    },
    {
      programId: TOKEN_PROGRAM,
      keys: [
        { pubkey: src, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: dst, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
      ],
      data: concat([12], u64le(amount), [decimals]), // TransferChecked
    },
  ];
};

export const signLegacyMessage = (priv: Uint8Array, message: Uint8Array): Uint8Array =>
  concat(encodeCompactU16(1), ed25519.sign(message, priv), message);

/**
 * Sign a serialized (legacy or v0) transaction produced by a swap API.
 * Verifies the fee payer is our own key and that we are the only required
 * signer before adding a signature.
 */
export const signSerializedTransaction = (priv: Uint8Array, txBytes: Uint8Array): Uint8Array => {
  const [numSigs, sigLen] = decodeCompactU16(txBytes, 0);
  const msgStart = sigLen + numSigs * 64;
  const message = txBytes.slice(msgStart);
  let o = 0;
  if (message[0] & 0x80) {
    if ((message[0] & 0x7f) !== 0) throw new Error('Unsupported Solana transaction version');
    o = 1;
  }
  const requiredSigs = message[o];
  const [numKeys, keyLen] = decodeCompactU16(message, o + 3);
  if (numKeys < 1 || requiredSigs !== numSigs) throw new Error('Malformed Solana transaction');
  const feePayer = message.slice(o + 3 + keyLen, o + 3 + keyLen + 32);
  const ours = ed25519.getPublicKey(priv);
  if (base58.encode(feePayer) !== base58.encode(ours)) throw new Error('Transaction fee payer is not this wallet');
  if (requiredSigs !== 1) throw new Error('Transaction requires additional signers — refusing to sign');
  const out = txBytes.slice();
  out.set(ed25519.sign(message, priv), sigLen);
  return out;
};

// ---------- RPC ----------

let rpcId = 0;
export const solRpc = async <T>(method: string, params: unknown[]): Promise<T> => {
  const res = await fetch(getChain('solana').rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  if (!res.ok) throw new Error(`Solana RPC ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message ?? 'Solana RPC error');
  return j.result as T;
};

export const solanaBalances = async (owner: string): Promise<Map<Token, bigint>> => {
  const out = new Map<Token, bigint>();
  for (const t of TOKENS.filter((x) => x.chainId === 'solana')) {
    if (!t.address) {
      const r = await solRpc<{ value: number }>('getBalance', [owner, { commitment: 'confirmed' }]);
      out.set(t, BigInt(r.value));
    } else {
      const r = await solRpc<{ value: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[] }>(
        'getTokenAccountsByOwner', [owner, { mint: t.address }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
      out.set(t, r.value.reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n));
    }
  }
  return out;
};

export const solanaLatestBlockhash = async (): Promise<string> =>
  (await solRpc<{ value: { blockhash: string } }>('getLatestBlockhash', [{ commitment: 'finalized' }])).value.blockhash;

export const solanaSendRaw = (tx: Uint8Array): Promise<string> =>
  solRpc<string>('sendTransaction', [base64.encode(tx), { encoding: 'base64', preflightCommitment: 'confirmed' }]);

export const buildSolanaTransfer = async (priv: Uint8Array, token: Token, to: string, amount: bigint): Promise<Uint8Array> => {
  const owner = base58.encode(ed25519.getPublicKey(priv));
  const ixs = token.address ? splTransferIxs(owner, to, token.address, amount, token.decimals) : [systemTransferIx(owner, to, amount)];
  const msg = compileLegacyMessage(owner, await solanaLatestBlockhash(), ixs);
  return signLegacyMessage(priv, msg);
};
