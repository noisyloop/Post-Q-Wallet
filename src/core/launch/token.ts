/**
 * SPL token creation: mint account, Metaplex metadata, full-supply mint and
 * revocation of the mint authority. The freeze authority is never set.
 */
import { base58 } from '@scure/base';
import {
  associatedTokenAddress, concat, createAtaIdempotentIx, findProgramAddress, SYSTEM_PROGRAM, TOKEN_PROGRAM, u64le,
  type Instruction,
} from '../chains/solana';

export const METADATA_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
export const NATIVE_MINT = 'So11111111111111111111111111111111111111112';
export const MINT_SIZE = 82;

const enc = new TextEncoder();

const u32le = (n: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};

const borshString = (s: string): Uint8Array => {
  const b = enc.encode(s);
  return concat(u32le(b.length), b);
};

export const metadataAddress = (mint: string): string =>
  findProgramAddress([enc.encode('metadata'), base58.decode(METADATA_PROGRAM), base58.decode(mint)], METADATA_PROGRAM)[0];

export const createAccountIx = (from: string, account: string, lamports: bigint, space: number, owner: string): Instruction => ({
  programId: SYSTEM_PROGRAM,
  keys: [
    { pubkey: from, isSigner: true, isWritable: true },
    { pubkey: account, isSigner: true, isWritable: true },
  ],
  data: concat(u32le(0), u64le(lamports), u64le(BigInt(space)), base58.decode(owner)),
});

/** InitializeMint2 with no freeze authority (holders can never be frozen). */
export const initializeMint2Ix = (mint: string, decimals: number, mintAuthority: string): Instruction => ({
  programId: TOKEN_PROGRAM,
  keys: [{ pubkey: mint, isSigner: false, isWritable: true }],
  data: concat([20, decimals], base58.decode(mintAuthority), [0], new Uint8Array(32)),
});

export const mintToIx = (mint: string, dest: string, authority: string, amount: bigint): Instruction => ({
  programId: TOKEN_PROGRAM,
  keys: [
    { pubkey: mint, isSigner: false, isWritable: true },
    { pubkey: dest, isSigner: false, isWritable: true },
    { pubkey: authority, isSigner: true, isWritable: false },
  ],
  data: concat([7], u64le(amount)),
});

/** SetAuthority(MintTokens → None): permanently fixes the supply. */
export const revokeMintAuthorityIx = (mint: string, current: string): Instruction => ({
  programId: TOKEN_PROGRAM,
  keys: [
    { pubkey: mint, isSigner: false, isWritable: true },
    { pubkey: current, isSigner: true, isWritable: false },
  ],
  data: concat([6, 0, 0], new Uint8Array(32)),
});

export const syncNativeIx = (account: string): Instruction => ({
  programId: TOKEN_PROGRAM,
  keys: [{ pubkey: account, isSigner: false, isWritable: true }],
  data: new Uint8Array([17]),
});

export const closeAccountIx = (account: string, dest: string, owner: string): Instruction => ({
  programId: TOKEN_PROGRAM,
  keys: [
    { pubkey: account, isSigner: false, isWritable: true },
    { pubkey: dest, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: true, isWritable: false },
  ],
  data: new Uint8Array([9]),
});

export const computeUnitPriceIx = (microLamports: bigint): Instruction => ({
  programId: COMPUTE_BUDGET_PROGRAM,
  keys: [],
  data: concat([3], u64le(microLamports)),
});

export interface TokenMetadata { name: string; symbol: string; uri: string }

/** Metaplex CreateMetadataAccountV3 with no creators/collection/uses. */
export const createMetadataV3Ix = (mint: string, authority: string, md: TokenMetadata, isMutable: boolean): Instruction => ({
  programId: METADATA_PROGRAM,
  keys: [
    { pubkey: metadataAddress(mint), isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: authority, isSigner: true, isWritable: false }, // mint authority
    { pubkey: authority, isSigner: true, isWritable: true }, // payer
    { pubkey: authority, isSigner: false, isWritable: false }, // update authority
    { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
  ],
  data: concat(
    [33],
    borshString(md.name), borshString(md.symbol), borshString(md.uri),
    [0, 0], // seller_fee_basis_points
    [0], [0], [0], // creators, collection, uses = None
    [isMutable ? 1 : 0],
    [0], // collection_details = None
  ),
});

export interface CreateTokenArgs {
  payer: string;
  mint: string;
  mintRent: bigint;
  decimals: number;
  supply: bigint;
  metadata: TokenMetadata;
  priorityMicroLamports?: bigint;
}

/** Transaction 1: create the token, mint the full fixed supply, revoke minting. */
export const createTokenInstructions = (a: CreateTokenArgs): Instruction[] => [
  ...(a.priorityMicroLamports ? [computeUnitPriceIx(a.priorityMicroLamports)] : []),
  createAccountIx(a.payer, a.mint, a.mintRent, MINT_SIZE, TOKEN_PROGRAM),
  initializeMint2Ix(a.mint, a.decimals, a.payer),
  createMetadataV3Ix(a.mint, a.payer, a.metadata, false),
  createAtaIdempotentIx(a.payer, a.payer, a.mint),
  mintToIx(a.mint, associatedTokenAddress(a.payer, a.mint), a.payer, a.supply),
  revokeMintAuthorityIx(a.mint, a.payer),
];
