/**
 * Draftable relay I/O: discovering, publishing, and deleting follow packs, and
 * following the people in them. Pure parsing/building lives in ./pack.
 */

import type { Event, EventTemplate, Filter } from "nostr-tools";
import {
  getPool,
  getExpandedRelayList,
  normalizeRelayList,
  signEvent,
  publishToRelays,
  fetchFollowList,
} from "@/lib/nostr";
import { backupService } from "@/lib/backupService";
import { FOLLOW_LIST_KIND } from "@/types";
import {
  DRAFTABLE_KIND,
  PACK_RELAYS,
  FollowPack,
  PackDraft,
  addFollowTags,
  buildPackTags,
  latestPacks,
  packAddress,
  parsePackEvent,
  removeFollowTags,
} from "./pack";

export const PAGE_SIZE = 20;

// querySync waits for EOSE from every relay; cap it so one dead relay can't
// hold the page hostage.
const QUERY_MAX_WAIT_MS = 8000;

// Relays reject oversized filters, so long author lists (everyone you
// follow) are split across several queries.
const AUTHOR_CHUNK = 250;

/** Mutable's defaults + the user's relays + where following.space published. */
export function draftableRelays(userRelays: string[] = []): string[] {
  return normalizeRelayList([
    ...getExpandedRelayList(userRelays),
    ...PACK_RELAYS,
  ]);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function query(relays: string[], filter: Filter): Promise<Event[]> {
  try {
    return await getPool().querySync(relays, filter, {
      maxWait: QUERY_MAX_WAIT_MS,
    });
  } catch (error) {
    console.warn("[Draftable] query failed:", error);
    return [];
  }
}

// Packs published from this tab. Relays can lag a moment behind a publish,
// so the pack page reads our own copy instead of showing "not found".
const recentlyPublished = new Map<string, Event>();

export interface PackQuery {
  /** Only packs created by these pubkeys. */
  authors?: string[];
  /** Only packs this pubkey has been drafted into. */
  drafted?: string;
  /** Pagination cursor: packs updated at or before this time. */
  until?: number;
  limit?: number;
}

export async function fetchPacks(
  packQuery: PackQuery,
  relays: string[],
): Promise<{ packs: FollowPack[]; hasMore: boolean }> {
  const limit = packQuery.limit ?? PAGE_SIZE;
  const base: Filter = { kinds: [DRAFTABLE_KIND], limit };
  if (packQuery.until) base.until = packQuery.until;
  if (packQuery.drafted) base["#p"] = [packQuery.drafted];

  let filters: Filter[] = [base];
  if (packQuery.authors) {
    if (packQuery.authors.length === 0) return { packs: [], hasMore: false };
    filters = chunk(packQuery.authors, AUTHOR_CHUNK).map((authors) => ({
      ...base,
      authors,
    }));
  }

  const batches = await Promise.all(filters.map((f) => query(relays, f)));
  const packs = latestPacks(batches.flat());
  return { packs: packs.slice(0, limit), hasMore: packs.length >= limit };
}

/** Fetch the newest version of one pack by d-tag (and author, if known). */
export async function fetchPack(
  dTag: string,
  author: string | undefined,
  relays: string[],
): Promise<FollowPack | null> {
  const filter: Filter = { kinds: [DRAFTABLE_KIND], "#d": [dTag] };
  if (author) filter.authors = [author];

  const events = await query(relays, filter);
  for (const event of recentlyPublished.values()) {
    const pack = parsePackEvent(event);
    if (pack?.dTag === dTag && (!author || pack.author === author)) {
      events.push(event);
    }
  }

  const packs = events
    .map(parsePackEvent)
    .filter(
      (pack): pack is FollowPack =>
        !!pack && pack.dTag === dTag && (!author || pack.author === author),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  return packs[0] ?? null;
}

export async function publishPack(
  draft: PackDraft,
  relays: string[],
): Promise<FollowPack> {
  const template: EventTemplate = {
    kind: DRAFTABLE_KIND,
    tags: buildPackTags(draft),
    content: "",
    created_at: Math.floor(Date.now() / 1000),
  };
  const signed = await signEvent(template);
  await publishToRelays(getPool(), relays, signed);

  const pack = parsePackEvent(signed);
  if (!pack) throw new Error("Published pack could not be read back");
  recentlyPublished.set(packAddress(pack), signed);
  return pack;
}

/**
 * Ask relays to drop a pack (NIP-09). Relays are free to ignore this, and
 * anyone who saved a copy keeps it.
 */
export async function deletePack(
  pack: FollowPack,
  relays: string[],
): Promise<void> {
  const template: EventTemplate = {
    kind: 5,
    tags: [
      ["e", pack.eventId],
      ["a", packAddress(pack)],
      ["k", String(DRAFTABLE_KIND)],
    ],
    content: "Follow pack deleted by its author",
    created_at: Math.floor(Date.now() / 1000),
  };
  const signed = await signEvent(template);
  await publishToRelays(getPool(), relays, signed);
  recentlyPublished.delete(packAddress(pack));
}

/** Top-level notes (no replies) from the people in a pack, newest first. */
export async function fetchPackPosts(
  pubkeys: string[],
  relays: string[],
  limit: number = 50,
): Promise<Event[]> {
  if (pubkeys.length === 0) return [];
  const batches = await Promise.all(
    chunk(pubkeys, AUTHOR_CHUNK).map((authors) =>
      query(relays, { kinds: [1], authors, limit }),
    ),
  );
  const byId = new Map<string, Event>();
  for (const event of batches.flat()) {
    if (event.tags.some((tag) => tag[0] === "e")) continue;
    byId.set(event.id, event);
  }
  return Array.from(byId.values())
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit);
}

/**
 * Thrown when the viewer's kind:3 can't be found. Publishing anyway would
 * replace a follow list we couldn't see, so the caller has to opt in.
 */
export class MissingFollowListError extends Error {
  constructor() {
    super("Your current follow list could not be found on your relays.");
    this.name = "MissingFollowListError";
  }
}

function followSet(tags: string[][]): Set<string> {
  return new Set(tags.filter((tag) => tag[0] === "p").map((tag) => tag[1]));
}

/** The viewer's current follows, or null if no follow list was found. */
export async function fetchFollowing(
  pubkey: string,
  relays: string[],
): Promise<Set<string> | null> {
  const event = await fetchFollowList(pubkey, relays, 2);
  return event ? followSet(event.tags) : null;
}

export interface FollowChange {
  following: Set<string>;
  changed: string[];
}

async function publishFollowTags(
  tags: string[][],
  content: string,
  relays: string[],
): Promise<void> {
  const signed = await signEvent({
    kind: FOLLOW_LIST_KIND,
    tags,
    content,
    created_at: Math.floor(Date.now() / 1000),
  });
  await publishToRelays(getPool(), relays, signed);
}

function backupFollowList(viewer: string, current: Event, note: string) {
  const follows = Array.from(followSet(current.tags));
  backupService.saveBackup(
    backupService.createFollowListBackup(viewer, follows, note, current.id),
  );
}

/**
 * Follow pubkeys. Re-reads the newest kind:3 first, backs it up to Mutable's
 * Backups, and keeps every existing tag and the content field intact.
 */
export async function followPubkeys(
  viewer: string,
  pubkeys: string[],
  relays: string[],
  options: { allowNewList?: boolean; note?: string } = {},
): Promise<FollowChange> {
  const current = await fetchFollowList(viewer, relays, 2);
  if (!current && !options.allowNewList) throw new MissingFollowListError();

  const { tags, added } = addFollowTags(current?.tags ?? [], pubkeys);
  if (added.length === 0) return { following: followSet(tags), changed: [] };

  if (current) {
    backupFollowList(
      viewer,
      current,
      options.note ?? "Auto-backup before following from Draftable",
    );
  }
  await publishFollowTags(tags, current?.content ?? "", relays);
  return { following: followSet(tags), changed: added };
}

/** Unfollow pubkeys, with the same re-read + backup as followPubkeys. */
export async function unfollowPubkeys(
  viewer: string,
  pubkeys: string[],
  relays: string[],
  options: { note?: string } = {},
): Promise<FollowChange> {
  const current = await fetchFollowList(viewer, relays, 2);
  if (!current) throw new MissingFollowListError();

  const { tags, removed } = removeFollowTags(current.tags, pubkeys);
  if (removed.length === 0) return { following: followSet(tags), changed: [] };

  backupFollowList(
    viewer,
    current,
    options.note ?? "Auto-backup before unfollowing from Draftable",
  );
  await publishFollowTags(tags, current.content, relays);
  return { following: followSet(tags), changed: removed };
}
