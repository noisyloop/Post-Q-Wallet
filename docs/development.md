# Development

## Requirements

- Node.js 22 and npm 10
- Chromium (via Playwright) and `ffmpeg`, only for regenerating screenshots and GIFs

## Setup and scripts

```bash
npm ci --ignore-scripts   # install exactly what the lockfile says, no install hooks
npm run dev               # Vite dev server on http://localhost:5173 (no CSP in dev)
npm run typecheck         # tsc -b (strict mode)
npm test                  # Vitest, 48 tests
npm run build             # typecheck + production build into dist/ (CSP injected)
npm run preview           # serve dist/ on http://localhost:4173
npm run media             # regenerate docs/media screenshots + GIFs (needs a build first)
```

To explore without funds, toggle **Demo mode** on the welcome screen, or open `/?demo` before creating a wallet.

## Configuration

Set these in `.env.local` (or in the environment at build time). Only `https://` values are accepted, and each one's origin is added to the CSP automatically.

| Variable | Default |
|---|---|
| `VITE_RPC_ETHEREUM` | `https://ethereum-rpc.publicnode.com` |
| `VITE_RPC_BASE` | `https://base-rpc.publicnode.com` |
| `VITE_RPC_ARBITRUM` | `https://arbitrum-one-rpc.publicnode.com` |
| `VITE_RPC_OPTIMISM` | `https://optimism-rpc.publicnode.com` |
| `VITE_RPC_POLYGON` | `https://polygon-bor-rpc.publicnode.com` |
| `VITE_RPC_BSC` | `https://bsc-rpc.publicnode.com` |
| `VITE_RPC_AVALANCHE` | `https://avalanche-c-chain-rpc.publicnode.com` |
| `VITE_RPC_SOLANA` | `https://solana-rpc.publicnode.com` |
| `VITE_BTC_API` | `https://mempool.space/api` (any Esplora-compatible API) |

**Never put API keys you consider secret in these variables.** Anything prefixed `VITE_` is compiled into the public bundle.

## Tests

| File | Covers |
|---|---|
| `tests/keyring.test.ts` | BIP-39/44/84 and SLIP-10 vectors, mnemonic validation, key wiping |
| `tests/vault.test.ts` | Round-trip, fresh salt and IV, wrong password, tampering, KDF downgrade, persistence, lockout schedule |
| `tests/solana.test.ts` | compact-u16, associated token addresses, SOL and SPL messages byte-identical to web3.js, signatures, third-party transaction signing rules |
| `tests/swap.test.ts` | Each validator rule, plus demo quotes passing all checks |
| `tests/security.test.ts` | Address validation for all families, poisoning detection, password rules, amount parsing, `maxSendable`, Bitcoin transaction building |
| `tests/launch.test.ts` | Launcher instructions byte-identical to the official SDKs, fee scheduler, PDAs, liquidity math, planner validation, transaction size, multi-signer ordering |

Vault tests use `N = 2^14` for speed. Production uses `2^17`, and the decoder still enforces the `2^14` minimum.

### Regenerating launcher fixtures

`tests/fixtures/launch-ref.json` holds instructions produced by the official SDKs from fixed keypairs. To regenerate it, for example after bumping the Meteora program version you target:

```bash
mkdir /tmp/ref && cd /tmp/ref && npm init -y
npm i --ignore-scripts @meteora-ag/cp-amm-sdk@1.5.1 @solana/web3.js@1.98.0 @solana/spl-token@0.4.9 \
  @metaplex-foundation/mpl-token-metadata@3.4.0 @metaplex-foundation/umi@1.2.0 \
  @metaplex-foundation/umi-program-repository@1.2.0
node <repo>/scripts/gen-launch-fixtures.cjs /tmp/ref > raw.json
```

Then copy `token`, `pool`, `sdkSqrtPrice`, `sdkLiquidity`, `baseFee`, `poolAddress`, `computePrice`, `closeWsol` and the three seeds into the fixture file. The SDKs stay in `/tmp/ref` and never enter the wallet's dependency tree.

## Media pipeline

`scripts/capture-media.mjs`:

1. Starts `vite preview` on port 4173. Run `npm run build` first.
2. **Screenshots:** one Chromium context at 390×844 @2x. It runs onboarding (demo), a home tour, a cross-chain swap, a send, a token launch, activity, settings and lock, and takes `docs/media/NN-*.png` at each step.
3. **GIFs:** separate contexts with `recordVideo`, reusing the vault from the screenshot run through `storageState` (activity and launches stripped). Each flow is replayed at human pace and converted with `ffmpeg` (14 fps, 360 px wide, a 160-colour palette with Bayer dithering) into `docs/media/*.gif`.

`data-testid` attributes in the UI exist mainly for this script. Keep them stable when changing screens.

## Extending the wallet

### Add an EVM chain

1. Add a `Chain` to `CHAINS` in `src/core/chains/registry.ts`: id, name, `evmChainId`, `lifiId` (normally the same), native symbol and decimals, RPC with a `VITE_RPC_*` override, explorer URL, and colour.
2. Add its native token, and USDC with the verified contract address and **its actual decimals**, to `TOKENS`.
3. Add the RPC host to `DEFAULT_CONNECT` in `vite.config.ts` if it isn't covered by `*.publicnode.com`.
4. Confirm the LI.FI Diamond is deployed at `0x1231DEB6…4EaE` on that chain. If it isn't, extend `TRUSTED_EVM_TARGETS` in `swap/validate.ts`, and add a test.

### Add a token

Add an entry to `TOKENS` with an address copied from the issuer's official source and checked on an explorer. Verify `decimals` on-chain, and set `priceId` to the CoinGecko id. The allow-list is a security control, so review token additions like code changes.

### Add a backend capability

1. Extend the `Backend` interface in `src/core/backend/types.ts`.
2. Implement it in **both** `live.ts` and `demo.ts`. Demo implementations should still run real validation, so the UI behaves the same in both modes.
3. Pass the `Signer` through. Never pass key material or the seed.

## Code conventions

- `src/core` must not import React or touch the DOM, apart from `localStorage`, which is passed in through the `Storage` interface for the vault.
- Amounts are `bigint` from parse to signature. Convert to `number` only for display.
- Every new code path that creates a signature should run inside `signer.withKey`, be behind a `HoldButton`, and have a validation step whose blockers disable confirmation.
- New protocol encoders need byte-for-byte tests against an official implementation.
