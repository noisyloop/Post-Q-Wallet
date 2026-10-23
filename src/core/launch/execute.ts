/** Live launch execution on Solana mainnet. */
import { ed25519 } from '@noble/curves/ed25519';
import {
  compileLegacyMessage, signLegacyMessageMulti, solanaConfirm, solanaLatestBlockhash, solanaRentExempt, solanaSendRaw,
  solanaSimulate, solanaTokenBalance, solPubkey, solRpc, TX_SIZE_LIMIT, type Instruction,
} from '../chains/solana';
import { wipe } from '../keyring';
import type { LaunchProgress, LaunchRecord, Signer } from '../backend/types';
import { buildPoolTx, buildTokenTx, LAUNCH_COST_LAMPORTS, poolAddressFor, type LaunchPlan } from './plan';
import { configToJson } from './record';
import { MINT_SIZE } from './token';

/** Compile, co-sign, size-check, simulate, send and confirm one transaction. */
const sendLaunchTx = async (signer: Signer, ixs: Instruction[], extraSigner: Uint8Array): Promise<string> => {
  const payer = signer.accounts.solana;
  const msg = compileLegacyMessage(payer, await solanaLatestBlockhash(), ixs);
  const tx = await signer.withKey('solana', (k) => {
    if (solPubkey(k) !== payer) throw new Error('Signer does not match wallet');
    return signLegacyMessageMulti(msg, [k, extraSigner]);
  });
  if (tx.length > TX_SIZE_LIMIT) throw new Error('Transaction too large');
  await solanaSimulate(tx);
  const sig = await solanaSendRaw(tx);
  await solanaConfirm(sig);
  return sig;
};

export const executeLaunch = async (
  plan: LaunchPlan,
  signer: Signer,
  onProgress: (p: LaunchProgress) => void,
  onRecord: (r: LaunchRecord) => void,
  resume?: LaunchRecord,
): Promise<LaunchRecord> => {
  if (plan.errors.length) throw new Error(plan.errors[0]);
  const payer = signer.accounts.solana;

  let record: LaunchRecord;
  if (resume?.status === 'token-created') {
    record = resume;
  } else {
    const bal = BigInt((await solRpc<{ value: number }>('getBalance', [payer, { commitment: 'confirmed' }])).value);
    if (bal < plan.config.solLiquidity + LAUNCH_COST_LAMPORTS) throw new Error('Not enough SOL for liquidity + launch costs');

    onProgress({ phase: 'token', message: 'Creating token, minting supply, revoking mint authority' });
    // Fresh mint keypair; it is only needed for this one signature.
    const mintKey = ed25519.utils.randomPrivateKey();
    const mint = solPubkey(mintKey);
    try {
      const rent = BigInt(await solanaRentExempt(MINT_SIZE));
      const sig = await sendLaunchTx(signer, buildTokenTx(plan, payer, mint, rent), mintKey);
      record = {
        id: mint, name: plan.config.name.trim(), symbol: plan.config.symbol.trim(), mint, status: 'token-created',
        createdAt: Date.now(), opensAt: plan.config.openAt, tokenTx: sig, config: configToJson(plan.config),
      };
      onRecord(record);
    } finally {
      wipe(mintKey);
    }
  }

  onProgress({ phase: 'pool', message: 'Creating pool with sniper tax and locking liquidity' });
  const held = await solanaTokenBalance(payer, record.mint);
  if (held < plan.poolA) throw new Error('Token balance is lower than the pool amount — was it moved?');
  // The position NFT mint is a fresh keypair; the NFT itself lands in an
  // account owned by this wallet and entitles it to the pool's trading fees.
  const positionKey = ed25519.utils.randomPrivateKey();
  try {
    const sig = await sendLaunchTx(signer, buildPoolTx(plan, payer, record.mint, solPubkey(positionKey)), positionKey);
    record = { ...record, status: 'live', pool: poolAddressFor(record.mint), poolTx: sig };
    onRecord(record);
  } finally {
    wipe(positionKey);
  }
  onProgress({ phase: 'done', message: 'Launched' });
  return record;
};
