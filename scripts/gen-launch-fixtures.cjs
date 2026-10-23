// Generates tests/fixtures/launch-ref.json: reference instructions for the
// token-launch flow built with the official SDKs. Run it from a throwaway
// directory so these SDKs never become wallet dependencies:
//
//   mkdir /tmp/ref && cd /tmp/ref && npm init -y && npm i --ignore-scripts \
//     @meteora-ag/cp-amm-sdk@1.5.1 @solana/web3.js@1.98.0 @solana/spl-token@0.4.9 \
//     @metaplex-foundation/mpl-token-metadata@3.4.0 @metaplex-foundation/umi@1.2.0 \
//     @metaplex-foundation/umi-program-repository@1.2.0
//   node <repo>/scripts/gen-launch-fixtures.cjs /tmp/ref > raw.json
const dir = process.argv[2];
const r = (m) => require(dir + '/node_modules/' + m);
const w = r('@solana/web3.js');
const spl = r('@solana/spl-token');
const { CpAmm, getFeeTimeSchedulerParams, MIN_SQRT_PRICE, MAX_SQRT_PRICE, derivePoolAuthority } = r('@meteora-ag/cp-amm-sdk');
const BN = r('bn.js');
const mpl = r('@metaplex-foundation/mpl-token-metadata');
const { createUmi, createNoopSigner, publicKey: umiPk, none } = r('@metaplex-foundation/umi');

const kp = (n) => w.Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + n) & 255));
const payer = kp(1), mint = kp(2), posNft = kp(3);
const ser = (ix) => ({ programId: ix.programId.toBase58(), keys: ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner ? 1 : 0, k.isWritable ? 1 : 0]), data: Buffer.from(ix.data).toString('hex') });
const fromUmi = (ix) => ({ programId: ix.programId.toString(), keys: ix.keys.map((k) => [k.pubkey.toString(), k.isSigner ? 1 : 0, k.isWritable ? 1 : 0]), data: Buffer.from(ix.data).toString('hex') });

(async () => {
  const out = { payer: Buffer.from(payer.secretKey.slice(0, 32)).toString('hex'), mintSeed: Buffer.from(mint.secretKey.slice(0, 32)).toString('hex'), posSeed: Buffer.from(posNft.secretKey.slice(0, 32)).toString('hex') };
  const supply = 1_000_000_000n * 10n ** 6n;
  const ata = spl.getAssociatedTokenAddressSync(mint.publicKey, payer.publicKey);
  // --- token creation
  const umi = createUmi();
  umi.eddsa = { findPda: (programId, seeds) => { const [k, b] = w.PublicKey.findProgramAddressSync(seeds.map((x) => Buffer.from(x)), new w.PublicKey(programId.toString())); return [umiPk(k.toBase58()), b]; } };
  const { defaultProgramRepository } = r('@metaplex-foundation/umi-program-repository');
  umi.use(defaultProgramRepository());
  umi.use(mpl.mplTokenMetadata());
  const md = mpl.createMetadataAccountV3(umi, {
    mint: umiPk(mint.publicKey.toBase58()),
    mintAuthority: createNoopSigner(umiPk(payer.publicKey.toBase58())),
    payer: createNoopSigner(umiPk(payer.publicKey.toBase58())),
    updateAuthority: umiPk(payer.publicKey.toBase58()),
    data: { name: 'Post Q Doge', symbol: 'PQDOGE', uri: 'https://example.com/pqdoge.json', sellerFeeBasisPoints: 0, creators: none(), collection: none(), uses: none() },
    isMutable: false,
    collectionDetails: none(),
  }).getInstructions();
  out.token = [
    ser(w.SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, lamports: 1461600, space: 82, programId: spl.TOKEN_PROGRAM_ID })),
    ser(spl.createInitializeMint2Instruction(mint.publicKey, 6, payer.publicKey, null)),
    ...md.map(fromUmi),
    ser(spl.createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, payer.publicKey, mint.publicKey)),
    ser(spl.createMintToInstruction(mint.publicKey, ata, payer.publicKey, supply)),
    ser(spl.createSetAuthorityInstruction(mint.publicKey, payer.publicKey, spl.AuthorityType.MintTokens, null)),
  ];
  // --- pool creation
  const conn = new w.Connection('http://localhost:1');
  conn.getAccountInfo = async () => null;
  const amm = new CpAmm(conn);
  const tokenAAmount = new BN((supply).toString());
  const tokenBAmount = new BN(5_000_000_000);
  const { initSqrtPrice, liquidityDelta } = amm.preparePoolCreationParams({ tokenAAmount, tokenBAmount, minSqrtPrice: MIN_SQRT_PRICE, maxSqrtPrice: MAX_SQRT_PRICE, collectFeeMode: 1 });
  out.sdkSqrtPrice = initSqrtPrice.toString();
  out.sdkLiquidity = liquidityDelta.toString();
  const baseFee = getFeeTimeSchedulerParams(7500, 100, 1, 30, 300);
  out.baseFee = Buffer.from(baseFee.data).toString('hex');
  const res = await amm.createCustomPool({
    payer: payer.publicKey, creator: payer.publicKey, positionNft: posNft.publicKey,
    tokenAMint: mint.publicKey, tokenBMint: spl.NATIVE_MINT, tokenAAmount, tokenBAmount,
    sqrtMinPrice: MIN_SQRT_PRICE, sqrtMaxPrice: MAX_SQRT_PRICE, liquidityDelta, initSqrtPrice,
    poolFees: { baseFee, compoundingFeeBps: 0, padding: 0, dynamicFee: null },
    hasAlphaVault: false, collectFeeMode: 1, activationType: 1, activationPoint: new BN(1767225600),
    tokenAProgram: spl.TOKEN_PROGRAM_ID, tokenBProgram: spl.TOKEN_PROGRAM_ID, isLockLiquidity: true,
  });
  const tx = res.tx ?? res;
  out.pool = tx.instructions.map(ser);
  out.poolAddress = res.pool?.toBase58?.();
  out.poolAuthority = derivePoolAuthority().toBase58();
  out.computePrice = ser(w.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }));
  out.closeWsol = ser(spl.createCloseAccountInstruction(spl.getAssociatedTokenAddressSync(spl.NATIVE_MINT, payer.publicKey), payer.publicKey, payer.publicKey));
  console.log(JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
