# Tools

Standalone utility scripts that are not part of the Next.js app runtime.

## `nsec-to-wif.mjs`

Offline converter that turns a Nostr `nsec` into a Bitcoin **WIF** (compressed, mainnet) private key so the underlying secp256k1 scalar can be imported into a Bitcoin wallet.

### Why this exists

A Nostr `nsec` is a 32-byte secp256k1 private key encoded in bech32 — the *same* curve and the *same* class of key Bitcoin uses. If anyone has ever sent on-chain Bitcoin to the address derived from your public key (a known footgun of on-chain "zaps"), your `nsec` controls those funds. Most Bitcoin wallets do not take an `nsec` directly; they take a WIF. This script does the conversion, locally, without exposing the key.

See the **Muggable** tool in this app for the broader recovery flow this script supports.

### Safety design

- **Stdin only.** The `nsec` is read from a hidden stdin prompt, so it never appears in `argv`, shell history, process listings, or scrollback.
- **Offline.** The script imports `nostr-tools`, `@scure/base`, and `@noble/hashes/sha256` — all local npm packages. It performs zero network I/O. Run it on an air-gapped machine for maximum safety.
- **No file output.** The WIF is printed to stdout only; nothing is written to disk by the script itself.
- **Deterministic.** The output is the standard `0x80 || privkey || 0x01` payload, base58check-encoded — the same WIF any conforming tool would produce.

### Usage

From the repo root:

```bash
node tools/nsec-to-wif.mjs
```

You will be prompted:

```
Paste your nsec (input is hidden), then press Enter:
```

Paste your `nsec1…`, press Enter. The script prints the corresponding compressed mainnet WIF and a one-line reminder of where to import it.

### Importing the WIF

Three known-good paths, in order of ease:

1. **BlueWallet** (mobile) — `Add Wallet → Import wallet`, paste the WIF. Auto-detects script type, including Taproot (P2TR). Easiest.
2. **Sparrow** (desktop) — `Tools → Sweep Privkey…`, paste the WIF, choose a destination, broadcast. Does not create a wallet file from the funded key.
3. **Electrum** (desktop) — `New/Restore → Standard wallet → Use public or private keys`. Prefix the WIF with the script type (`p2wpkh:`, `p2wpkh-p2sh:`, `p2pkh:`). Taproot single-key import is version-dependent.

Always **verify the derived address matches** the one Muggable shows before broadcasting anything.

### Warnings

- Treat the resulting WIF as equivalent in sensitivity to your `nsec`. Anyone with it can sweep the address.
- Once your `nsec` has been touched by an insecure tool, the on-chain address derived from it is **permanently sweepable** by anyone who saw the key. You cannot un-expose it. The practical mitigation is to stop accepting on-chain funds to that address and route zaps through Lightning.
- Never paste your `nsec` into a web page or an LLM chat. Run this script locally, in a terminal you control.
