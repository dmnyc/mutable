// Nostr mute list events (NIP-51 kind 10000) carry no per-item timestamps, so
// "when was this added" can only come from a local ledger. Keyed per logged-in
// pubkey; entries use `${category}:${value}`.
export type AddedAtMap = Record<string, number>;

const KEY_PREFIX = "mutable_mute_added_at_";

function storageKey(pubkey: string | null | undefined): string {
  return KEY_PREFIX + (pubkey || "anonymous");
}

function readMap(pubkey: string | null | undefined): AddedAtMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey(pubkey));
    return raw ? (JSON.parse(raw) as AddedAtMap) : {};
  } catch {
    return {};
  }
}

function writeMap(
  pubkey: string | null | undefined,
  map: AddedAtMap,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(pubkey), JSON.stringify(map));
  } catch {
    // Storage unavailable (private mode, quota); sorting falls back to list order.
  }
}

export function getAddedAtMap(pubkey: string | null | undefined): AddedAtMap {
  return readMap(pubkey);
}

export function recordAddedAt(
  pubkey: string | null | undefined,
  category: string,
  value: string,
): void {
  const map = readMap(pubkey);
  map[`${category}:${value}`] = Date.now();
  writeMap(pubkey, map);
}

export function removeAddedAt(
  pubkey: string | null | undefined,
  category: string,
  value: string,
): void {
  const key = `${category}:${value}`;
  const map = readMap(pubkey);
  if (map[key] === undefined) return;
  delete map[key];
  writeMap(pubkey, map);
}

export function renameAddedAt(
  pubkey: string | null | undefined,
  category: string,
  oldValue: string,
  newValue: string,
): void {
  if (oldValue === newValue) return;
  const key = `${category}:${oldValue}`;
  const map = readMap(pubkey);
  const ts = map[key];
  if (ts === undefined) return;
  delete map[key];
  map[`${category}:${newValue}`] = ts;
  writeMap(pubkey, map);
}

export type MuteSortOrder = "list" | "recent" | "oldest";

// Order items by when they were added. Items added before the ledger existed
// have no timestamp; their list position approximates add order (new items are
// appended), so it breaks ties and ranks unrecorded items last for "recent".
export function orderMuteItems<T extends { value: string }>(
  items: T[],
  category: string,
  pubkey: string | null | undefined,
  order: MuteSortOrder,
): T[] {
  if (order === "list") return items;
  const addedAt = readMap(pubkey);
  const stamped = items.map((item, index) => ({
    item,
    index,
    ts: addedAt[`${category}:${item.value}`] ?? -Infinity,
  }));
  stamped.sort((a, b) =>
    order === "recent"
      ? b.ts - a.ts || b.index - a.index
      : a.ts - b.ts || a.index - b.index,
  );
  return stamped.map((entry) => entry.item);
}
