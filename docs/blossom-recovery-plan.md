# Blossom recovery plan

Status: draft, nothing built. Covers `dmnyc/mutable` and `dmnyc/lazarus`.

## Goal

Let a user find, keep and restore the Blossom blobs they have published, including old ones, and make profile restores aware of blobs that have gone missing.

## Where things belong

- **Lazarus** (spec and registry): recovering replaceable Nostr events from relay history. That includes the Blossom server list (kind 10063). It does not include blobs, which are not events and have no version history.
- **Mutable** (app): everything that talks to Blossom servers: uploads, listing, mirroring, downloading, inventory UI.

## Current state (verified in the code)

- `lib/imageUpload.ts` is the only Blossom code. It uploads using hardcoded server lists (`BLOSSOM_SERVERS_AUTHED`, `BLOSSOM_SERVERS_ANON`) with a signed kind 24242 auth event.
- Callers: `ProfileEditorModal.tsx`, `DMCircle.tsx`, `DraftableEditor.tsx`. Each keeps only the returned URL.
- Nothing reads kind 10063, calls `/list/<pubkey>`, or records blob hashes.
- `lib/lazarus/registry.ts` (spec 0.6.2-draft) has no kind 10063 entry.

## Phases

### Phase 1: Lazarus spec and registry, kind 10063

Repo: `dmnyc/lazarus`, then `dmnyc/mutable`.

1. Spec: add kind 10063 to the kind registry. Proposed profile:
   - tier: 2 (confirm against the spec's tier definitions)
   - ranking: `recency`
   - `meaningfulEmpty`: false
   - `requiredWarnings`: `stale-relays` (confirm whether a new `stale-servers` warning is better)
   - item count: number of `server` tags
2. Spec: add a non-normative note that blob storage is out of scope, with the reasons (content-addressed, no versions, servers may delete).
3. Bump the spec to the next draft version.
4. Mutable: add the entry to `lib/lazarus/registry.ts` and the display strings in `components/lazarus/format.ts` and `LazarusRecovery.tsx`, and update the "spec 0.6.2-draft" comments.
5. Tests: add registry and scan cases next to `tests/lazarus-core.test.ts`.

Done when: a user can scan for and restore an older Blossom server list through the existing review dialog.

### Phase 2: Use the user's own servers for uploads

Repo: `dmnyc/mutable`.

1. New `lib/blossomServers.ts`: fetch and cache the signed-in user's latest kind 10063, return normalized server URLs.
2. `uploadImageToBlossom`: when no `servers` option is passed and the user has a list, try those first, then fall back to the current defaults. Keep the existing cancel and aggregated-error behavior.
3. Tests: ordering, fallback, no list, malformed `server` tags.

Done when: uploads go to the user's own servers first, and behavior is unchanged for users without a list.

### Phase 3: Hash ledger

Repo: `dmnyc/mutable`. Small, and later phases depend on it.

1. `UploadResult` already returns a URL; also return the SHA-256 and size. They are already computed for the auth event.
2. Record each upload (hash, URL, server, time, purpose) in a local store and include it in the existing backup data so it survives a reset. Decide whether it also goes to relay storage (see `RELAY_STORAGE.md`).
3. Parse hashes out of Blossom-style URLs (64-hex filename) in a shared helper, reused in Phase 4.

### Phase 4: Blossom inventory in Backups

Repo: `dmnyc/mutable`.

1. `lib/blossomClient.ts`:
   - `listBlobs(server, pubkey, signer?)` calls `GET /list/<pubkey>`. If a server returns 401, retry with a signed kind 24242 `list` auth event.
   - `headBlob(server, hash)` checks whether a server still has a blob.
2. UI: a new section on the Backups page, with a chip in the existing jump-to nav. For each of the user's servers it shows thumbnail, hash, size, date and a reference marker. Servers that don't support listing are shown as "listing unavailable", not as empty.
3. Reference scan: gather image URLs from the current and archived kind 0 events, the user's recent kind 1 notes, and pack covers. Mark each blob as referenced or orphaned. Show referenced hashes that no listed server has as "missing".
4. Tests: client against mocked responses (200, 401 then 200, 404, malformed JSON, timeout); hash extraction.

Done when: a user can see what they have on each server, what is orphaned, and what their old events point to that is gone.

### Phase 5: Mirror and download

Repo: `dmnyc/mutable`. This is the first phase that writes to servers, so it comes after the read-only work.

1. Download one blob or all blobs as an archive, with a hash check against the filename.
2. Mirror a blob to another of the user's servers (BUD-04 `PUT /mirror`, falling back to download then re-upload).
3. Every write is an explicit click with a summary of what will be sent where, matching how Lazarus restores work.

### Phase 6: Profile restore integration

Repo: both.

1. Lazarus: define a warning type for "restored event references data that may no longer exist" (draft wording for the spec; optional for implementers).
2. Mutable: in the review dialog for a restored kind 0, check the picture and banner hashes with `headBlob`. If missing, show the warning and offer a re-upload from the local copy or from a mirror, if one exists.

## Order and dependencies

1 and 2 are independent. 3 comes before 4. 4 comes before 5 and 6. Ship 1 to 3 first; they are small and low risk.

## Open questions

- Which Lazarus tier and warning fit kind 10063? Needs a check against the spec text, which I have not read.
- Should the hash ledger sync through relay storage or stay in local backups only?
- Listing auth: which of the default servers (`blossom.band`, `blossom.nostr.build`, `nostr.download`) actually support `/list` today? Test each before designing the empty-state copy.
- Should the inventory look at servers the user doesn't list in 10063, such as old defaults?
- Notes scan depth: how many kind 1 notes to scan for image URLs before it gets slow.

## Out of scope

- A hosted archive of users' blobs.
- Deleting blobs from servers.
- Recovering blobs that no server still has.
