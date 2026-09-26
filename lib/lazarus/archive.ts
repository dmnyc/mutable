import { verifyEvent, type Event } from "nostr-tools";
import { getLazarusKindProfile } from "./registry";

// Signed versions kept on this device: snapshots taken before each restore,
// and versions imported from JSON files. Stored verbatim, so private content
// stays encrypted and anything here can be reviewed and restored later.

export type LazarusArchiveSource = "snapshot" | "import";

export interface LazarusArchiveEntry {
  event: Event;
  source: LazarusArchiveSource;
  label: string;
  savedAt: number;
}

const ARCHIVE_KEY = "mutable-lazarus-archive";
// localStorage is small and big follow lists are large.
const MAX_PER_KIND = 20;

export const LAZARUS_EXPORT_FORMAT = "mutable-nostr-events";

export interface LazarusExportBundle {
  format: typeof LAZARUS_EXPORT_FORMAT;
  version: 1;
  exportedAt: number;
  pubkey: string;
  events: Event[];
}

function storage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function readArchive(): LazarusArchiveEntry[] {
  const raw = storage()?.getItem(ARCHIVE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is LazarusArchiveEntry =>
        !!entry &&
        typeof entry === "object" &&
        isSignedEventShape((entry as LazarusArchiveEntry).event),
    );
  } catch {
    return [];
  }
}

function writeArchive(entries: LazarusArchiveEntry[]): void {
  const store = storage();
  if (!store) return;
  let kept = entries;
  // On a full quota, drop the oldest entries until it fits.
  while (kept.length > 0) {
    try {
      store.setItem(ARCHIVE_KEY, JSON.stringify(kept));
      return;
    } catch {
      kept = kept.slice(0, -1);
    }
  }
  store.removeItem(ARCHIVE_KEY);
}

export function listArchive(
  pubkey: string,
  kind?: number,
): LazarusArchiveEntry[] {
  return readArchive()
    .filter(
      (entry) =>
        entry.event.pubkey === pubkey &&
        (kind === undefined || entry.event.kind === kind),
    )
    .sort((a, b) => b.savedAt - a.savedAt);
}

// Returns how many entries were new. Existing ids keep their first label.
export function saveToArchive(entries: LazarusArchiveEntry[]): number {
  const existing = readArchive();
  const seen = new Set(existing.map((entry) => entry.event.id));
  const fresh = entries.filter((entry) => {
    if (seen.has(entry.event.id)) return false;
    seen.add(entry.event.id);
    return true;
  });
  if (fresh.length === 0) return 0;

  const merged = [...fresh, ...existing].sort((a, b) => b.savedAt - a.savedAt);
  const perKind = new Map<string, number>();
  const capped = merged.filter((entry) => {
    const key = `${entry.event.pubkey}:${entry.event.kind}`;
    const count = (perKind.get(key) ?? 0) + 1;
    perKind.set(key, count);
    return count <= MAX_PER_KIND;
  });
  writeArchive(capped);
  return fresh.length;
}

export function removeFromArchive(eventId: string): void {
  writeArchive(readArchive().filter((entry) => entry.event.id !== eventId));
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

function isSignedEventShape(value: unknown): value is Event {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === "string" &&
    HEX64.test(event.id) &&
    typeof event.pubkey === "string" &&
    HEX64.test(event.pubkey) &&
    typeof event.sig === "string" &&
    HEX128.test(event.sig) &&
    Number.isInteger(event.created_at) &&
    Number.isInteger(event.kind) &&
    typeof event.content === "string" &&
    Array.isArray(event.tags) &&
    event.tags.every(
      (tag) =>
        Array.isArray(tag) && tag.every((part) => typeof part === "string"),
    )
  );
}

export function buildExportBundle(
  pubkey: string,
  events: Event[],
): LazarusExportBundle {
  return {
    format: LAZARUS_EXPORT_FORMAT,
    version: 1,
    exportedAt: Math.floor(Date.now() / 1000),
    pubkey,
    events: [...events].sort(
      (a, b) => a.kind - b.kind || b.created_at - a.created_at,
    ),
  };
}

export interface LazarusImportResult {
  // Valid signed versions of registry kinds, authored by the account.
  events: Event[];
  // Signed by another account.
  foreign: number;
  // Malformed, or failing signature verification.
  invalid: number;
  // Valid, but of a kind Lazarus doesn't restore.
  unsupported: number;
}

// Accepts an export bundle, a plain array of events, or a single event.
export function parseImportedEvents(
  text: string,
  pubkey: string,
): LazarusImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This file isn't valid JSON.");
  }

  let items: unknown[];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { events?: unknown }).events)
  ) {
    items = (parsed as { events: unknown[] }).events;
  } else {
    items = [parsed];
  }

  const result: LazarusImportResult = {
    events: [],
    foreign: 0,
    invalid: 0,
    unsupported: 0,
  };
  const seen = new Set<string>();
  for (const item of items) {
    if (!isSignedEventShape(item) || !verifyEvent(item)) {
      result.invalid += 1;
      continue;
    }
    if (item.pubkey !== pubkey) {
      result.foreign += 1;
      continue;
    }
    if (!getLazarusKindProfile(item.kind)) {
      result.unsupported += 1;
      continue;
    }
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.events.push({
      id: item.id,
      pubkey: item.pubkey,
      created_at: item.created_at,
      kind: item.kind,
      tags: item.tags.map((tag) => [...tag]),
      content: item.content,
      sig: item.sig,
    });
  }
  return result;
}

export function lazarusFileName(
  label: string,
  pubkey: string,
  date: Date = new Date(),
): string {
  const stamp = date.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `mutable-${slug}-${pubkey.slice(0, 8)}-${stamp}.json`;
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
