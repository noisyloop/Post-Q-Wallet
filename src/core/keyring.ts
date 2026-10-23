/**
 * HD key derivation for all supported chain families from one BIP-39 seed.
 *
 *  - EVM:     BIP-44  m/44'/60'/0'/0/{i}       (secp256k1)
 *  - Solana:  SLIP-10 m/44'/501'/{i}'/0'       (ed25519, Phantom-compatible)
 *  - Bitcoin: BIP-84  m/84'/0'/0'/0/{i}        (native segwit, P2WPKH)
 *
 * Private keys are derived on demand inside `withSigner*` helpers and wiped
 * from memory as soon as the callback returns.
 */
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { HDKey } from '@scure/bip32';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha512';
import { ed25519 } from '@noble/curves/ed25519';
import { base58 } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { privateKeyToAddress } from 'viem/accounts';
import { bytesToHex } from 'viem';

export interface Accounts {
  evm: string;
  solana: string;
  bitcoin: string;
}

/** 24 words = 256 bits of entropy; still 128-bit secure against Grover search. */
export const newMnemonic = (strength: 128 | 256 = 256): string => generateMnemonic(wordlist, strength);

export const normalizeMnemonic = (m: string): string => m.trim().toLowerCase().split(/\s+/).join(' ');

export const isValidMnemonic = (m: string): boolean => validateMnemonic(normalizeMnemonic(m), wordlist);

export const mnemonicToSeed = (m: string): Uint8Array => {
  const norm = normalizeMnemonic(m);
  if (!validateMnemonic(norm, wordlist)) throw new Error('Invalid recovery phrase');
  return mnemonicToSeedSync(norm);
};

export const wipe = (...bufs: (Uint8Array | null | undefined)[]): void => {
  for (const b of bufs) b?.fill(0);
};

// ---------- SLIP-10 ed25519 ----------

const HARDENED = 0x80000000;

const parsePath = (path: string): number[] => {
  if (!/^m(\/\d+'?)*$/.test(path)) throw new Error(`Bad path ${path}`);
  return path.split('/').slice(1).map((p) => (p.endsWith("'") ? parseInt(p, 10) + HARDENED : parseInt(p, 10)));
};

export const slip10Ed25519 = (seed: Uint8Array, path: string): Uint8Array => {
  let I = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  let key = I.slice(0, 32);
  let chain = I.slice(32);
  wipe(I);
  for (const idx of parsePath(path)) {
    if (idx < HARDENED) throw new Error('ed25519 SLIP-10 supports hardened derivation only');
    const data = new Uint8Array(37);
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, idx, false);
    I = hmac(sha512, chain, data);
    wipe(key, chain, data);
    key = I.slice(0, 32);
    chain = I.slice(32);
    wipe(I);
  }
  wipe(chain);
  return key;
};

// ---------- paths ----------

export const evmPath = (i = 0) => `m/44'/60'/0'/0/${i}`;
export const solanaPath = (i = 0) => `m/44'/501'/${i}'/0'`;
export const bitcoinPath = (i = 0) => `m/84'/0'/0'/0/${i}`;

const secpChild = (seed: Uint8Array, path: string): HDKey => {
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive(path);
  root.wipePrivateData();
  return child;
};

export const deriveAccounts = (seed: Uint8Array, index = 0): Accounts => {
  const e = secpChild(seed, evmPath(index));
  const evm = privateKeyToAddress(bytesToHex(e.privateKey!));
  e.wipePrivateData();

  const solKey = slip10Ed25519(seed, solanaPath(index));
  const solana = base58.encode(ed25519.getPublicKey(solKey));
  wipe(solKey);

  const b = secpChild(seed, bitcoinPath(index));
  const bitcoin = btc.p2wpkh(b.publicKey!, btc.NETWORK).address!;
  b.wipePrivateData();

  return { evm, solana, bitcoin };
};

/** Run `fn` with a short-lived private key, wiping it afterwards. */
export const withPrivateKey = async <T>(
  seed: Uint8Array,
  family: 'evm' | 'solana' | 'bitcoin',
  fn: (priv: Uint8Array) => Promise<T> | T,
  index = 0,
): Promise<T> => {
  let priv: Uint8Array;
  if (family === 'solana') {
    priv = slip10Ed25519(seed, solanaPath(index));
  } else {
    const k = secpChild(seed, family === 'evm' ? evmPath(index) : bitcoinPath(index));
    priv = Uint8Array.from(k.privateKey!);
    k.wipePrivateData();
  }
  try {
    return await fn(priv);
  } finally {
    wipe(priv);
  }
};
