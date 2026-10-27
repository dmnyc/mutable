import type { Event } from "nostr-tools";
import { extractBlobHash, isBlobHash, normalizeBlossomServer } from "./client";
import type { RelayQuery } from "./servers";

// Where a user's published events point at blobs: profile picture and
// banner (every version the relays still hold), imeta tags and bare URLs in
// notes, NIP-94 file metadata, picture and video events, long-form articles,
// comments, and follow pack covers. Reposts are left out on purpose: their
// content belongs to other people's blobs.
export const REFERENCE_KINDS = [0, 1, 20, 1063, 1111, 30023, 34235, 34236, 39089];
export const REFERENCE_PAGE_SIZE = 400;
export const REFERENCE_MAX_PAGES = 12;
// Each paging step covers a fixed window ending where the last one began.
// The previous backwards walk stepped `until` to the oldest event of the
// merged page, so one sparse relay's ancient event skipped everything a
// deep relay had not yet returned — events inside the hole were mislabeled
// "no link found" even though matching posts were fetched on every scan.
//
// The width matters as much as the stepping: relays answer with their
// newest `limit` events *in the window*, so a window with more events than
// that gets its older edge cut on every deep relay at once. 14 days keeps
// even prolific accounts under the cap; 12 slices cover ~24 weeks.
export const REFERENCE_SLICE_DAYS = 14;
// A run of empty slices means every relay has run out of history.
const EMPTY_SLICE_STOP = 3;

export type ReferenceVia =
  | "imeta"
  | "content"
  | "picture"
  | "banner"
  | "image"
  | "url"
  | "x";

export interface BlobReference {
  hash: string;
  url?: string;
  eventId: string;
  kind: number;
  createdAt: number;
  via: ReferenceVia;
}

const URL_PATTERN = /https?:\/\/[^\s<>"'()]+/g;

export function extractUrls(text: string): string[] {
  return (text.match(URL_PATTERN) ?? []).map((url) =>
    url.replace(/[.,;:!?]+$/, ""),
  );
}

// NIP-92: one tag whose entries are space-separated "key value" pairs.
function parseImeta(tag: string[]): { url?: string; hash?: string } {
  let url: string | undefined;
  let hash: string | undefined;
  for (const entry of tag.slice(1)) {
    const space = entry.indexOf(" ");
    if (space === -1) continue;
    const key = entry.slice(0, space);
    const value = entry.slice(space + 1).trim();
    if (key === "url") url = value;
    if (key === "x") hash = value.toLowerCase();
  }
  return { url, hash };
}

export function extractBlobReferences(event: Event): BlobReference[] {
  const references: BlobReference[] = [];
  // One reference per hash per event; tags are read before content, so an
  // imeta entry wins over the same URL repeated in the text.
  const seen = new Set<string>();
  const add = (hash: string | undefined, via: ReferenceVia, url?: string) => {
    if (!hash || !isBlobHash(hash)) return;
    if (seen.has(hash)) return;
    seen.add(hash);
    references.push({
      hash,
      url,
      eventId: event.id,
      kind: event.kind,
      createdAt: event.created_at,
      via,
    });
  };

  const urlTag = event.tags.find((tag) => tag[0] === "url")?.[1];
  for (const tag of event.tags) {
    if (tag[0] === "imeta") {
      const { url, hash } = parseImeta(tag);
      add(hash ?? (url ? extractBlobHash(url) : undefined), "imeta", url);
    } else if (tag[0] === "x" && typeof tag[1] === "string") {
      add(tag[1].toLowerCase(), "x", urlTag);
    } else if (
      (tag[0] === "image" || tag[0] === "url") &&
      typeof tag[1] === "string"
    ) {
      add(extractBlobHash(tag[1]), tag[0], tag[1]);
    }
  }

  if (event.kind === 0) {
    try {
      const profile = JSON.parse(event.content) as Record<string, unknown>;
      for (const field of ["picture", "banner"] as const) {
        const value = profile[field];
        if (typeof value === "string") add(extractBlobHash(value), field, value);
      }
    } catch {
      // Not a JSON profile; nothing to read.
    }
  } else {
    for (const url of extractUrls(event.content)) {
      add(extractBlobHash(url), "content", url);
    }
  }

  return references;
}

export type ReferenceIndex = Map<string, BlobReference[]>;

// Newest reference first under each hash.
export function indexBlobReferences(events: Event[]): ReferenceIndex {
  const index: ReferenceIndex = new Map();
  for (const event of events) {
    for (const reference of extractBlobReferences(event)) {
      const list = index.get(reference.hash) ?? [];
      if (!list.some((r) => r.eventId === reference.eventId)) {
        list.push(reference);
      }
      index.set(reference.hash, list);
    }
  }
  for (const list of index.values()) {
    list.sort((a, b) => b.createdAt - a.createdAt);
  }
  return index;
}

// Hosts the user's posts load blobs from, worth asking even when they are
// not in the kind 10063 list.
export function referencedServers(index: ReferenceIndex): string[] {
  const servers: string[] = [];
  for (const references of index.values()) {
    for (const reference of references) {
      if (!reference.url) continue;
      try {
        const url = new URL(reference.url);
        const server = normalizeBlossomServer(`${url.protocol}//${url.host}`);
        if (server && !servers.includes(server)) servers.push(server);
      } catch {
        // Not a URL.
      }
    }
  }
  return servers;
}

export interface ReferenceProgress {
  events: number;
  pages: number;
  // Oldest event seen so far — the walk has covered down to here.
  oldest?: number;
  // References indexed over every event so far, so the gallery can refine
  // link states while the walk continues.
  references: ReferenceIndex;
}

export interface ReferenceScan {
  events: Event[];
  // Oldest fetched event — the start of the scanned window. Anything
  // uploaded before it hasn't been checked.
  oldestCreated?: number;
  pages: number;
}

// Pages through the user's events in fixed time slices, newest first, one
// query per slice. Deterministic coverage: every window is asked exactly,
// so nothing is skipped regardless of how unevenly relays hold history.
// Stops at the page cap, after a run of empty slices, once a slice starts
// before `before` (typically the oldest upload), or at the beginning of time.
export async function fetchReferenceEventsPaged(
  pubkey: string,
  query: RelayQuery,
  options: {
    pageSize?: number;
    maxPages?: number;
    sliceSeconds?: number;
    before?: number;
    onProgress?: (progress: ReferenceProgress) => void;
  } = {},
): Promise<ReferenceScan> {
  const pageSize = options.pageSize ?? REFERENCE_PAGE_SIZE;
  const maxPages = options.maxPages ?? REFERENCE_MAX_PAGES;
  const sliceSeconds =
    options.sliceSeconds ?? REFERENCE_SLICE_DAYS * 86400;
  const byId = new Map<string, Event>();
  // +1 covers clock-skewed future events; ids dedupe the slice overlap.
  let sliceEnd = Math.floor(Date.now() / 1000) + 1;
  let pages = 0;
  let emptyRun = 0;
  let oldest: number | undefined;

  while (pages < maxPages && emptyRun < EMPTY_SLICE_STOP) {
    const sliceStart = Math.max(sliceEnd - sliceSeconds, 0);
    const events = await query({
      kinds: REFERENCE_KINDS,
      authors: [pubkey],
      limit: pageSize,
      since: sliceStart,
      until: sliceEnd,
    });
    pages += 1;
    const fresh = events.filter((event) => !byId.has(event.id));
    for (const event of fresh) {
      byId.set(event.id, event);
      if (oldest === undefined || event.created_at < oldest) {
        oldest = event.created_at;
      }
    }
    emptyRun = fresh.length === 0 ? emptyRun + 1 : 0;
    options.onProgress?.({
      events: byId.size,
      pages,
      oldest,
      references: indexBlobReferences(Array.from(byId.values())),
    });
    if (sliceStart === 0) break;
    if (options.before !== undefined && sliceStart <= options.before) break;
    sliceEnd = sliceStart;
  }

  const events = Array.from(byId.values());
  return {
    events,
    oldestCreated: events.length
      ? Math.min(...events.map((event) => event.created_at))
      : undefined,
    pages,
  };
}
