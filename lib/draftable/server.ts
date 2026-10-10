/**
 * Server-side pack lookup for link previews (page metadata and the OG card).
 *
 * Talks to a few relays over the runtime's global WebSocket with a hard
 * timeout. Every path degrades to null so a slow relay only costs the preview
 * its details, never the page.
 */

import { verifyEvent, type Event, type Filter } from "nostr-tools";
import { naMetadata, type NaProfile } from "@/lib/nostrArchives";
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

/** Profiles from the nostrarchives index, raced against a timeout. */
export async function fetchPreviewProfiles(
  pubkeys: string[],
  timeoutMs: number = 2500,
): Promise<Map<string, NaProfile>> {
  const map = new Map<string, NaProfile>();
  if (pubkeys.length === 0) return map;
  try {
    const profiles = await Promise.race([
      naMetadata(pubkeys),
      new Promise<NaProfile[]>((resolve) =>
        setTimeout(() => resolve([]), timeoutMs),
      ),
    ]);
    for (const profile of profiles) map.set(profile.pubkey, profile);
  } catch {
    // previews just go without names/avatars
  }
  return map;
}

export function previewName(profile: NaProfile | undefined): string | null {
  const raw =
    profile?.display_name || profile?.preferred_name || profile?.name || "";
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > 40 ? `${cleaned.slice(0, 37)}…` : cleaned;
}
