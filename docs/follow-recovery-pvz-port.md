# Follow List Recovery — Plebs vs Zombies Port Plan

This document captures how to port the **Follow List Recovery** feature
(originally built for Mutable in `lib/followRecovery.ts` +
`components/FollowRecoverySection.tsx`) to the **Plebs vs Zombies** Vue
codebase. It is a sibling to the Mutable implementation, not a copy — the
core algorithm is identical, but the integration shape is different
(Vue 3 + NDK / nostr-tools, LocalForage persistence).

## What this feature does

An **opt-in** tool that scans a user's relays (plus a broad archival set)
for historical `kind:3` follow list events, presents every distinct version
observed, and lets the user republish a previous one. Designed for the
scenario where another Nostr client wrote a partial / empty contact list
and overwrote the good one — the most common way a follow graph is lost.

Selection rule for the recommended pick:
1. Sort all distinct versions by **follow count DESC**.
2. Break ties by **`created_at` DESC** (most recent wins among equal-sized).
3. Only recommend a candidate that is **strictly larger** than the user's
   current (most-recent-by-`created_at`) follow list. Otherwise, surface
   "no recoverable version found" rather than recommending a downgrade.

Tombstones (zero-follow events) are kept in the candidate list for
transparency but never recommended.

## Files in the Mutable reference implementation

| Path | Purpose |
|------|---------|
| `lib/followRecovery.ts` | Pure logic: scan + rank + recover (no React) |
| `components/FollowRecoverySection.tsx` | UI: opt-in gate, scan, candidate list, restore button |
| `tests/follow-recovery.test.ts` | Vitest cases pinning the ranking rules |

The pure-logic file has **no Mutable-specific imports** beyond
`@/lib/nostr` (relay constants + `getPool` + `signEvent`) and `@/types`
(`FOLLOW_LIST_KIND`). Both are easy to swap.

## Porting to Plebs vs Zombies (Vue / nostr-tools + NDK)

### 1. Core module (`src/lib/followRecovery.js` or `.ts`)

Lift `lib/followRecovery.ts` essentially verbatim. Replace:

- `getPool()` → either reuse PvZ's existing `SimplePool` singleton, or
  create one inline. PvZ already uses `nostr-tools`, so `SimplePool`
  is available.
- `signEvent()` → call NIP-07 directly (`window.nostr.signEvent`) since
  PvZ requires NIP-07. There's no in-app signer abstraction to bridge.
- `DEFAULT_RELAYS` / `KNOWN_RELAYS` → import from PvZ's relay config
  (`src/config/relays.js` or wherever the default list lives).
- `normalizeRelayList()` → small helper, inline if not already present.

The functions to keep unchanged in shape:

- `scanFollowListHistory(pubkey, userRelays, opts)`
- `rankFollowListCandidates(candidates)` (pure)
- `pickRecommendedRecovery(candidates, current)` (pure)
- `recoverFollowList(candidate, relays)`

The exported types (`FollowListCandidate`, `FollowRecoveryScanResult`,
`ScanOptions`) translate 1:1 to JSDoc typedefs if PvZ is plain JS.

### 2. Vue component (`src/components/FollowRecovery.vue`)

PvZ uses Vue 3 single-file components. Port the React component to
roughly this shape:

```vue
<template>
  <section class="follow-recovery">
    <header>
      <h2>Follow List Recovery</h2>
      <p>…opt-in framing…</p>
    </header>

    <div v-if="!optedIn" class="opt-in">
      <!-- warning bullets + "I understand" button -->
    </div>

    <template v-else>
      <button :disabled="scanning" @click="scan">
        {{ result ? 'Re-scan relays' : 'Scan for recoverable versions' }}
      </button>

      <p v-if="progress">{{ progress }}</p>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="successMessage" class="success">{{ successMessage }}</p>

      <div v-if="result">
        <section v-if="result.recommended">
          <h3>Recommended recovery</h3>
          <CandidateRow
            :candidate="result.recommended"
            :restoring="restoring === result.recommended.eventId"
            @restore="recover(result.recommended)"
          />
        </section>

        <p v-else-if="result.current">
          No older version was found larger than your current list
          ({{ result.current.followCount }} follows).
        </p>

        <details v-if="result.candidates.length">
          <summary>Show all {{ result.candidates.length }} versions</summary>
          <CandidateRow
            v-for="c in result.candidates"
            :key="c.eventId"
            :candidate="c"
            :restoring="restoring === c.eventId"
            @restore="recover(c)"
          />
        </details>
      </div>
    </template>
  </section>
</template>

<script setup>
import { ref } from 'vue';
import {
  scanFollowListHistory,
  recoverFollowList,
} from '@/lib/followRecovery';
import { useAuthStore } from '@/stores/auth';        // adapt to PvZ
import { useBackupStore } from '@/stores/backup';    // adapt to PvZ

const auth = useAuthStore();
const backups = useBackupStore();

const optedIn = ref(false);
const scanning = ref(false);
const progress = ref('');
const result = ref(null);
const error = ref(null);
const restoring = ref(null);
const successMessage = ref(null);

async function scan() {
  scanning.value = true;
  error.value = null;
  result.value = null;
  try {
    result.value = await scanFollowListHistory(
      auth.pubkey,
      auth.relays,
      { onProgress: (m) => (progress.value = m) },
    );
  } catch (e) {
    error.value = e?.message || 'Failed to scan follow list history';
  } finally {
    scanning.value = false;
    progress.value = '';
  }
}

async function recover(candidate) {
  if (!confirm(
    `Restore ${candidate.followCount} follows from `
    + `${new Date(candidate.createdAt * 1000).toLocaleString()}?`
    + ` This replaces your current follow list.`,
  )) return;

  restoring.value = candidate.eventId;
  error.value = null;
  successMessage.value = null;
  try {
    // Snapshot current list to PvZ's local backup store before overwriting,
    // mirroring what the Mutable section does via backupService.
    if (result.value?.current) {
      await backups.saveFollowListBackup(
        result.value.current.followPubkeys,
        `Auto-snapshot before Follow Recovery (event ${result.value.current.eventId.slice(0, 8)})`,
      );
    }
    await recoverFollowList(candidate, auth.relays);
    successMessage.value = `Restored ${candidate.followCount} follows.`;
    await scan();
  } catch (e) {
    error.value = e?.message || 'Failed to publish recovered follow list';
  } finally {
    restoring.value = null;
  }
}
</script>
```

`CandidateRow` is a thin presentational component — copy the row JSX from
`FollowRecoverySection.tsx`, drop into a Vue template. Show
`followCount`, formatted `createdAt`, truncated `eventId`, count of
`foundOnRelays`, and the badges (Recommended / Current / Empty).

### 3. Placement in the PvZ UI

PvZ's main views (per the README) are oriented around the Zombie scan and
Resurrector. Two reasonable options:

- **Inside Resurrector** (recommended): Resurrector already deals with
  recovering things, so Follow Recovery is conceptually adjacent. Add as
  a labeled section under the existing recovery UI.
- **New top-level route** (`/recovery` or `/follow-recovery`): more
  prominent, but adds nav surface. Use this if Resurrector's scope is
  meaningfully different.

In Mutable, the equivalent decision was to slot it inside the **Backups**
tab. PvZ doesn't have a Backups tab in the same form; Resurrector is the
closest fit.

### 4. Snapshot-before-restore

Mutable saves a local snapshot of the current follow list via
`backupService.createFollowListBackup` immediately before publishing the
recovered version. PvZ uses **LocalForage** for local persistence — wire
the equivalent (likely `backupStore.saveFollowListBackup` or a direct
LocalForage write). This is important: it gives the user a rollback path
if they regret the restore.

### 5. NDK vs nostr-tools

PvZ uses both `@nostr-dev-kit/ndk` and `nostr-tools`. The
`scanFollowListHistory` implementation in `lib/followRecovery.ts` uses
**`SimplePool` from nostr-tools** specifically because we want per-relay
attribution (which relay returned which event id). NDK's aggregated
subscriptions blur that.

Stick with `SimplePool` for the scan, even if the surrounding PvZ code
uses NDK elsewhere. Publishing the recovered event can use either — but
nostr-tools `pool.publish` matches the pattern in
`recoverFollowList`.

### 6. Test parity

Port `tests/follow-recovery.test.ts` to PvZ's test runner (PvZ uses
Vitest by default for Vite-based projects). The pure-logic tests
(`rankFollowListCandidates`, `pickRecommendedRecovery`) need no
adaptation — they only depend on the `FollowListCandidate` shape.

## Algorithm summary (one-screen reference)

```
scanFollowListHistory(pubkey, userRelays):
    relays = dedup(userRelays + DEFAULT_RELAYS + KNOWN_RELAYS)
    candidatesById = {}
    for each relay in parallel:
        events = querySync([relay], { kinds: [3], authors: [pubkey], limit: 10 })
        for each event:
            entry = candidatesById[event.id] or new candidate
            entry.foundOnRelays += relay
    sort candidatesById by created_at DESC
    current = first candidate (or null)
    recommended = pickRecommendedRecovery(candidatesById, current)
    return { current, candidates, recommended, queriedRelays, respondingRelays }

pickRecommendedRecovery(candidates, current):
    ranked = candidates filtered by followCount > 0, sorted by
             (followCount DESC, created_at DESC)
    for each c in ranked:
        if c.eventId == current.eventId: skip
        if c.followCount > current.followCount: return c
    return null

recoverFollowList(candidate, relays):
    tags = candidate.event.tags filtered to ['p', hex_pubkey, ...]
           (preserves original order + any per-tag metadata)
    event = sign({ kind: 3, tags, content: candidate.event.content, created_at: now })
    publish(event, relays)
```

## Origin

This feature was inspired by
[`barrydeen/wisp-ios#185`](https://github.com/barrydeen/wisp-ios/pull/185),
which implemented an automatic version of the same recovery flow. The
Mutable + PvZ ports are **opt-in only** — no automatic restoration.
