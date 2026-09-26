# Lazarus implementation plan (Mutable)

Target: [Lazarus spec 0.5.0-draft](https://github.com/dmnyc/lazarus/blob/main/SPEC.md).
Lazarus **supplements** the NIP-78 backups; it does not replace or merge with
them. Backups are the garage (snapshots Mutable wrote on purpose); Lazarus is
the seatbelt (whatever history relays still hold, even with no backup).

## Where Mutable is today

Mutable is where the core first came from, but `lib/followRecovery.ts` and
`lib/muteRecovery.ts` predate spec 0.3–0.5. Gaps against the spec:

| Spec requirement | Today | Gap |
|---|---|---|
| Scan relays: user's kind 10002 read **and** write, defaults, archival set | `session.relays` (write only) + `DEFAULT_RELAYS` + `KNOWN_RELAYS` (~25) | Read relays missing; archival set (`relay.ditto.pub`, `hist.nostr.land`) missing; `fetchRelayListFromNostr` takes `events[0]` unsorted |
| limit ≥ 50, page back with `until` | limit 10, no paging | Rewrite fetch |
| `count` profile = clobber detection (20% / 5 items / 24h episode / settled after 5 edits over 7 days) | "largest non-empty older than current" | Replace ranking (spec 0.4) |
| Private items: exact / estimated / flagged | decrypt-or-0; errors swallowed, so a failed decrypt reads as 0 private items | Add NIP-44/NIP-04 size estimate; stop swallowing decrypt errors |
| Delta: added/removed by `tag[0..1]`, shrink needs separate confirm, re-mute warning | count text only | New |
| Recover: re-read current before signing; `created_at = max(now, current+1)`; signer must be author; success on write relays, best effort to other responders; update local copy | `now`; publishes to write+KNOWN; mute store not updated | Fix all five |
| Kinds: T1 3, 10000; T2 0, 10003, 10044; T3 10002, 10050, 10006 | 3, 10000 | Add the rest |
| NIP-46 65,535-byte cap flagged per row | not handled | New |
| Report relay config with results | queried/responding counts | Show lists |

## Architecture

### 1. `lib/lazarus/` — port of the reference core

Port the Jumble reference implementation (`dmnyc/jumble-spark`, branch
`feat/lazarus-data-recovery-v2`, `src/services/lazarus/`) nearly verbatim.
It is already TypeScript, framework-free and spec-0.5 complete, with ~50
tests:

- `registry.ts`: `LAZARUS_REGISTRY` and `getLazarusKindProfile(kind)`. It is
  the single source of truth. No other module hardcodes kind semantics.
- `private-items.ts`: encryption detection (NIP-04 `?iv=` vs NIP-44), payload
  → plaintext length range → item-count range, and private tag parsing.
- `recovery.ts`: `rankLazarusCandidates`, clobber episodes, `groupLazarusCandidates`,
  `computeLazarusDelta`, `computeLazarusProfileChanges`,
  `buildLazarusRecoveryDraft`, `fitsLazarusRemoteRestore`, and the scan/page
  functions against an injected `LazarusRelaySource`.
- `adapters.ts` (Mutable-specific, the only file that imports `lib/nostr`):
  - `mutableRelaySource`: per-relay `pool.querySync` with a 6000 ms timeout,
    `limit: 50`, `until` cursors. It reports queried vs responding relays.
  - `getLazarusScanRelays(pubkey)`: kind 10002 read+write (fetched newest by
    `created_at` from defaults + known relays), then `DEFAULT_RELAYS`, then
    `LAZARUS_ARCHIVAL_RELAYS`.
  - `getLazarusPublishRelays`: `{ write, extra }` (write = NIP-65 write
    relays via `getBestRelayList`; extra = other responders).
  - `fetchLatestLazarusVersion(kind, pubkey)`: `limit: 1` on the write relays,
    for the pre-sign re-read.
  - `fitsNip46Request`: copy the helper from Jumble's `lib/nip46`.

Swapping the three Jumble imports (`client.service`, `getDefaultRelayUrls`,
`normalizeUrl`) for this adapter is the whole port. Keep the file layout
identical to Jumble so future spec bumps can be diffed across both.

Retire `lib/followRecovery.ts` and `lib/muteRecovery.ts` once the new section
ships. Keep their `valid hex p tag` filter as a **display** warning only:
recovery copies tags verbatim per spec. Drop `tests/{follow,mute}-recovery.test.ts`
in the same PR that adds the ported specs.

### 2. Private items

- Decrypt with the store signer (NIP-44, or NIP-04 when `?iv=` is present),
  but only for rows that are visible. Grouped rows decrypt on expand or
  review. On NIP-46, grouped rows decrypt only on review (one signer
  request each).
- Feed results through `applyLazarusPrivateTags` (a `Map<eventId, tags>`).
  Undecrypted rows keep the estimate range.
- Fix `decryptPrivateMutes` / `parseMuteListEvent` to **throw or return
  `undefined` on failure** rather than `[]`. Lazarus needs to tell a failed
  decrypt (estimated or flagged) from a truly empty private list. Audit the
  other callers (the My Mutes tab, backups) for that change.

### 3. UI: a "Data recovery" section

Keep it inside the Backups tab (`components/Backups.tsx`), replacing the
"List Recovery" block at L1576-1590. A new dashboard tab would mean edits
to the store union, `validTabs`, both navs, the mobile title map and
`DashboardNav`. That is avoidable churn, and recovery belongs next to
backups. Rename the block **"Recover from relay history (Lazarus)"** and
add one line explaining the difference from relay backups.

New components (replacing `FollowRecoverySection` and `MuteRecoverySection`):

- `components/lazarus/LazarusSection.tsx`: a kind picker built from
  `getLazarusKindProfiles()` (tiers 1-3, with tier 3 labelled "advanced").
  Keep the existing opt-in gate. Nothing scans until the user clicks.
- `LazarusScanResult.tsx`:
  - Summary, and relay lists in a disclosure: queried, answered, archival.
  - Newest-first list with a size-order toggle for count kinds.
  - Recommended row pinned at the top.
  - Groups for runs of small edits and clobber episodes; episodes are
    labelled.
  - Past empty versions hidden behind "show N empty versions" and never
    restorable.
  - A "Load older versions" button while `olderCursors` is non-empty.
- `LazarusCandidateRow.tsx`:
  - Timestamp.
  - Count, one of: exact, `min–max` estimated, or "partially counted".
  - Found-on relays.
  - Badges: Current, Recommended, Empty/"clobber" (a meaningful label for
    10044), and "too large for remote signer".
- `LazarusReviewDialog.tsx`: replaces `confirm()`.
  - Delta: +N/−M with expandable item lists. Profiles show per-field diffs
    for kind 0.
  - Warnings from `requiredWarnings`:
    - Re-mute warning and "moderation action on your behalf" for 10000.
    - Stale-relay warning for 10002/10050, with an optional liveness ping of
      candidate relays.
  - A second, distinct confirmation step when `delta.shrinks`.
  - For 10044: an intent question with both endpoint meanings; nothing is
    pre-selected.
  - The publish button names what will be published ("Publish follow list
    from 12 Sep 2026 (812 follows)").
  - Private-items-uncounted notice when `delta.privateUnknown`.
- View-only sessions can scan but not restore. Restore is hidden if
  `signer` is null or the signer's pubkey ≠ `session.pubkey`.

### 4. The restore click (one event, one signer call)

1. Snapshot the current version locally with `backupService`, as today, and
   pass `eventId` this time. This is the integration point with backups: the
   version about to be replaced is always saved first.
2. `fetchLatestLazarusVersion`. If its id ≠ the reviewed current, recompute
   the delta and reopen the dialog.
3. Verify `await signer.getPublicKey() === session.pubkey`. Check again after
   signing, in case the account changed during approval.
4. `buildLazarusRecoveryDraft(chosen, { current })`, then `signer.signEvent`.
5. Publish to `write` (success = at least one write relay accepts), then
   `extra` best-effort. Per-relay results come from `publishEventToRelay`.
6. **Update local state:**
   - 10000: `setMuteList(parseMuteListEvent(signed))`.
   - 3: refresh the follow cache.
   - 10003/10001/10015: invalidate the list caches.
   - 0: refresh the profile.
   - 10002: `session.relays` / `relayListMetadata`.
   Then re-rank with the published event merged in. A full re-scan is
   optional.

### 5. Relationship to NIP-78 backups

- **No mixing of formats.** Lazarus never reads or writes kind 30078, and
  backups never feed the ranking.
- Cross-link: the relay backup restore shows "Also check relay history →".
  A Lazarus result with no recommendation mentions any existing relay or
  local backup for that kind.
- The backup restore paths (`handleRestoreFromRelay`, `handleRestoreBackup`)
  should adopt the two safety rules Lazarus made explicit:
  - Date the event `max(now, current.created_at + 1)`.
  - Re-read current before publishing.
  
  Put these in shared helpers used by both.
- Optional, later: expose local backups as a labelled `HistorySource`, per
  the spec's future-work section, behind a flag. Not in v1.

## Delivery (PRs)

1. **Core port + tests.** Add `lib/lazarus/*`, the ported Jumble specs, and
   an adapter test using the `getPool` mock pattern from
   `list-backup-roundtrip.test.ts`. No UI change.
2. **Tier 1 UI.** Kinds 3 and 10000 on the new components: delta dialog,
   paging, grouping, local state update. Remove the old recovery modules and
   components. Fix decrypt error swallowing.
3. **Tier 2.** 0 (field diff), 10003, 10044 (intent flow).
4. **Tier 3.** 10002 (with liveness check), 10050, 10006.
5. **Backup hardening.** Shared `created_at` / re-read helpers in the backup
   restore paths, cross-links, and README/RELAY_STORAGE docs.
6. **Version bump** (`chore: bump version to 1.9.0`).

## Tests (conformance)

- Ported vectors, covering:
  - Ranking: tombstone, meaningful-empty, partially counted, private
    estimate, gradual curation, clobber episode, settled.
  - Delta: relay hint/petname invariance, relay list markers.
  - Paging: inclusive `until`, a relay that ignores `until`.
  - Draft `created_at`.
  - NIP-46 fit.
- Mutable-specific:
  - Adapter scan relays include read relays and the archival set.
  - Restore aborts and re-asks when the re-read differs.
  - Restore refuses a signer pubkey mismatch.
  - The mute store updates after restore.
- When the Lazarus repo publishes shared JSON vectors or a `conformance()`
  helper, switch to importing them.

## Open questions

- Should `nostrArchives.ts` (`naEvents`) be a scan source? It is a search
  service, not a relay, so it would need to be a labelled extra source.
- Extract `lib/lazarus` into the reference npm package the spec describes,
  and have Mutable, PvZ and Jumble depend on it? That is preferable once the
  spec reaches 1.0; until then, keep copies in sync by file layout.
