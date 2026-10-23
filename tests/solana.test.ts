import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex } from '@noble/hashes/utils';
import { base58 } from '@scure/base';
import {
  associatedTokenAddress, compileLegacyMessage, decodeCompactU16, encodeCompactU16, signLegacyMessage, signSerializedTransaction,
  splTransferIxs, systemTransferIx,
} from '../src/core/chains/solana';

const OWNER = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const TO = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BH = 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k';

// Reference values produced by @solana/web3.js 1.98.0 + @solana/spl-token 0.4.9.
const REF_SYS = '01000103f036276246a75b9de3349ed42b15e232f6518fc20f5fcd4f1d64e81f9bd258f77e8c088760bfde1dddcf32c17f209b8242ee52aaf131facd88d0ea2c6d0b06f20000000000000000000000000000000000000000000000000000000000000000c49ae77603782054f17a9decea43b444eba0edb12c6f1d31c6e0e4a84bf052eb01020200010c0200000015cd5b0700000000';
const REF_SPL = '01000508f036276246a75b9de3349ed42b15e232f6518fc20f5fcd4f1d64e81f9bd258f740d2f27c461f29e9feba1ab8acd39496a9c65b0ae62a713f01f941a993bf55edd3ea8cf5acaca8cd05207512175c43cef54a5dd99ede20a16b55253738f397dc00000000000000000000000000000000000000000000000000000000000000007e8c088760bfde1dddcf32c17f209b8242ee52aaf131facd88d0ea2c6d0b06f28c97258f4e2489f1bb3d1029148e0d830b5a1399daff1084048e7bd8dbe9f859c6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d6106ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9c49ae77603782054f17a9decea43b444eba0edb12c6f1d31c6e0e4a84bf052eb02050600020406030701010704010602000a0c404b4c000000000006';

describe('solana', () => {
  it('encodes compact-u16', () => {
    for (const n of [0, 1, 127, 128, 255, 16383, 16384, 65535]) {
      const enc = encodeCompactU16(n);
      expect(decodeCompactU16(Uint8Array.from(enc), 0)).toEqual([n, enc.length]);
    }
    expect(encodeCompactU16(128)).toEqual([0x80, 0x01]);
  });

  it('derives associated token accounts like spl-token', () => {
    expect(associatedTokenAddress(OWNER, USDC)).toBe('5N3f1tj9v1vc5TUZ8S7mCAnVmjVKrfnzXWhxLaxyZAgt');
    expect(associatedTokenAddress(TO, USDC)).toBe('FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B');
  });

  it('compiles a SOL transfer identical to web3.js', () => {
    const msg = compileLegacyMessage(OWNER, BH, [systemTransferIx(OWNER, TO, 123456789n)]);
    expect(bytesToHex(msg)).toBe(REF_SYS);
  });

  it('compiles an SPL transfer (create-idempotent + transferChecked) identical to web3.js', () => {
    const msg = compileLegacyMessage(OWNER, BH, splTransferIxs(OWNER, TO, USDC, 5_000_000n, 6));
    expect(bytesToHex(msg)).toBe(REF_SPL);
  });

  it('produces a verifiable signature', () => {
    const priv = ed25519.utils.randomPrivateKey();
    const pub = base58.encode(ed25519.getPublicKey(priv));
    const msg = compileLegacyMessage(pub, BH, [systemTransferIx(pub, TO, 1n)]);
    const tx = signLegacyMessage(priv, msg);
    expect(tx[0]).toBe(1);
    expect(ed25519.verify(tx.slice(1, 65), msg, ed25519.getPublicKey(priv))).toBe(true);
  });

  it('signs an externally built transaction only if we are the sole fee payer', () => {
    const priv = ed25519.utils.randomPrivateKey();
    const pub = base58.encode(ed25519.getPublicKey(priv));
    const msg = compileLegacyMessage(pub, BH, [systemTransferIx(pub, TO, 1n)]);
    const unsigned = new Uint8Array([1, ...new Uint8Array(64), ...msg]);
    const signed = signSerializedTransaction(priv, unsigned);
    expect(ed25519.verify(signed.slice(1, 65), msg, ed25519.getPublicKey(priv))).toBe(true);

    const other = ed25519.utils.randomPrivateKey();
    expect(() => signSerializedTransaction(other, unsigned)).toThrow(/fee payer/);

    // v0 message prefix is accepted
    const v0 = new Uint8Array([1, ...new Uint8Array(64), 0x80, ...msg, 0]);
    expect(() => signSerializedTransaction(priv, v0)).not.toThrow();
  });
});
