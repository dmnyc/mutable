import { hexToNote, hexToNpub } from "@/lib/nostr";

/** Generate a link to view a Nostr event on Jumble. */
export function getEventLink(eventId: string): string {
  try {
    const note = hexToNote(eventId);
    return `https://jumble.social/notes/${note}`;
  } catch {
    return "#";
  }
}

/** Generate a link to view a Nostr profile on npub.world. */
export function getProfileLink(pubkey: string): string {
  try {
    return `https://npub.world/${hexToNpub(pubkey)}`;
  } catch {
    return "#";
  }
}
