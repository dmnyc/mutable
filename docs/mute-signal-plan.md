# Mute Signal Plan (Issue #13)

## Goal
Add a “mute signal” metric to Mute‑o‑Scope: the ratio of public mute list hits to total notes posted by the target. This should be clear, transparent about data quality, and avoid misleading precision.

## Proposed Definition
- **Mute signal** = `public_mute_list_count / total_notes_posted`
- Display as a percentage and as “X mutes per 1,000 notes”.
- Include a short helper text noting data source/limitations.

## Data Sources for Total Notes (Choose One or Combine)
1) **User‑provided total notes**
   - UI: optional input field in Mute‑o‑Scope (e.g., “Total notes posted”).
   - Pros: simple, accurate if user trusts their client.
   - Cons: manual; not verifiable.

2) **Relay NIP‑45 COUNT (estimate)**
   - Query relays for `COUNT` on kinds `[1]` and optionally `[1]` split by replies (presence of `e` tag).
   - Use a relay subset that supports `COUNT` to avoid timeouts; fall back gracefully.
   - Pros: automated; no external dependencies.
   - Cons: many relays don’t support count; results are partial/incomplete.

3) **External API (Primal or other indexer)**
   - Use a public API that returns total note/reply counts by pubkey.
   - Pros: likely most accurate.
   - Cons: dependency on third‑party API, availability, rate limits.

## UI Placement
- Add to the **results summary header** in Mute‑o‑Scope near “Mute Score”.
- Example:
  - “Mute Signal: 0.37% (3.7 / 1,000 notes)”
  - Subtext: “Based on public mute lists and total note count from [source]”.

## UX Flow
- When a user runs a search, show:
  - Mute list count (existing)
  - Mute score (existing)
  - Mute signal (new)
- If no note count is available:
  - Show placeholder: “Mute Signal: —”
  - Provide “Add total notes” (manual input) link if manual mode is enabled.

## Data Model / State
- Add state in `components/Mute-o-Scope.tsx`:
  - `noteCountSource` ("manual" | "relay" | "api" | null)
  - `totalNotes` (number | null)
  - `muteSignal` (number | null)
- Compute on results change or note count update.

## Error Handling + Transparency
- Always display data source + last updated timestamp if available.
- If relay count fails, fall back to manual input.
- If API fails, show a non-blocking warning and allow manual override.

## Implementation Steps (Future Work)
1) Pick the total note source (manual, relay count, or API).
2) Add state + computation in `components/Mute-o-Scope.tsx`.
3) Add UI element in Mute‑o‑Scope results header.
4) Add helper text + tooltip for limitations.
5) (Optional) Add advanced settings to prefer one source.
6) Test with low/high mute counts and missing totals.

## Notes
- Nostr does not define a canonical “total notes” count across the network.
- Any automated number should be treated as an estimate.
- Mute signal should be labeled clearly to avoid false precision.
