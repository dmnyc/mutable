/**
 * Server-side pack lookup for link previews (page metadata and the OG card).
 *
 * Talks to a few relays over the runtime's global WebSocket with a hard
 * timeout. Every path degrades to null so a slow relay only costs the preview
 * its details, never the page.
 */

import { verifyEvent, type Event, type Filter } from "nostr-tools";
import { naMetadata, type NaProfile } from "@/lib/nostrArchives";
import { DRAFTABLE_KIND, FollowPack, parsePackEvent } from "./pack";

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

export async function fetchPackForPreview(
  dTag: string,
  author?: string,
  timeoutMs: number = 2500,
): Promise<FollowPack | null> {
  const filter: Filter = { kinds: [DRAFTABLE_KIND], "#d": [dTag], limit: 5 };
  if (author) filter.authors = [author];

  try {
    const results = await Promise.all(
      PREVIEW_RELAYS.map((url) => queryRelay(url, filter, timeoutMs)),
    );
    const packs = results
      .flat()
      .filter(
        (event) =>
          event.kind === DRAFTABLE_KIND &&
          (!author || event.pubkey === author) &&
          verifyEvent(event),
      )
      .map(parsePackEvent)
      .filter((pack): pack is FollowPack => !!pack && pack.dTag === dTag)
      .sort((a, b) => b.createdAt - a.createdAt);
    return packs[0] ?? null;
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
