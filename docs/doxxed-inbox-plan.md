# Doxxed Inbox — plan

> **Status: shipped** (plus refinements beyond this plan). What changed during
> implementation: the tab defaults to **Threads** (one collapsible conversation
> per counterparty, messages oldest-first inside, threads ranked by last
> message) with a **Chronological** toggle for the flat view; every envelope
> row carries a metadata/raw-JSON expander (full public event snapshot, tag
> chips, ciphertext dump); profiles for names are fetched lazily per visible
> scope and expanding a thread deep-fetches its full history via targeted
> authors+#p queries (see `lib/dmEnvelopes.ts`); the scan now profiles **all**
> contacts via `fetchProfilesBulk` instead of the old top-50 cap.


## Concept

A fourth Snoopable tab that lists every DM envelope involving the target as one
chronological inbox, newest first. The pitch, in one line: **the inbox your
relays already leak — with only the contents hidden.** Each row shows what a
NIP-04 (kind:4) event makes public: when it arrived, who the other party was,
which direction it traveled, how big the ciphertext is, which client sent it,
whether it was a reply, and whether it was set to disappear. Nothing new is
exposed; the point is that "private messages" being encrypted hides far less
than people assume, and a familiar inbox layout makes that visceral in a way
the heatmap and leaderboard don't.

## Data

No new relay fetches. `analyzeDMMetadata` already captures per-message
envelopes (`DMMessageMeta[]` on each `DMActivityDay` in `analysis.heatmapData`).
The tab is a pure client-side projection:

1. Flatten `heatmapData[].messages` into one array.
2. Sort by `createdAt` descending (stable: break ties by `eventId`).
3. Render with client-side pagination.

### Data gaps to handle

- `messages` is optional per day. If the scan predates per-message capture (or
  a relay returned aggregates only), those days contribute nothing. If **no**
  day has messages, show an empty state: "This scan didn't capture individual
  messages — re-run the analysis to build the inbox." Same copy as the heatmap
  drill-down's fallback, for consistency.
- `counterparty` can be empty (malformed event) → render "unknown", disabled
  profile link.

### Scope note (verified against `generateDMHeatmapData`)

The heatmap's 12-month window is a *rendering* choice in `DMHeatmap`; the
`heatmapData` buckets contain every event the fetch returned, each with its
full `messages` array. So flattening `heatmapData[].messages` yields the
complete fetched history, not just the visible year — no lib changes needed.
The real bound is the fetch cap: `fetchDMMetadata(limit = 500)` per direction,
so the inbox holds at most ~1000 envelopes from a default scan. Header copy
should say "from this scan" rather than "all time" so the count isn't
misread; raising the limit for inbox users is a possible v2 (relay cost and
the mobile-safe batch limits are why it isn't v1).

## UI

- New tab, **Inbox**, after Circle / Leaderboard / Heatmap in `Snoopable.tsx`
  (`activeTab` union gains `"inbox"`). Mounts a new `components/DMInbox.tsx`.
- Header row: total count ("847 messages, newest first") and, once pagination
  is active, a "showing first N" note.
- Rows reuse the heatmap drill-down row anatomy — direction arrow
  (↑ sent purple / ↓ received pink), timestamp, counterparty name button
  (opens the existing `UserProfileModal` via `onSelectPubkey`), ciphertext-size
  bar + byte count, client tag, ↩ reply marker, ⏳ expiration marker. On mobile
  the size bar is already hidden (`hidden sm:block`) and the client tag is
  `hidden md:inline`; keep exactly that.
- Grouping aid: a slim sticky day divider ("Mar 7") between date changes, so
  an inbox of hundreds of rows stays readable without recomputing dates per
  row. Divider shows the day's sent/received split.
- Footer note, same privacy framing as the drill-down: contents stay
  encrypted; everything shown is public envelope metadata; sizes are
  ciphertext bytes.

## Pagination

Client-side, "Show more" pattern (matches `BlobTile`'s `visibleCount` and
`DMLeaderboard`'s show-all, no router involvement):

- Page size 100. Initial render: 100 rows + a "Show 100 more (of 847)" button.
  Repeat until exhausted; the button disappears on the last page.
- Scrolling is the page's own scroll — no inner scroll container (the
  heatmap drill-down's `max-h-80` box is right for 30 rows of one day, wrong
  for an inbox).
- Rendering 100 rows is trivial; no virtualization needed. If a hoarder
  account produces 10k+ envelopes, the "Show more" gate keeps DOM size
  proportional to what the user actually read. Revisit only if profiling
  says otherwise.

## Filters (explicitly out of scope for v1)

Direction and counterparty filters are natural follow-ups (the data is one
`.filter()` away) but v1 ships the unfiltered inbox: sequential, recent first,
paginated — exactly the spec. Add filters only if the tab proves useful.

## Known limitation

The inbox can only show what the scan fetched — up to `limit` (500) envelopes
per direction from `fetchDMMetadata`. Header copy states "from this scan" so
the total is never mistaken for the account's full DM history. A
full-history inbox (pagination into relay paging or a raised limit) is a
possible v2 behind the same component.

## Files touched

| File | Change |
| --- | --- |
| `components/DMInbox.tsx` | new — the inbox list, dividers, pagination |
| `components/Snoopable.tsx` | add `"inbox"` to `activeTab`, tab button, mount, pass flattened data |
| `types/index.ts` | no change (`DMMessageMeta` already fits) |
| `lib/nostr.ts` | no change in v1 |
