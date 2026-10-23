import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { hexToBytes } from '@noble/hashes/utils';
import { deriveAccounts, isValidMnemonic, mnemonicToSeed, newMnemonic, slip10Ed25519, withPrivateKey } from '../src/core/keyring';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('keyring', () => {
  it('derives well-known addresses for the BIP-39 test mnemonic', () => {
    const a = deriveAccounts(mnemonicToSeed(ABANDON));
    // MetaMask / BIP-44 reference
    expect(a.evm).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
    // BIP-84 spec test vector
    expect(a.bitcoin).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
    // Phantom / Solflare default path m/44'/501'/0'/0'
    expect(a.solana).toBe('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
  });

  it('matches SLIP-10 ed25519 test vector 1', () => {
    const seed = hexToBytes('000102030405060708090a0b0c0d0e0f');
    expect(bytesToHex(slip10Ed25519(seed, 'm'))).toBe('2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7');
    expect(bytesToHex(slip10Ed25519(seed, "m/0'"))).toBe('68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3');
    expect(bytesToHex(slip10Ed25519(seed, "m/0'/1'/2'/2'/1000000000'"))).toBe('8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793');
  });

  it('rejects non-hardened ed25519 paths', () => {
    expect(() => slip10Ed25519(new Uint8Array(32), "m/0'/1")).toThrow();
  });

  it('generates valid 24-word mnemonics with fresh entropy', () => {
    const a = newMnemonic();
    const b = newMnemonic();
    expect(a.split(' ')).toHaveLength(24);
    expect(isValidMnemonic(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('rejects bad checksums and normalises whitespace/case', () => {
    expect(isValidMnemonic(ABANDON.replace('about', 'abandon'))).toBe(false);
    expect(isValidMnemonic(`  ${ABANDON.toUpperCase().replace(/ /g, '   ')} `)).toBe(true);
    expect(() => mnemonicToSeed('not a real phrase')).toThrow('Invalid recovery phrase');
  });

  it('wipes private keys after use', async () => {
    let leaked: Uint8Array | null = null;
    await withPrivateKey(mnemonicToSeed(ABANDON), 'evm', (k) => {
      leaked = k;
      expect(k.some((b) => b !== 0)).toBe(true);
    });
    expect(leaked!.every((b) => b === 0)).toBe(true);
  });
});
