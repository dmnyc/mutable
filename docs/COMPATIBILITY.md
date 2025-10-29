# Nostrguard & Mutable Compatibility

## Overview

Both **mutable** and **nostrguard** use Nostr kind 30001 events for community mute/scammer packs. This document explains their compatibility and how mutable now supports both formats.

## Format Comparison

### Common Elements (✅ Compatible)
- Both use **kind 30001** (parameterized replaceable list)
- Both use `["d", identifier]` for unique ID
- Both use `["description", ...]` for description text
- Both use `["t", category]` for category tags
- Both use `["p", pubkey]` for the actual pubkeys to mute
- Both support multiple categories

### Differences

| Feature | Nostrguard | Mutable |
|---------|-----------|---------|
| **Display Name Tag** | `["title", "Pack Name"]` | `["name", "Pack Name"]` |
| **Namespace** | None | `["L", "mutable"]` |
| **Category Marker** | None | `["l", "community-pack", "mutable"]` |
| **Content Field** | JSON with version & npubs | Empty string |

## Example Events

### Nostrguard Format
```json
{
  "kind": 30001,
  "tags": [
    ["d", "test-scammer-pack"],
    ["title", "Test Scammer Pack"],
    ["description", "A test pack..."],
    ["t", "scam"],
    ["p", "npub1..."]
  ],
  "content": "{\"version\":\"1.0\",\"npubs\":[...]}"
}
```

### Mutable Format
```json
{
  "kind": 30001,
  "tags": [
    ["d", "test-scammer-pack"],
    ["name", "Test Scammer Pack"],
    ["description", "A test pack..."],
    ["L", "mutable"],
    ["l", "community-pack", "mutable"],
    ["t", "scam"],
    ["p", "hex-pubkey"]
  ],
  "content": ""
}
```

## Compatibility Implementation

Mutable now supports BOTH formats:

### Reading Packs
```typescript
// lib/nostr.ts - parsePublicListEvent()
const nameTag = event.tags.find(tag => tag[0] === 'name')?.[1];
const titleTag = event.tags.find(tag => tag[0] === 'title')?.[1];
const displayName = nameTag || titleTag || dTag;  // Fallback chain
```

This means:
- ✅ Mutable packs are read correctly (using "name" tag)
- ✅ Nostrguard packs are read correctly (using "title" tag)
- ✅ Backward compatible with existing packs

### Filtering by Namespace

```typescript
// Fetch only mutable-namespaced packs (default)
fetchAllPublicPacks(relays, 100, category, includeUntagged: false)

// Fetch ALL kind 30001 packs (including nostrguard)
fetchAllPublicPacks(relays, 100, category, includeUntagged: true)
```

The `includeUntagged` parameter controls whether to:
- `false` (default): Only fetch packs with `['L', 'mutable']` namespace
- `true`: Fetch ALL kind 30001 events (bookmarks, nostrguard packs, etc.)

## Current Status

### What Works Now ✅
1. Mutable can READ both mutable and nostrguard format packs
2. Proper namespace filtering prevents bookmarks from appearing as packs
3. The `isMutablePack` flag tracks which format each pack uses
4. Display names work regardless of "name" or "title" tag

### What Doesn't Exist Yet ⚠️
1. No real nostrguard packs published to relays (they're still in development)
2. No UI toggle to switch between "mutable packs only" and "all packs"
3. No conversion tool to republish nostrguard packs as mutable packs

## Future Enhancements

### Option 1: UI Toggle
Add a toggle in Community Packs tab:
- "Mutable Packs Only" (default)
- "All Compatible Packs" (includes nostrguard)

### Option 2: Import Tool
Create a tool to:
1. Fetch nostrguard pack
2. Extract pubkeys and metadata
3. Republish under mutable namespace with user's signature

### Option 3: Cross-Protocol Discovery
- Create a shared relay list for pack discovery
- Agree on common tag conventions
- Build a pack directory that works across apps

## Scripts

### Test Compatibility
```bash
npx tsx scripts/create-test-pack.ts
```
Shows format comparison and compatibility analysis.

### Search for Nostrguard Packs
```bash
npx tsx scripts/import-nostrguard-pack.ts
```
Searches relays for nostrguard packs and shows how to convert them.

## Technical Notes

### Why Namespace Tags?

The `['L', 'mutable']` namespace tag allows mutable to:
1. Distinguish its packs from other kind 30001 uses (bookmarks, pins, etc.)
2. Avoid polluting users' pack lists with unrelated events
3. Maintain forward compatibility as more apps use kind 30001

### Pubkey Format

- **Nostrguard**: May use npub format in tags
- **Mutable**: Uses hex pubkeys in tags
- Both are technically valid NIP-01 identifiers
- Both should work in most Nostr clients

## Conclusion

Mutable and nostrguard are **highly compatible** with minimal code changes. The formats can coexist, and mutable can now read both formats. Once nostrguard publishes real packs to Nostr relays, they will be discoverable and usable in mutable with the `includeUntagged: true` parameter.
