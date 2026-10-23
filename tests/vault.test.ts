import { describe, expect, it } from 'vitest';
import { base64 } from '@scure/base';
import {
  decryptVault, encryptVault, loadVault, lockoutRemaining, recordUnlockFailure, resetUnlockFailures, saveVault, WrongPasswordError,
  type Storage,
} from '../src/core/vault';

// Lower cost for fast tests; production uses N=2^17 (enforced minimum is 2^14).
const FAST = { N: 2 ** 14, r: 8, p: 1 };
const memStorage = (): Storage => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};

describe('vault', () => {
  it('round-trips a secret', async () => {
    const blob = await encryptVault('secret words', 'correct horse battery', FAST);
    expect(blob.ct).not.toContain('secret');
    expect(await decryptVault(blob, 'correct horse battery')).toBe('secret words');
  });

  it('uses fresh salt and IV each time', async () => {
    const a = await encryptVault('x', 'pw-pw-pw-pw', FAST);
    const b = await encryptVault('x', 'pw-pw-pw-pw', FAST);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it('rejects a wrong password', async () => {
    const blob = await encryptVault('secret', 'right-password', FAST);
    await expect(decryptVault(blob, 'wrong-password')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('detects tampering with ciphertext', async () => {
    const blob = await encryptVault('secret', 'right-password', FAST);
    const ct = base64.decode(blob.ct);
    ct[0] ^= 1;
    await expect(decryptVault({ ...blob, ct: base64.encode(ct) }, 'right-password')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('refuses downgraded KDF parameters', async () => {
    const blob = await encryptVault('secret', 'right-password', FAST);
    await expect(decryptVault({ ...blob, kdf: { ...blob.kdf, N: 1024 } }, 'right-password')).rejects.toThrow(/unsupported/);
  });

  it('persists and loads only well-formed blobs', async () => {
    const s = memStorage();
    expect(loadVault(s)).toBeNull();
    const blob = await encryptVault('secret', 'right-password', FAST);
    saveVault(s, blob);
    expect(loadVault(s)).toEqual(blob);
    s.setItem('pqw.vault.v1', '{"v":1}');
    expect(loadVault(s)).toBeNull();
  });

  it('throttles repeated unlock failures with exponential back-off', () => {
    const s = memStorage();
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) recordUnlockFailure(s, t);
    expect(lockoutRemaining(s, t)).toBe(0);
    recordUnlockFailure(s, t);
    expect(lockoutRemaining(s, t)).toBe(2000);
    recordUnlockFailure(s, t);
    expect(lockoutRemaining(s, t)).toBe(4000);
    for (let i = 0; i < 20; i++) recordUnlockFailure(s, t);
    expect(lockoutRemaining(s, t)).toBe(15 * 60_000);
    resetUnlockFailures(s);
    expect(lockoutRemaining(s, t)).toBe(0);
  });
});
