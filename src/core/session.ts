/**
 * In-memory unlocked session. The BIP-39 seed lives only in this module's
 * closure (never in React state, storage or logs) and is zeroed on lock.
 */
import { deriveAccounts, mnemonicToSeed, wipe, withPrivateKey, type Accounts } from './keyring';
import type { Signer } from './backend/types';

let seed: Uint8Array | null = null;
let accounts: Accounts | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let onLockCb: (() => void) | null = null;

export const AUTO_LOCK_MS = 5 * 60_000;

export const isUnlocked = () => seed !== null;

export const openSession = (mnemonic: string, onLock: () => void): Accounts => {
  closeSession(false);
  seed = mnemonicToSeed(mnemonic);
  accounts = deriveAccounts(seed);
  onLockCb = onLock;
  touchSession();
  return accounts;
};

export const closeSession = (notify = true): void => {
  wipe(seed);
  seed = null;
  accounts = null;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const cb = onLockCb;
  onLockCb = null;
  if (notify) cb?.();
};

/** Reset the inactivity timer; call on user interaction. */
export const touchSession = (): void => {
  if (!seed) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => closeSession(true), AUTO_LOCK_MS);
};

export const sessionSigner = (): Signer => {
  if (!seed || !accounts) throw new Error('Wallet is locked');
  const accts = accounts;
  return {
    accounts: accts,
    withKey: (family, fn) => {
      if (!seed) throw new Error('Wallet is locked');
      touchSession();
      return withPrivateKey(seed, family, fn);
    },
  };
};
