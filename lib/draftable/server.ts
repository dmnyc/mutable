/**
 * Server-side pack lookup for link previews (page metadata and the OG card).
 *
 * Talks to a few relays over the runtime's global WebSocket with a hard
 * timeout. Every path degrades to null so a slow relay only costs the preview
 * its details, never the page.
 */

import { verifyEvent, type Event, type Filter } from "nostr-tools";
import {
  BRAINSTORM_SEARCH_RELAY,
  latestProfiles,
  withSearchToken,
  type BrainstormProfile,
} from "@/lib/brainstorm";
import {
  DRAFTABLE_KIND,
  FollowPack,
  classifyLink,
  isFullPubkey,
  packsForLink,
  parsePackEvent,
} from "./pack";

const PREVIEW_RELAYS = [
  "wss://nos.lol",
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://relay.nostr.net",
];

function queryRelay(
  url: string,
  filter: Filter,
  timeoutMs: number,
): Promise<Event[]> {
  return new Promise((resolve) => {
    if (typeof WebSocket === "undefined") {
      resolve([]);
      return;
    }

    const events: Event[] = [];
    let settled = false;
    let socket: WebSocket | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // ignore
      }
      resolve(events);
    };
    const timer = setTimeout(finish, timeoutMs);

    try {
      socket = new WebSocket(url);
    } catch {
      finish();
      return;
    }
    socket.onopen = () => socket?.send(JSON.stringify(["REQ", "dp", filter]));
    socket.onmessage = (message) => {
      try {
        const data = JSON.parse(String(message.data));
        if (data[0] === "EVENT" && data[2]) events.push(data[2] as Event);
        if (data[0] === "EOSE" || data[0] === "CLOSED") finish();
      } catch {
        // ignore malformed frames
      }
    };
    socket.onerror = finish;
    socket.onclose = finish;
  });
}

// A short link's author prefix can't go in a relay filter, so the preview
// fetches every author's pack with this ID and matches the prefix after. One
// page of this many is plenty for real IDs; a flood past it fails closed (the
// generic preview) rather than showing someone else's pack.
const PREVIEW_PACK_LIMIT = 100;

/**
 * The pack a link points to, for its preview card. Null when the link is
 * missing or ambiguous: a preview must never show the wrong author's pack.
 */
export async function fetchPackForPreview(
  dTag: string,
  author?: string,
  timeoutMs: number = 2500,
): Promise<FollowPack | null> {
  const fullAuthor = author && isFullPubkey(author);
  const filter: Filter = {
    kinds: [DRAFTABLE_KIND],
    "#d": [dTag],
    limit: fullAuthor ? 5 : PREVIEW_PACK_LIMIT,
  };
  if (fullAuthor) filter.authors = [author];

  try {
    const results = await Promise.all(
      PREVIEW_RELAYS.map((url) => queryRelay(url, filter, timeoutMs)),
    );
    const packs = results
      .flat()
      .filter((event) => event.kind === DRAFTABLE_KIND && verifyEvent(event))
      .map(parsePackEvent)
      .filter((pack): pack is FollowPack => !!pack);
    const result = classifyLink(packsForLink(packs, dTag, author));
    return result.status === "found" ? result.pack : null;
  } catch {
    return null;
  }
}

export type PreviewProfile = BrainstormProfile;

/**
 * Profiles for link previews, from the Brainstorm archive with a hard
 * timeout. Signatures are checked here since this path doesn't go through a
 * verifying pool.
 */
export async function fetchPreviewProfiles(
  pubkeys: string[],
  timeoutMs: number = 2500,
): Promise<Map<string, PreviewProfile>> {
  const map = new Map<string, PreviewProfile>();
  const authors = [
    ...new Set(
      pubkeys.map((p) => p.toLowerCase()).filter((p) => isFullPubkey(p)),
    ),
  ];
  if (authors.length === 0) return map;
  try {
    const events = await queryRelay(
      BRAINSTORM_SEARCH_RELAY,
      withSearchToken({ kinds: [0], authors, limit: authors.length * 2 }),
      timeoutMs,
    );
    const wanted = new Set(authors);
    const verified = events.filter(
      (event) => wanted.has(event.pubkey) && verifyEvent(event),
    );
    for (const profile of latestProfiles(verified)) {
      map.set(profile.pubkey, profile);
    }
  } catch {
    // previews just go without names/avatars
  }
  return map;
}

export function previewName(profile: PreviewProfile | undefined): string | null {
  const raw = profile?.display_name || profile?.name || "";
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > 40 ? `${cleaned.slice(0, 37)}…` : cleaned;
}
