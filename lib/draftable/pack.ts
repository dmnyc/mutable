/**
 * Draftable — follow packs (NIP-51 kind:39089), ported from following.space.
 *
 * A follow pack is a parameterized replaceable event signed by its author: a
 * title, an optional image and description, and one `p` tag per person in it.
 * Nothing in the format involves the people listed. They are not asked, not
 * notified, and have no way to take themselves out — only the author can
 * publish a new version without them. Hence "Draftable": once you're drafted,
 * you're in until the author says otherwise.
 *
 * This module is pure (no relay I/O) so it can be shared by the client
 * service, the server-side metadata/OG card code, and the tests.
 *
 * Event layout (compatible with following.space):
 *   kind: 39089
 *   tags: ["d", id] ["title", name] ["image", url]? ["description", text]?
 *         ["p", pubkey, relay?]...
 *   content: ""
 */

import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";

export const DRAFTABLE_KIND = 39089;

/**
 * Relays following.space published packs to, beyond Mutable's defaults.
 * Added to discovery queries so packs made there show up here.
 */
export const PACK_RELAYS = [
  "wss://relay.damus.io",
  "wss://nostr-pub.wellorder.net",
  "wss://nostr.oxtr.dev",
  "wss://relay.8333.space",
];

/** Authors whose packs following.space hides from discovery (spam). */
export const BLOCKED_PACK_AUTHORS = new Set([
  "414f438fe851a53ee2dc94883300d04f04165337141fc97563a5ee6542637660",
]);

export const UNTITLED_PACK = "Untitled Follow Pack";

const HEX64 = /^[0-9a-f]{64}$/i;

export interface PackMember {
  pubkey: string; // hex
  relay?: string;
}

export interface FollowPack {
  dTag: string;
  eventId: string;
  author: string; // hex pubkey of the only person who can change the pack
  name: string;
  description: string;
  image: string;
  members: PackMember[];
  createdAt: number;
}

export interface PackDraft {
  dTag: string;
  name: string;
  description?: string;
  image?: string;
  members: PackMember[];
}

function tagValue(tags: string[][], name: string): string | undefined {
  const value = tags.find((tag) => tag[0] === name)?.[1];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Parse a kind:39089 event. Keeps following.space's back-compat paths: the
 * old `n` tag for the title and a JSON `{description}` content body.
 * Member pubkeys are validated and de-duplicated (first occurrence wins).
 */
export function parsePackEvent(event: Event): FollowPack | null {
  if (!event || event.kind !== DRAFTABLE_KIND || !Array.isArray(event.tags)) {
    return null;
  }

  const tags = event.tags;
  const name = (
    tagValue(tags, "title") ??
    tagValue(tags, "n") ??
    tagValue(tags, "name") ??
    UNTITLED_PACK
  ).trim();

  let description = tagValue(tags, "description") ?? "";
  if (!description && event.content) {
    try {
      const parsed = JSON.parse(event.content);
      if (parsed && typeof parsed.description === "string") {
        description = parsed.description;
      }
    } catch {
      // content isn't JSON — ignore
    }
  }

  const seen = new Set<string>();
  const members: PackMember[] = [];
  for (const tag of tags) {
    if (tag[0] !== "p" || typeof tag[1] !== "string" || !HEX64.test(tag[1])) {
      continue;
    }
    const pubkey = tag[1].toLowerCase();
    if (seen.has(pubkey)) continue;
    seen.add(pubkey);
    members.push(tag[2] ? { pubkey, relay: tag[2] } : { pubkey });
  }

  return {
    dTag: tagValue(tags, "d") ?? event.id,
    eventId: event.id,
    author: event.pubkey,
    name,
    description: description.trim(),
    image: tagValue(tags, "image")?.trim() ?? "",
    members,
    createdAt: event.created_at || 0,
  };
}

/** Build the tag list for a pack event. */
export function buildPackTags(draft: PackDraft): string[][] {
  const name = draft.name.trim() || UNTITLED_PACK;
  const tags: string[][] = [
    ["d", draft.dTag],
    ["title", name],
  ];
  const image = draft.image?.trim();
  if (image) tags.push(["image", image]);
  const description = draft.description?.trim();
  if (description) tags.push(["description", description]);

  const seen = new Set<string>();
  for (const member of draft.members) {
    const pubkey = member.pubkey.toLowerCase();
    if (!HEX64.test(pubkey) || seen.has(pubkey)) continue;
    seen.add(pubkey);
    tags.push(member.relay ? ["p", pubkey, member.relay] : ["p", pubkey]);
  }

  // NIP-31 fallback text for clients that don't know kind:39089.
  tags.push(["alt", `Follow pack: ${name}`]);
  return tags;
}

/** Random 12-char [a-z0-9] identifier, the same shape following.space uses. */
export function generatePackId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/** The NIP-01 address of a pack: `39089:<author>:<d>`. */
export function packAddress(pack: Pick<FollowPack, "author" | "dTag">): string {
  return `${DRAFTABLE_KIND}:${pack.author}:${pack.dTag}`;
}

export function packNaddr(
  pack: Pick<FollowPack, "author" | "dTag">,
  relays: string[] = [],
): string {
  return nip19.naddrEncode({
    kind: DRAFTABLE_KIND,
    pubkey: pack.author,
    identifier: pack.dTag,
    relays: relays.slice(0, 3),
  });
}

/**
 * Pack links carry only the start of the author's hex pubkey, since a pack's
 * ID is only unique per author. New links carry 16 hex characters (64 bits).
 * That has to hold against someone grinding a key that starts the same way
 * as the author's, to take over the link: 32 bits is minutes of work for a
 * dedicated key grinder, 64 is out of reach.
 */
export const AUTHOR_PREFIX_LENGTH = 16;

/**
 * Links made before the prefix grew carry only 8 characters, and are still
 * read. When one matches more than one author, the page asks rather than
 * guessing (see classifyLink).
 */
export const MIN_AUTHOR_PREFIX_LENGTH = 8;

const AUTHOR_PREFIX = new RegExp(`^[0-9a-f]{${MIN_AUTHOR_PREFIX_LENGTH},63}$`);

/**
 * A pack link's `p`: a full pubkey (hex, npub, or nprofile, as
 * following.space links use) or a hex prefix of at least 8 characters, as
 * Draftable's own links use (16 now, 8 before). Lowercase hex, or null.
 */
export function parseAuthorParam(
  value: string | null | undefined,
): string | null {
  const full = resolvePubkey(value);
  if (full) return full;
  const trimmed = value?.trim().toLowerCase() ?? "";
  return AUTHOR_PREFIX.test(trimmed) ? trimmed : null;
}

/** A full pubkey can go in a relay filter; a prefix is matched afterwards. */
export function isFullPubkey(author: string): boolean {
  return HEX64.test(author);
}

export function matchesAuthor(pubkey: string, author: string): boolean {
  return pubkey.startsWith(author);
}

/**
 * Whether a note answers another one. NIP-10: an `e` tag marked "reply" or
 * "root" is a reply, and so is an unmarked one (the older positional style).
 * An `e` tag marked "mention" only cites a note, so a top-level note that
 * mentions another is still top-level.
 */
export function isReplyNote(tags: string[][]): boolean {
  return tags.some((tag) => tag[0] === "e" && tag[3] !== "mention");
}

/** What a pack link points to. */
export type LinkLookup =
  | { status: "found"; pack: FollowPack }
  /** Several authors match the link's ID and prefix: ask, don't guess. */
  | { status: "ambiguous"; packs: FollowPack[] }
  | { status: "missing" };

/**
 * The newest pack with this ID from each author the link could mean, newest
 * first. With no author in the link, or only a prefix, that can be several.
 */
export function packsForLink(
  packs: FollowPack[],
  dTag: string,
  author?: string,
): FollowPack[] {
  const newest = new Map<string, FollowPack>();
  for (const pack of packs) {
    if (pack.dTag !== dTag) continue;
    if (author && !matchesAuthor(pack.author, author)) continue;
    const existing = newest.get(pack.author);
    if (!existing || pack.createdAt > existing.createdAt) {
      newest.set(pack.author, pack);
    }
  }
  return Array.from(newest.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * One match is the pack; several is ambiguous. Taking the newest of several
 * would let anyone who publishes a newer pack with the same ID (and a key
 * that starts the same way) replace the one a link was made for.
 */
export function classifyLink(matches: FollowPack[]): LinkLookup {
  if (matches.length === 0) return { status: "missing" };
  if (matches.length === 1) return { status: "found", pack: matches[0] };
  return { status: "ambiguous", packs: matches };
}

/** In-app path to a pack. Mirrors following.space's `/d/<id>?p=<pubkey>`. */
export function packPath(pack: Pick<FollowPack, "author" | "dTag">): string {
  return `/draftable/d/${encodeURIComponent(pack.dTag)}?p=${pack.author.slice(0, AUTHOR_PREFIX_LENGTH)}`;
}

/** In-app path for a pasted or linked reference, keeping relay hints. */
export function referencePath(ref: PackReference): string {
  const params = new URLSearchParams();
  if (ref.author) params.set("p", ref.author.slice(0, AUTHOR_PREFIX_LENGTH));
  for (const relay of ref.relays ?? []) params.append("r", relay);
  const query = params.toString();
  return `/draftable/d/${encodeURIComponent(ref.dTag)}${query ? `?${query}` : ""}`;
}

export const PACK_ID_MIN = 3;
export const PACK_ID_MAX = 64;

/**
 * Why a custom pack ID (the `d` tag) can't be used, or null if it can.
 * Kept to lowercase letters, digits, and hyphens so links stay readable.
 */
export function packIdError(id: string): string | null {
  if (id.length < PACK_ID_MIN || id.length > PACK_ID_MAX) {
    return `Use ${PACK_ID_MIN} to ${PACK_ID_MAX} characters.`;
  }
  if (!/^[a-z0-9-]+$/.test(id)) {
    return "Use only lowercase letters, numbers, and hyphens.";
  }
  if (id.startsWith("-") || id.endsWith("-")) {
    return "Don't start or end with a hyphen.";
  }
  return null;
}

/** Lowercase and strip accents so "cafe" finds "Café". */
function foldText(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Packs whose name or description contains `term`, best first: exact name,
 * name prefix, a word in the name, anywhere in the name, then description;
 * newest first within each. An npub, nprofile, or hex pubkey matches that
 * author's packs instead.
 */
export function matchPacks(packs: FollowPack[], term: string): FollowPack[] {
  const author = resolvePubkey(term);
  if (author) return packs.filter((pack) => pack.author === author);

  const query = foldText(term.trim());
  if (!query) return [];
  const ranked: { pack: FollowPack; rank: number }[] = [];
  for (const pack of packs) {
    const name = foldText(pack.name);
    let rank = -1;
    if (name === query) rank = 0;
    else if (name.startsWith(query)) rank = 1;
    else if (name.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(query))) {
      rank = 2;
    } else if (name.includes(query)) rank = 3;
    else if (foldText(pack.description).includes(query)) rank = 4;
    if (rank >= 0) ranked.push({ pack, rank });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || b.pack.createdAt - a.pack.createdAt)
    .map((r) => r.pack);
}

/** Accept a hex pubkey, npub, or nprofile; return lowercase hex or null. */
export function resolvePubkey(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^nostr:/i, "");
  if (HEX64.test(trimmed)) return trimmed.toLowerCase();
  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === "npub") return decoded.data as string;
    if (decoded.type === "nprofile") {
      return (decoded.data as { pubkey: string }).pubkey;
    }
  } catch {
    // not bech32
  }
  return null;
}

export interface PackReference {
  dTag: string;
  /** Lowercase hex: the full pubkey, or a prefix from a short link. */
  author?: string;
  /** Relay hints from an naddr: where the author says the pack lives. */
  relays?: string[];
}

/** Hints are only worth following if they're secure websocket URLs. */
export function cleanRelayHints(hints: unknown[], max = 3): string[] {
  const out: string[] = [];
  for (const hint of hints) {
    if (typeof hint !== "string") continue;
    try {
      const url = new URL(hint.trim());
      if (url.protocol !== "wss:") continue;
      const normalized = url.toString().replace(/\/$/, "");
      if (!out.includes(normalized)) out.push(normalized);
    } catch {
      // not a URL
    }
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Turn something a user pasted into a pack reference: an naddr (with or
 * without `nostr:`), a following.space link, or a Draftable link.
 */
export function parsePackReference(input: string): PackReference | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const naddrMatch = trimmed.match(/naddr1[0-9a-z]+/i);
  if (naddrMatch) {
    try {
      const decoded = nip19.decode(naddrMatch[0].toLowerCase());
      if (decoded.type === "naddr" && decoded.data.kind === DRAFTABLE_KIND) {
        const relays = cleanRelayHints(decoded.data.relays ?? []);
        return {
          dTag: decoded.data.identifier,
          author: decoded.data.pubkey,
          ...(relays.length > 0 ? { relays } : {}),
        };
      }
    } catch {
      // fall through to URL parsing
    }
    return null;
  }

  let url: URL;
  try {
    url = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
  } catch {
    return null;
  }
  const pathMatch = url.pathname.match(/\/d\/([^/]+)\/?$/);
  if (!pathMatch) return null;

  let dTag: string;
  try {
    dTag = decodeURIComponent(pathMatch[1]);
  } catch {
    return null;
  }
  if (!dTag) return null;
  const author = parseAuthorParam(url.searchParams.get("p"));
  return author ? { dTag, author } : { dTag };
}

/**
 * Collapse a batch of events to the newest version of each pack (relays may
 * return stale copies of replaceable events), drop blocked authors, and sort
 * newest first.
 */
export function latestPacks(events: Event[]): FollowPack[] {
  const byAddress = new Map<string, FollowPack>();
  for (const event of events) {
    if (BLOCKED_PACK_AUTHORS.has(event.pubkey)) continue;
    const pack = parsePackEvent(event);
    if (!pack) continue;
    const key = packAddress(pack);
    const existing = byAddress.get(key);
    if (!existing || pack.createdAt > existing.createdAt) {
      byAddress.set(key, pack);
    }
  }
  return Array.from(byAddress.values()).sort(
    (a, b) => b.createdAt - a.createdAt,
  );
}

/** Why a pack made by someone else looks like a test or was abandoned. */
export type TestPackReason =
  "single-user" | "untitled" | "test name" | "abandoned";

// Words people (and test scripts) put in throwaway packs, as whole words so
// "Contest" and "Testnet" don't count.
const TEST_WORDS =
  /\b(test|tests|testing|asdf|qwerty|foo|foobar|lorem|ipsum|dummy|debug|dbg|tmp)\b/i;
// Automated test runs stamp names with a Unix time ("IT32 Pack 1790722839012").
const TIMESTAMP = /\d{10,}/;
const PLACEHOLDER_NAMES =
  /^(new pack|my pack|my follow pack|follow pack|new list|my list|hello world)$/i;

export const ABANDONED_MAX_PEOPLE = 3;
export const ABANDONED_AFTER_DAYS = 180;

/**
 * Whether a pack made by someone other than the viewer looks like a test or
 * was abandoned, and why: one person or nobody in it, no name, a test-style
 * name, or a few people and no update in six months. Browsing and search hide
 * these by default. The viewer's own packs never count.
 */
export function testPackReason(
  pack: Pick<FollowPack, "author" | "members" | "name" | "createdAt">,
  viewerPubkey?: string | null,
  now: number = Math.floor(Date.now() / 1000),
): TestPackReason | null {
  if (pack.author === viewerPubkey) return null;
  if (pack.members.length <= 1) return "single-user";
  const name = pack.name.trim();
  if (!name || name === UNTITLED_PACK) return "untitled";
  if (
    TEST_WORDS.test(name) ||
    TIMESTAMP.test(name) ||
    PLACEHOLDER_NAMES.test(name) ||
    /^(.)\1*$/u.test(name) || // "a", "xxx"
    !/[\p{L}\p{N}]/u.test(name) // only punctuation or emoji
  ) {
    return "test name";
  }
  if (
    pack.members.length <= ABANDONED_MAX_PEOPLE &&
    now - pack.createdAt > ABANDONED_AFTER_DAYS * 86_400
  ) {
    return "abandoned";
  }
  return null;
}

export function isDrafted(
  pack: Pick<FollowPack, "members">,
  pubkey: string | null | undefined,
): boolean {
  if (!pubkey) return false;
  const target = pubkey.toLowerCase();
  return pack.members.some((member) => member.pubkey === target);
}

/**
 * Add pubkeys to a kind:3 tag list. Every existing tag is kept as-is (petnames,
 * relay hints, non-`p` tags); new follows are appended once each.
 */
export function addFollowTags(
  existing: string[][],
  pubkeys: string[],
): { tags: string[][]; added: string[] } {
  const following = new Set(
    existing.filter((tag) => tag[0] === "p").map((tag) => tag[1]),
  );
  const tags = existing.map((tag) => [...tag]);
  const added: string[] = [];
  for (const raw of pubkeys) {
    const pubkey = raw.toLowerCase();
    if (!HEX64.test(pubkey) || following.has(pubkey)) continue;
    following.add(pubkey);
    tags.push(["p", pubkey]);
    added.push(pubkey);
  }
  return { tags, added };
}

/** Remove pubkeys from a kind:3 tag list, keeping every other tag. */
export function removeFollowTags(
  existing: string[][],
  pubkeys: string[],
): { tags: string[][]; removed: string[] } {
  const targets = new Set(pubkeys.map((p) => p.toLowerCase()));
  const removed = new Set<string>();
  const tags = existing.filter((tag) => {
    if (tag[0] === "p" && targets.has(tag[1])) {
      removed.add(tag[1]);
      return false;
    }
    return true;
  });
  return { tags: tags.map((tag) => [...tag]), removed: Array.from(removed) };
}

export type ContentSegment =
  | { type: "text"; value: string }
  | { type: "link"; url: string }
  | { type: "image"; url: string };

const URL_PATTERN = /https?:\/\/[^\s<>"]+/gi;
const IMAGE_PATTERN = /\.(jpe?g|gif|png|webp|avif)(\?[^\s]*)?$/i;

/**
 * Split note content into text, link, and image segments so it can be
 * rendered as React nodes — never as HTML. Only http(s) URLs become links.
 */
export function segmentContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let lastIndex = 0;
  for (const match of content.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    // Trailing punctuation usually belongs to the sentence, not the URL.
    const url = match[0].replace(/[),.;:!?'\]]+$/, "");
    if (start > lastIndex) {
      segments.push({ type: "text", value: content.slice(lastIndex, start) });
    }
    segments.push(
      IMAGE_PATTERN.test(url) ? { type: "image", url } : { type: "link", url },
    );
    lastIndex = start + url.length;
  }
  if (lastIndex < content.length) {
    segments.push({ type: "text", value: content.slice(lastIndex) });
  }
  return segments;
}

/** "3 minutes ago"-style label, as following.space shows on cards. */
export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor(now / 1000) - timestamp);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const plural = (n: number, unit: string) =>
    `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (days >= 365) return plural(Math.floor(days / 365), "year");
  if (days > 30) return plural(Math.floor(days / 30), "month");
  if (days > 0) return plural(days, "day");
  if (hours > 0) return plural(hours, "hour");
  if (minutes > 0) return plural(minutes, "minute");
  return "just now";
}

export function conscriptCount(count: number): string {
  return `${count} ${count === 1 ? "conscript" : "conscripts"}`;
}
