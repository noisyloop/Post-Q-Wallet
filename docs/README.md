# Post-Q Wallet — technical documentation

These documents explain how the wallet works internally: what each module does, which bytes go on-chain, and why the security decisions were made the way they were. They are written for contributors, auditors and anyone deciding whether to trust the code.

| Document | Read it to understand… |
|---|---|
| [Architecture](architecture.md) | Module layout, the live/demo backend split, React state, data flow, and how a user action becomes a signed transaction |
| [Keys, vault and sessions](keys-and-vault.md) | How the recovery phrase is generated, encrypted, unlocked, held in memory and turned into per-chain keys |
| [Chains and signing](chains-and-signing.md) | How EVM, Solana and Bitcoin transactions are built, signed and broadcast, including the hand-written Solana encoder |
| [Cross-chain swaps](cross-chain-swaps.md) | The LI.FI integration end to end: quoting, the safety validator, approvals, execution and bridge tracking |
| [Token launcher](token-launcher.md) | The Solana memecoin launcher: both transactions instruction by instruction, the anti-sniper fee math, pool math and failure recovery |
| [Security model](security.md) | Threat model, every mitigation and where it lives in the code, browser hardening, supply chain, and known gaps |
| [Development](development.md) | Setup, scripts, tests and fixtures, the media pipeline, configuration, and how to add a chain or token |

## The wallet in one paragraph

Post-Q Wallet is a single-page React app that runs entirely in the browser. One BIP-39 recovery phrase gives you an EVM address (seven chains), a Solana address and a native-SegWit Bitcoin address. The phrase is stored only as an scrypt + AES-256-GCM ciphertext in `localStorage`. While the wallet is unlocked, the decrypted seed lives in one module-scoped variable. Private keys are derived from it at the moment of signing and zeroed straight afterwards. Balances come from public RPCs, and swaps are routed by LI.FI. Every LI.FI quote is re-checked by a local validator before it can be signed. The Solana token launcher builds its transactions by hand and is tested byte-for-byte against the official SDKs. A demo backend swaps out all network I/O for deterministic simulations, so the full UI can be explored, tested and screen-recorded without funds.

## Conventions used in these docs

- File references look like `src/core/vault.ts` and are relative to the repository root.
- "Raw units" means base units: wei, lamports, satoshis, or token units before decimals are applied.
- Amounts in code are always `bigint`. A JavaScript `number` is only used for display and USD estimates.
- **Live** means the mainnet backend (`src/core/backend/live.ts`). **Demo** means the simulated backend (`src/core/backend/demo.ts`).
