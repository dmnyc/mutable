# Muggable Plan

> **Muggable** is the user-facing name for this feature. The precise technical
> concept is *key exposure* via *key sweep* — that language is kept in code,
> types, and APIs (`keyExposureService`, `ExposureReport`). "Muggable" is the
> brand in UI copy and docs headings.

## Goal
Add **Muggable** — a key-exposure check — to Mutable: given a Nostr identity (npub / nprofile / NIP‑05 / hex), surface whether that identity's public key also controls **Bitcoin** on‑chain. The point is defensive awareness — a Nostr key is an secp256k1 key, so an `nsec` is also a Bitcoin private key. Users should be able to see this risk for their own account, the same way Mutable already helps them audit their mute footprint.

## Background
A Nostr pubkey is a 32‑byte x‑only secp256k1 key. The same key maps to spendable Bitcoin addresses. The dominant, real‑world surface is the **canonical BIP341 Taproot key‑path address**: the address encodes the *tweaked* output key `Q = P + tagged_hash("TapTweak", P)·G`, **not** the raw internal key. Naive "nostr = bitcoin" demos that encode the raw x‑only key as a P2TR program look at the wrong (always‑empty) address and conclude there is nothing there. Encoding the canonical tweaked key reveals that many identities hold real sats.

This was validated against the OPENETR reference app: internal key `0461fcbe…` → tweak `1619853a…` → output key `637b9141…` → `bc1pvdaezs0…`, a live, actively‑used wallet. The reference implementation reproduces those exact values (regression‑locked in its `--selftest`).

## Proposed Feature
- Input: any identity Mutable already understands (npub, nprofile, NIP‑05, bare domain, hex). Reuse the existing `nostr-tools` / `bech32` decode path in `lib/utils/nostrHelpers.ts` — do **not** re‑implement bech32.
- Derive candidate Bitcoin addresses from the x‑only key and report any balance.
- Primary, must‑have derivation: **canonical BIP341 key‑path P2TR**. Secondary (completeness): P2PKH/P2WPKH/P2SH‑P2WPKH for both Y‑parities, and uncompressed P2PKH.
- **Full balance history for any key.** For every address with activity, walk the *complete* on‑chain history and present a per‑transaction ledger: date, signed delta, and a **running balance**. This is not a single snapshot — the whole timeline is shown.
- **Explorer links everywhere.** Every derived address and every transaction links out to the configured block explorer (mempool.space by default): `…/address/<addr>` and `…/tx/<txid>`. Users can verify and dig in independently.
- Read‑only and key‑safe: only the **public** key and **public** chain data are ever touched. This preserves Mutable's "client‑side only, no private keys" principle.

## Derivation Notes
- The BIP341 tweak needs secp256k1 point math. In the TS port use a vetted library (**`@noble/curves/secp256k1`**, or the curve primitives already vendored by `nostr-tools`). Do not hand‑roll EC in production — the Python prototype hand‑rolls it only because it is stdlib‑only.
- Y‑parity of a Nostr x‑only key is unknown to Bitcoin, so every hash160‑based type has two candidates (`0x02`/`0x03`). Taproot is parity‑independent.

## Data Source for Balances (Choose One or Combine)
1) **Esplora API** (`mempool.space` / `blockstream.info`) — same source as the reference app. `GET /api/address/<addr>` for balance; `GET /api/address/<addr>/txs/chain[/<last_txid>]` (25 at a time, paginate to walk the *full* history) plus `…/txs/mempool` for pending. The web link base is the API base minus `/api`. Pros: accurate, no key. Cons: third‑party, rate limits, privacy of lookups (see below).
2) **User‑configurable Esplora endpoint** — let advanced users point at their own instance. Pros: privacy, no shared rate limit. Cons: setup friction.
3) **Bundled multi‑explorer fallback** — rotate explorers on failure/limit. Pros: resilience. Cons: more surface to maintain.

## UI Placement
- A new **Muggable** card in the analysis surface (alongside Mute‑o‑Scope), and a non‑blocking **"Muggable" safety badge** on the signed‑in user's account area when their key holds funds.
- Example summary: "⚠ Muggable — your key controls Bitcoin: 0.00500171 BTC across 2 addresses (canonical Taproot + legacy). An exposed nsec can be swept."
- Always show: derived address(es), per‑address balance + tx count, the derivation type, and the balance source + fetch time (mirror the transparency ethos of `mute-signal-plan.md`).
- Each address row links to the explorer and expands into its **full transaction ledger** (date, ± delta, running balance, per‑tx explorer link). Default collapsed; expand on demand so the card stays scannable for high‑activity keys.

## UX Flow
- On lookup: resolve identity → derive addresses → query balances → render card.
- Signed‑in self‑check is the headline use case: frame it as a **warning to the user about their own exposure**, with a short explainer and a "how to protect yourself" link.
- If balances can't be fetched: show derived addresses with balance "—" and a retry, never a hard error.

## Data Model / State
- New service `lib/keyExposureService.ts`: `deriveAddresses(xonlyHex) -> {type,address}[]` and `getExposure(identity) -> ExposureReport`.
- `ExposureReport`: `{ input, resolvedVia, pubkeyHex, npub, addresses: AddressReport[], totalSats }`.
- `AddressReport`: `{ type, address, addressUrl, confirmedSats, unconfirmedSats, txCount, history?: LedgerEntry[] }`.
- `LedgerEntry`: `{ txid, txUrl, confirmed, height, time, deltaSats, runningSats }` — ordered oldest→newest so `runningSats` reconciles to the reported balance.
- Component state for the card: `report | null`, `loading`, `source`, `fetchedAt`.

## Security, Ethics & Privacy
- **Self‑check first.** The primary, recommended framing is helping users discover *their own* exposure. This is consistent with Mutable being an account‑hygiene tool.
- **Dual‑use.** Looking up arbitrary identities reveals their on‑chain balance. This is public data, but aggregating it into a one‑click "is this person holding sats" tool is sensitive. Scope decision needed (see open questions): gate arbitrary lookups, rate‑limit, or self‑only.
- **No private keys.** The feature must never request or handle an `nsec`. Public key + public chain only.
- **Lookup privacy.** Address queries leak the looked‑up identity to the explorer. Document this; consider the user‑configurable endpoint (data source option 2).

## Reference Implementation
`docs/prototypes/nip05-btc-balance.py` — a working, stdlib‑only Python prototype that this feature ports from. It implements identity resolution (NIP‑05/npub/nprofile/hex), all derivations above, the canonical BIP341 tweak, Esplora balance lookup, explorer links for every address/tx, and (via `--history`) the full paginated per‑address ledger with a running balance. Its `--selftest` is regression‑locked to BIP173 vectors **and** the OPENETR Taproot vector — port the test vectors verbatim into `tests/`.

## Implementation Steps (Future Work)
1) Add `@noble/curves` (or confirm `nostr-tools` exposes the needed primitives).
2) Port `deriveAddresses` to `lib/keyExposureService.ts`, reusing existing identity decode helpers.
3) Port the prototype's selftest vectors into a `vitest` spec in `tests/` (BIP173 + OPENETR BIP341).
4) Add Esplora client with a configurable endpoint + graceful failure, incl. paginated tx history and explorer link building.
5) Build the Muggable card + signed‑in safety badge, with per‑address explorer links and an expandable full‑history ledger (running balance).
6) Resolve the dual‑use scope decision before exposing arbitrary‑identity lookup in the UI.
7) Add explainer copy + a "protect your key" help link.

## Open Questions
- Arbitrary‑identity lookups: allow, gate, or self‑only for v1?
- Default Esplora endpoint, and do we ship a fallback rotation?
- Surface this passively (badge only) or as a full analysis card from launch?

## Notes
- Balances are live; an actively‑used wallet's number changes between snapshots. Always show fetch time; never imply precision beyond the snapshot.
- The canonical Taproot address is the one that matters in practice — legacy/segwit derivations are included for completeness but are usually empty.
