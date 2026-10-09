import { nip19 } from "nostr-tools";
import { hexToNote } from "@/lib/nostr";

// Nostr Archives is Mutable's viewer for profiles and notes. It only takes
// hex ids, and it has no page for deleted notes or for other event kinds
// (reports, deletions), so those still go to njump.
const ARCHIVE = "https://nostrarchives.com";
const HEX64 = /^[0-9a-f]{64}$/i;

/** A hex event id from hex, note1, or nevent1, or null. */
function eventHex(ref: string): string | null {
  const trimmed = ref.trim();
  if (HEX64.test(trimmed)) return trimmed.toLowerCase();
  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === "note") return decoded.data;
    if (decoded.type === "nevent") return decoded.data.id;
  } catch {
    // not bech32
  }
  return null;
}

/** Generate a link to view a note on Nostr Archives. */
export function getEventLink(eventId: string): string {
  const id = eventHex(eventId);
  return id ? `${ARCHIVE}/notes/${id}` : "#";
}

/**
 * A link to a note this app just published, on Jumble. A brand-new note may
 * not be indexed anywhere yet, so the link is an nevent carrying the relays
 * it went to (and its author) for the client to fetch it from.
 */
export function getPostedNoteLink(
  eventId: string,
  hints: { relays?: string[]; author?: string } = {},
): string {
  try {
    const nevent = nip19.neventEncode({
      id: eventId,
      relays: hints.relays?.slice(0, 3),
      author: hints.author,
    });
    return `https://jumble.social/notes/${nevent}`;
  } catch {
    return "#";
  }
}

/**
 * Generate a link to view a NIP-56 report event on njump. Jumble has no
 * view for kind:1984 events, so report links need a viewer that renders
 * arbitrary event kinds.
 */
export function getReportEventLink(eventId: string): string {
  try {
    const note = hexToNote(eventId);
    return `https://njump.me/${note}`;
  } catch {
    return "#";
  }
}

/**
 * Generate a link to view a NIP-09 deletion request — or a note it targets —
 * on njump, which renders arbitrary event kinds.
 */
export function getDeletionEventLink(eventId: string): string {
  try {
    const note = hexToNote(eventId);
    return `https://njump.me/${note}`;
  } catch {
    return "#";
  }
}

/** Link to an addressable event (a-tag coordinate) on njump via naddr. */
export function getAddressLink(coord: string): string {
  try {
    const [kind, pubkey, identifier = ""] = coord.split(":");
    const naddr = nip19.naddrEncode({
      kind: Number(kind),
      pubkey,
      identifier,
    });
    return `https://njump.me/${naddr}`;
  } catch {
    return "#";
  }
}

/** Generate a link to view a Nostr profile on Nostr Archives. */
export function getProfileLink(pubkey: string): string {
  const trimmed = pubkey.trim();
  if (HEX64.test(trimmed))
    return `${ARCHIVE}/profiles/${trimmed.toLowerCase()}`;
  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === "npub") return `${ARCHIVE}/profiles/${decoded.data}`;
    if (decoded.type === "nprofile") {
      return `${ARCHIVE}/profiles/${decoded.data.pubkey}`;
    }
  } catch {
    // not bech32
  }
  return "#";
}
