# Chains and signing

The wallet supports three chain families. All of them follow the same pattern: build the transaction from local data plus a minimal set of RPC reads, sign it inside `signer.withKey(...)`, and broadcast the raw bytes. No transaction is ever signed by a remote service.

## Registry (`src/core/chains/registry.ts`)

Chains and tokens are a **static, reviewed allow-list**:

| id | Family | EVM chain id | LI.FI id | Default RPC | Override env var |
|---|---|---|---|---|---|
| ethereum | evm | 1 | 1 | ethereum-rpc.publicnode.com | `VITE_RPC_ETHEREUM` |
| base | evm | 8453 | 8453 | base-rpc.publicnode.com | `VITE_RPC_BASE` |
| arbitrum | evm | 42161 | 42161 | arbitrum-one-rpc.publicnode.com | `VITE_RPC_ARBITRUM` |
| optimism | evm | 10 | 10 | optimism-rpc.publicnode.com | `VITE_RPC_OPTIMISM` |
| polygon | evm | 137 | 137 | polygon-bor-rpc.publicnode.com | `VITE_RPC_POLYGON` |
| bsc | evm | 56 | 56 | bsc-rpc.publicnode.com | `VITE_RPC_BSC` |
| avalanche | evm | 43114 | 43114 | avalanche-c-chain-rpc.publicnode.com | `VITE_RPC_AVALANCHE` |
| solana | solana | — | 1151111081099710 | solana-rpc.publicnode.com | `VITE_RPC_SOLANA` |
| bitcoin | bitcoin | — | 20000000000001 | mempool.space/api | `VITE_BTC_API` |

Overrides must start with `https://`; anything else is ignored. The production build adds each override's origin to the CSP `connect-src` (see [security.md](security.md#browser-hardening)).

Tokens are each chain's native asset plus USDC on every chain except Bitcoin, plus USDT on Ethereum. Each entry hard-codes its contract address or mint, its decimals (note that USDC on BNB Chain has **18** decimals) and its CoinGecko id. Two things follow from the allow-list:

- Airdropped spam tokens are never shown, because balances are only queried for listed tokens.
- A swap quote can't swap in a look-alike token, because `validateQuote` compares the quote's token addresses with the registry entry the user picked.

`lifiTokenAddress()` maps native assets to LI.FI's conventions: `0x000…000` on EVM, `11111111111111111111111111111111` on Solana, and `bitcoin` on Bitcoin.

## Amounts and parsing (`src/core/format.ts`)

- `parseAmount(text, decimals)` accepts only `^\d*\.?\d*$`. It **rejects** inputs with more fractional digits than the token supports, as well as exponents, signs and empty strings. It returns `bigint | null` and never rounds silently.
- `maxSendable(token, balance)` keeps a fee reserve when sending a native asset "Max": 0.002 ETH on Ethereum, 0.0002 on other EVM chains, 0.005 SOL on Solana, and 3,000 sats on Bitcoin. Tokens are sent in full.
- `number` is used only for display and USD estimates.

---

## EVM (`src/core/chains/evm.ts`)

**Reads.** One cached viem `PublicClient` per chain (15 s timeout). Native balance comes from `eth_getBalance`; ERC-20 balances from `balanceOf` via `eth_call`.

**Signing and sending.**

```ts
evmSendRaw(priv, { chainId, to, data?, value?, gas? }):
  account = privateKeyToAccount(bytesToHex(priv))   // local account
  wallet  = createWalletClient({ account, chain, transport: http(rpc) })
  return wallet.sendTransaction({...})
```

With a *local* account, viem fills in the nonce, gas and EIP-1559 fees from the RPC, **signs locally**, and submits with `eth_sendRawTransaction`. The RPC never receives a key or an unsigned "please sign" request. The RPC can choose the fee values, though, so a malicious RPC could inflate fees. See the [known gaps](security.md#known-gaps).

**Transfers.** Native transfers set `value`. ERC-20 transfers call `transfer(to, amount)`, encoded with viem's `erc20Abi`.

**Approvals.** `evmApproveRequest` always approves **exactly** the swap amount. Before a swap the wallet reads `allowance(owner, spender)` and only sends an approval if it is too low. Unlimited approvals are never created.

**Address checks.** `validateAddress('evm', …)` in `security.ts` does three things:
- Accepts all-lowercase or all-uppercase hex.
- For mixed case, requires a valid EIP-55 checksum, which catches typos.
- Rejects the zero address. The normalised checksummed address is what gets used.

---

## Solana (`src/core/chains/solana.ts`)

The wallet doesn't depend on `@solana/web3.js`. It implements the small part of the protocol it needs, using `@noble/curves` (Ed25519), `@noble/hashes` (SHA-256) and `@scure/base` (base58/base64). `tests/solana.test.ts` and `tests/launch.test.ts` check the output **byte-for-byte** against `@solana/web3.js` 1.98.0 and `@solana/spl-token` 0.4.9.

### Encoding primitives

- **compact-u16** (`encodeCompactU16` / `decodeCompactU16`): 7 bits per byte, little-endian, high bit means "more bytes follow". Used for every array length.
- **PDA search** (`findProgramAddress`): for bump = 255 down to 0, `sha256(seeds ‖ bump ‖ programId ‖ "ProgramDerivedAddress")`. The first result that is **not** a valid Ed25519 point is the PDA.
- **Associated token address**: `PDA([owner, TOKEN_PROGRAM, mint], ATA_PROGRAM)`. Program ids are hard-coded and were checked against the published `@solana/spl-token` package.

### Compiling a legacy message (`compileLegacyMessage`)

```
message = header[3] ‖ compact(n) ‖ accountKeys[n]·32 ‖ recentBlockhash·32
          ‖ compact(m) ‖ instructions[m]
header  = [numRequiredSignatures, numReadonlySigned, numReadonlyUnsigned]
instr   = programIdIndex ‖ compact(k) ‖ accountIndices[k] ‖ compact(len) ‖ data
```

Account metas are merged: a key that is a signer or writable in *any* instruction is a signer or writable overall. They are then ordered:

1. the fee payer
2. writable signers
3. read-only signers
4. writable non-signers
5. read-only non-signers (including program ids)

Within each group keys are sorted with the same `localeCompare` options web3.js uses, so the bytes are identical. That isn't needed for validity, but it makes the reference tests exact.

### Signing

| Function | Use |
|---|---|
| `signLegacyMessage(priv, msg)` | Single signer: `compact(1) ‖ sig ‖ msg` |
| `signLegacyMessageMulti(msg, privs[])` | Several signers, such as the launcher's fresh mint and position keypairs. Reads `numRequiredSignatures` and the first *n* account keys from the message, then signs with the matching key for each slot **in account order**. Throws `Missing signer` if a required key wasn't supplied. |
| `signSerializedTransaction(priv, tx)` | Signs a transaction built by someone else (LI.FI). See below. |

#### Signing third-party transactions safely

For swaps that start on Solana, LI.FI returns a fully built, base64 serialized transaction, usually **v0** with address lookup tables. Before adding a signature, `signSerializedTransaction`:

1. Parses the signature count and locates the message.
2. Accepts a legacy message, or v0 (`prefix & 0x7f == 0`). Any other version is rejected.
3. Requires `numRequiredSignatures == number of signature slots`.
4. Requires the fee payer (account key 0) to equal **this wallet's** public key.
5. Requires **exactly one** required signer, so it refuses transactions that need anyone else's signature.
6. Writes the Ed25519 signature into slot 0.

What the instructions do inside the transaction is checked through the quote echo in the swap validator, not by decoding every program. See [cross-chain-swaps.md](cross-chain-swaps.md#what-the-validator-cannot-see).

### Transfers

- **SOL**: one System Program `Transfer` (index 2, u32 LE) with lamports as u64 LE.
- **SPL (USDC)**: `CreateIdempotent` for the recipient's associated token account (a no-op if it already exists; the sender pays rent if not), followed by `TransferChecked` (index 12, amount u64, decimals u8). `TransferChecked` makes the token program verify the mint's decimals, which guards against decimal-confusion bugs.

### RPC helpers

`getBalance`, `getTokenAccountsByOwner` (jsonParsed, summed per mint), `getLatestBlockhash` (finalized), `sendTransaction` (base64), `getMinimumBalanceForRentExemption`, and `getTokenAccountBalance`. The launcher adds two more:

- `solanaSimulate(tx)`: `simulateTransaction` with `sigVerify: true`. Throws with the error and the last matching program log lines.
- `solanaConfirm(sig)`: polls `getSignatureStatuses` every 1.5 s until the status is `confirmed` or `finalized`. Throws if the transaction has an `err`, or after 75 s with a "check the explorer before retrying" message.

`validateAddress('solana', …)` requires a 32-byte base58 value. If the bytes are **not** on the Ed25519 curve, the address is a program-derived account rather than a wallet. That case is flagged with a warning, because tokens sent to a PDA by mistake are often unrecoverable.

---

## Bitcoin (`src/core/chains/bitcoin.ts`)

**Data source.** An Esplora-compatible API (mempool.space by default): `/address/:a/utxo`, `/v1/fees/recommended` (the `halfHourFee` is used, with a minimum of 1 sat/vB), and `POST /tx`.

**Building** (`buildBtcTx`):

1. Turns UTXOs into P2WPKH inputs with `witnessUtxo { script, amount }`. Segwit signing commits to input amounts, so a lying API can't trick the wallet into overpaying fees on segwit inputs.
2. Selects coins with `@scure/btc-signer`'s `selectUTXO(..., 'default', { feePerByte, changeAddress: own address, bip69: true })`. BIP-69 ordering stops input and output order from fingerprinting the wallet.
3. **Refuses fee rates above 500 sat/vB**, a guard against a malicious or broken fee API.
4. Only allows non-standard outputs when every one of them is a zero-value `OP_RETURN` (`0x6a…`) that the wallet built itself (`opReturnScript`, at most 80 bytes). Those are used for THORChain-style swap memos.
5. Signs every input, finalises, and returns the raw hex, txid and fee. Not enough funds gives a clear "Insufficient BTC" error.

**Receive privacy.** The wallet uses one address (index 0). Address rotation is a possible future improvement. P2WPKH reveals the public key only on the first spend.

`validateAddress('bitcoin', …)` decodes with mainnet parameters. It rejects testnet addresses, bad checksums and unknown output types.

---

## Address-poisoning protection (`looksLikePoisoned`)

Attackers send dust from vanity addresses that share the first and last characters with an address you have used, hoping you copy the wrong one from your history. When you review a send, the wallet compares the recipient with every counterparty in your activity history. If the first 6 and last 4 characters match an earlier address but the full address differs, it shows a prominent warning. Self-sends and Solana program-derived recipients are also warned about. Each of these three warnings requires an "I verified the full address" checkbox before hold-to-send is enabled. "First time sending to this address" is informational only and needs no checkbox.
