/**
 * Encrypted vault for the recovery phrase.
 *
 *   key  = scrypt(password, salt, N=2^17, r=8, p=1, dkLen=32)
 *   blob = AES-256-GCM(key, iv, mnemonic, aad="post-q-wallet/vault/v1")
 *
 * Both primitives are symmetric and keep >=128-bit security against known
 * quantum attacks (Grover), so the vault at rest is post-quantum safe.
 * The derived key is imported into WebCrypto as non-extractable and the raw
 * bytes are wiped immediately.
 */
import { scryptAsync } from '@noble/hashes/scrypt';
import { base64 } from '@scure/base';

export interface VaultBlob {
  v: 1;
  kdf: { name: 'scrypt'; N: number; r: number; p: number; salt: string };
  cipher: { name: 'AES-256-GCM'; iv: string };
  ct: string;
}

export const KDF_PARAMS = { N: 2 ** 17, r: 8, p: 1 } as const;
const AAD = new TextEncoder().encode('post-q-wallet/vault/v1');

const subtle = (): SubtleCrypto => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('WebCrypto unavailable (a secure context / HTTPS is required)');
  return s;
};

const deriveKey = async (password: string, salt: Uint8Array, p: { N: number; r: number; p: number }): Promise<CryptoKey> => {
  const pw = new TextEncoder().encode(password.normalize('NFKC'));
  const raw = await scryptAsync(pw, salt, { ...p, dkLen: 32, maxmem: 2 ** 30 });
  try {
    return await subtle().importKey('raw', raw as Uint8Array<ArrayBuffer>, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  } finally {
    raw.fill(0);
    pw.fill(0);
  }
};

export const encryptVault = async (
  secret: string,
  password: string,
  params: { N: number; r: number; p: number } = KDF_PARAMS,
): Promise<VaultBlob> => {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, params);
  const pt = new TextEncoder().encode(secret);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, pt));
  pt.fill(0);
  return {
    v: 1,
    kdf: { name: 'scrypt', ...params, salt: base64.encode(salt) },
    cipher: { name: 'AES-256-GCM', iv: base64.encode(iv) },
    ct: base64.encode(ct),
  };
};

export class WrongPasswordError extends Error {
  constructor() {
    super('Incorrect password');
  }
}

const isBlob = (x: unknown): x is VaultBlob => {
  const b = x as VaultBlob;
  return !!b && b.v === 1 && b.kdf?.name === 'scrypt' && b.cipher?.name === 'AES-256-GCM' &&
    typeof b.ct === 'string' && typeof b.kdf.salt === 'string' && typeof b.cipher.iv === 'string' &&
    // Refuse weakened KDF params planted by an attacker with storage access.
    b.kdf.N >= 2 ** 14 && b.kdf.r >= 8 && b.kdf.p >= 1;
};

export const decryptVault = async (blob: unknown, password: string): Promise<string> => {
  if (!isBlob(blob)) throw new Error('Vault is corrupted or uses unsupported parameters');
  const key = await deriveKey(password, base64.decode(blob.kdf.salt), blob.kdf);
  let pt: Uint8Array;
  try {
    pt = new Uint8Array(await subtle().decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(base64.decode(blob.cipher.iv)), additionalData: AAD }, key, new Uint8Array(base64.decode(blob.ct))));
  } catch {
    throw new WrongPasswordError();
  }
  const s = new TextDecoder().decode(pt);
  pt.fill(0);
  return s;
};

// ---------- persistence + brute-force throttling ----------

const VAULT_KEY = 'pqw.vault.v1';
const LOCKOUT_KEY = 'pqw.lockout';

export interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export const loadVault = (s: Storage): VaultBlob | null => {
  const raw = s.getItem(VAULT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isBlob(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const saveVault = (s: Storage, blob: VaultBlob) => s.setItem(VAULT_KEY, JSON.stringify(blob));
export const clearVault = (s: Storage) => {
  s.removeItem(VAULT_KEY);
  s.removeItem(LOCKOUT_KEY);
};

interface Lockout { fails: number; until: number }

const readLockout = (s: Storage): Lockout => {
  try {
    const l = JSON.parse(s.getItem(LOCKOUT_KEY) ?? '') as Lockout;
    if (typeof l.fails === 'number' && typeof l.until === 'number') return l;
  } catch { /* fallthrough */ }
  return { fails: 0, until: 0 };
};

/** Milliseconds the user must wait before another unlock attempt. */
export const lockoutRemaining = (s: Storage, now = Date.now()): number => Math.max(0, readLockout(s).until - now);

export const recordUnlockFailure = (s: Storage, now = Date.now()): void => {
  const l = readLockout(s);
  const fails = l.fails + 1;
  // 3 free attempts, then exponential backoff capped at 15 minutes.
  const delay = fails <= 3 ? 0 : Math.min(15 * 60_000, 1000 * 2 ** (fails - 3));
  s.setItem(LOCKOUT_KEY, JSON.stringify({ fails, until: now + delay }));
};

export const resetUnlockFailures = (s: Storage) => s.removeItem(LOCKOUT_KEY);
