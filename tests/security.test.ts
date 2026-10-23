import { describe, expect, it } from 'vitest';
import * as btc from '@scure/btc-signer';
import { hex } from '@scure/base';
import { checkPassword, looksLikePoisoned, validateAddress } from '../src/core/security';
import { buildBtcTx, opReturnScript } from '../src/core/chains/bitcoin';
import { mnemonicToSeed, withPrivateKey } from '../src/core/keyring';
import { maxSendable, parseAmount } from '../src/core/format';
import { findToken } from '../src/core/chains/registry';

describe('address validation', () => {
  it('validates EVM addresses and EIP-55 checksums', () => {
    expect(validateAddress('evm', '0x9858EfFD232B4033E47d90003D41EC34EcaEda94').ok).toBe(true);
    expect(validateAddress('evm', '0x9858effd232b4033e47d90003d41ec34ecaeda94')).toMatchObject({ ok: true, normalized: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94' });
    expect(validateAddress('evm', '0x9858EfFD232B4033E47d90003D41EC34EcaEda95').ok).toBe(false);
    expect(validateAddress('evm', '0x0000000000000000000000000000000000000000').ok).toBe(false);
    expect(validateAddress('evm', 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk').ok).toBe(false);
  });

  it('validates Solana addresses and flags off-curve PDAs', () => {
    expect(validateAddress('solana', 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk')).toEqual({ ok: true, normalized: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk' });
    expect(validateAddress('solana', '5N3f1tj9v1vc5TUZ8S7mCAnVmjVKrfnzXWhxLaxyZAgt')).toMatchObject({ ok: true, warning: expect.stringMatching(/program-derived/) });
    expect(validateAddress('solana', '0x9858EfFD232B4033E47d90003D41EC34EcaEda94').ok).toBe(false);
  });

  it('validates Bitcoin mainnet addresses only', () => {
    expect(validateAddress('bitcoin', 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu').ok).toBe(true);
    expect(validateAddress('bitcoin', 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyv').ok).toBe(false);
    expect(validateAddress('bitcoin', 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx').ok).toBe(false);
  });

  it('detects address-poisoning look-alikes', () => {
    const known = ['0x9858EfFD232B4033E47d90003D41EC34EcaEda94'];
    expect(looksLikePoisoned('0x9858EfAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAda94', known)).toBe(known[0]);
    expect(looksLikePoisoned(known[0], known)).toBeNull();
    expect(looksLikePoisoned('0x1111111111111111111111111111111111111111', known)).toBeNull();
  });
});

describe('passwords', () => {
  it('enforces length, variety and common-word rules', () => {
    expect(checkPassword('short').ok).toBe(false);
    expect(checkPassword('password1234!').ok).toBe(false);
    expect(checkPassword('aaaaaaaaaaaa').ok).toBe(false);
    expect(checkPassword('Tr0ub4dor&3xyz').ok).toBe(true);
    expect(checkPassword('correct horse battery staple').score).toBe(4);
  });
});

describe('amounts', () => {
  it('parses decimals strictly', () => {
    expect(parseAmount('1.5', 6)).toBe(1_500_000n);
    expect(parseAmount('0.0000001', 6)).toBeNull();
    expect(parseAmount('1e5', 6)).toBeNull();
    expect(parseAmount('-1', 6)).toBeNull();
    expect(parseAmount('.', 6)).toBeNull();
  });

  it('reserves gas when sending the max native amount', () => {
    const eth = findToken('ethereum:native')!;
    const usdc = findToken('ethereum:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')!;
    expect(maxSendable(eth, 10n ** 18n)).toBe(10n ** 18n - 2n * 10n ** 15n);
    expect(maxSendable(usdc, 5n)).toBe(5n);
    expect(maxSendable(eth, 1n)).toBe(0n);
  });
});

describe('bitcoin transactions', () => {
  it('builds and signs a P2WPKH spend with change + OP_RETURN memo', async () => {
    const seed = mnemonicToSeed('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    const utxos = [{ txid: 'a'.repeat(64), vout: 0, value: 100_000 }, { txid: 'b'.repeat(64), vout: 1, value: 50_000 }];
    const built = await withPrivateKey(seed, 'bitcoin', (k) => buildBtcTx(k, utxos, [
      { address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', amount: 120_000n },
      { script: opReturnScript(new TextEncoder().encode('=:ETH.ETH:0xabc')), amount: 0n },
    ], 5));
    const tx = btc.Transaction.fromRaw(hex.decode(built.hex), { allowUnknownOutputs: true });
    expect(tx.inputsLength).toBe(2);
    expect(tx.outputsLength).toBe(3);
    expect(built.fee).toBeGreaterThan(0n);
    expect(built.fee).toBeLessThan(5_000n);
  });

  it('fails cleanly on insufficient funds', async () => {
    const seed = mnemonicToSeed('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    await expect(withPrivateKey(seed, 'bitcoin', (k) => buildBtcTx(k, [{ txid: 'a'.repeat(64), vout: 0, value: 1000 }], [
      { address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', amount: 5000n },
    ], 5))).rejects.toThrow(/Insufficient/);
  });
});
