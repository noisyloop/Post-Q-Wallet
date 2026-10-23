# Security model

This document states what the wallet defends against, how, where in the code, and what it does **not** defend against.

## Assets and trust boundaries

| Asset | Where it lives | Who must never get it |
|---|---|---|
| Recovery phrase / seed | Encrypted in `localStorage`; decrypted only in `session.ts` memory while unlocked | Everyone, including RPCs, LI.FI, other sites and other extensions |
| Private keys | Derived per signature inside `withPrivateKey`, then zeroed | Same |
| Password | Typed into the unlock field; normalised and fed to scrypt; that buffer is zeroed | Same |
| Funds | On-chain | Anyone the user didn't intend to pay |
| Privacy (addresses, holdings) | Sent to RPCs and price APIs as needed | Third parties beyond those endpoints |

**Trusted:** the browser and OS, the wallet's own code as served, and the audited cryptography libraries.
**Untrusted:** every network response (RPCs, mempool.space, CoinGecko, LI.FI), pasted addresses, and anything in `localStorage` that the wallet didn't validate.

## Threats and mitigations

| # | Threat | Mitigation | Code |
|---|---|---|---|
| T1 | Someone copies the browser profile and brute-forces the vault offline | scrypt N=2¹⁷ (about 128 MiB per guess), AES-256-GCM, 32-byte salt; password rules (≥ 10 characters, mixed classes, no common words) | `vault.ts`, `security.ts#checkPassword` |
| T2 | Attacker with storage write access plants a weak vault | Blobs with N < 2¹⁴, r < 8 or p < 1 are refused; versioned associated data | `vault.ts#isBlob` |
| T3 | Password guessing through the UI | Exponential back-off after 3 failures, capped at 15 min | `vault.ts#recordUnlockFailure` |
| T4 | Unattended unlocked wallet | 5-min idle auto-lock wipes the seed; manual "Lock wallet now" | `session.ts` |
| T5 | Key material lingering in memory | Seed only in module scope (never React state); per-signature derivation; `fill(0)` in `finally` | `session.ts`, `keyring.ts#withPrivateKey` |
| T6 | Shoulder-surfing or screen capture of the phrase | Blurred until tapped; re-entering the password is required to show it again | `Onboarding.tsx`, `Settings.tsx` |
| T7 | Clipboard sniffing of the phrase | No copy for the phrase anywhere | UI |
| T8 | Malicious or compromised swap API | Quote validator: router allow-list, own-address delivery, echo match, chain id, exact approval, slippage floor, 60 s expiry, price impact; re-validated at signing; quote pinned | `swap/validate.ts`, `backend/live.ts` |
| T9 | Unlimited-approval drains | Approvals are always for the exact amount and only to the verified router | `chains/evm.ts#evmApproveRequest`, validator |
| T10 | Third-party Solana transaction that drains the account or requires other signers | Fee payer must be this wallet and it must be the only required signer | `chains/solana.ts#signSerializedTransaction` |
| T11 | Malicious PSBT | Every input must be the wallet's own script; external outputs ≤ quoted amount; fee ≤ 100k sats | `backend/live.ts#signBtcPsbt` |
| T12 | Fee-rate manipulation (Bitcoin) | Refuses > 500 sat/vB | `chains/bitcoin.ts#buildBtcTx` |
| T13 | Typos or wrong-network addresses | EIP-55 checksum, base58 + length (+ curve) check, bech32 mainnet decode; zero address refused | `security.ts#validateAddress` |
| T14 | Address poisoning | First-6/last-4 look-alike match against history, with a required acknowledgement | `security.ts#looksLikePoisoned`, `Send.tsx` |
| T15 | Accidental or clickjacked confirmation | 1.2 s press-and-hold for every value-moving action; app refuses to run in frames; `frame-ancestors 'none'` header | `HoldButton`, `main.tsx`, `public/_headers` |
| T16 | Script injection / third-party script compromise | Strict CSP: `script-src 'self'`, `default-src 'none'`; no remote scripts, fonts or images; React escaping; the only raw HTML is the locally generated QR SVG | `vite.config.ts`, `Receive.tsx` |
| T17 | Data exfiltration by injected code | `connect-src` limited to RPCs, LI.FI and CoinGecko | CSP |
| T18 | Supply-chain attack via npm | Small dependency set; exact version pins; committed lockfile; `ignore-scripts=true`; no `@solana/web3.js` in the bundle; `npm audit` in CI | `package.json`, `.npmrc`, CI |
| T19 | Spam or look-alike tokens | Static token allow-list; quotes must match registry addresses | `chains/registry.ts` |
| T20 | Crafted link makes a live wallet show fake (demo) balances | `?demo` only applies before a vault exists | `state.tsx#initialDemo` |
| T21 | Token-launch rug or insider risks | Mint authority revoked atomically; no freeze authority; immutable metadata; LP locked atomically; 100% supply in pool by default | `launch/*` |
| T22 | Half-finished launch loses funds or state | Simulate before send; confirm each step; resumable record; token balance re-checked on resume | `launch/execute.ts` |

## Browser hardening

### Content Security Policy

The production build (`vite build`) injects this policy as a `<meta>` tag through the `pqw-csp` plugin in `vite.config.ts`:

```
default-src 'none';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'self' https://*.publicnode.com https://mempool.space https://li.quest https://api.coingecko.com [+ VITE_RPC_* / VITE_BTC_API origins];
manifest-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'
```

Notes:

- `'unsafe-inline'` for styles is needed for React's `style={…}` attributes (avatars, progress bars). Scripts have no such allowance.
- The dev server (`npm run dev`) doesn't inject the CSP, because Vite's hot reload needs inline scripts. Always evaluate security against a production build (`npm run build && npm run preview`).
- A `<meta>` CSP can't set `frame-ancestors`. So `src/main.tsx` refuses to render when `window.top !== window.self`, and `public/_headers` (honoured by Netlify and Cloudflare Pages style hosts) sets `frame-ancestors 'none'`, `X-Frame-Options: DENY`, HSTS, `nosniff`, `Referrer-Policy: no-referrer` and a restrictive `Permissions-Policy`. On other hosts, configure the same headers.

### Other choices

- `<meta name="referrer" content="no-referrer">`, so explorer links leak nothing.
- All external links use `rel="noopener noreferrer"`.
- There is no `eval`, `new Function` or dynamic `import()` of remote code.

## Supply chain

Runtime dependencies (exact versions in `package.json`):

| Package | Why |
|---|---|
| `@noble/curves`, `@noble/hashes` | secp256k1, Ed25519, SHA-2, HMAC, scrypt (audited, zero-dependency) |
| `@scure/bip39`, `@scure/bip32`, `@scure/base`, `@scure/btc-signer` | Mnemonics, HD derivation, encodings, Bitcoin transactions (audited) |
| `viem` | EVM clients and encoding |
| `react`, `react-dom`, `lucide-react` | UI |
| `uqr` | Local QR-code SVG generation (zero-dependency) |
| `@fontsource-variable/inter` | Self-hosted font files |

Policies:

- `.npmrc` sets `save-exact=true` and `ignore-scripts=true`, so packages can't run install hooks.
- `package-lock.json` is committed, and CI uses `npm ci --ignore-scripts`.
- CI runs `npm audit --omit=dev --audit-level=high`.
- The Solana and Meteora protocol code is written in-house and **verified** against the official SDKs in tests. Those SDKs are installed only in a throwaway directory to regenerate fixtures.

## Privacy

- RPC providers see the wallet's addresses and the balance queries for them. Self-host or choose providers via the `VITE_RPC_*` variables to limit this.
- CoinGecko sees only the list of asset ids being priced.
- LI.FI sees swap requests, including both of the user's addresses.
- The wallet has no telemetry, analytics, crash reporting or accounts.
- Activity history and launch records are stored unencrypted in `localStorage`. They contain public on-chain data (hashes, amounts, counterparties), but on a shared device they reveal usage.

## Known gaps

Stated plainly, so nobody is surprised:

1. **Unaudited code.** Commission an independent audit before holding significant value.
2. **Live paths are untested against mainnet** from the build environment. Encoding is verified offline, but RPC behaviour, LI.FI response shapes and program acceptance have not been exercised.
3. **Browser-extension threat.** A malicious extension with access to this origin can read the DOM, including the password field and the revealed phrase. A dedicated browser profile, or a future extension or native build, reduces this.
4. **RPC-chosen fees on EVM.** viem fetches fee parameters from the RPC. A malicious RPC could inflate them. A future improvement is to cap fees against independent estimates and show them on the review screen.
5. **Swap calldata isn't decoded** (see [cross-chain-swaps.md](cross-chain-swaps.md#what-the-validator-cannot-see)).
6. **Memory wiping is best-effort** in JavaScript: strings are immutable and garbage-collected.
7. **Single address per chain.** There is no address rotation for Bitcoin privacy.
8. **The lockout counter is client-side** and can be cleared by anyone with storage access. The scrypt cost is the real protection.
