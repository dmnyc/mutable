// Share-note builder for the Dossier's "first note" repost. Pure so the
// wording, timestamp, and tags can be tested without mounting the component.
//
// Reposting with a caption is a NIP-18 quote: a kind-1 note whose text carries
// a nostr:nevent reference to the original, plus a `q` tag (and a `p` tag for
// its author) so clients render the quoted note inline and thread it.

import { nip19 } from "nostr-tools";

export const FIRST_NOTE_CAPTION = "I found #MyFirstNote with #Mutable.";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * The note's timestamp as plain text, always in UTC so the post reads the
 * same for every viewer, e.g. "March 3, 2021, 4:12 PM UTC".
 */
export function formatFirstNoteTimestamp(createdAt: number): string {
  const d = new Date(createdAt * 1000);
  const hours = d.getUTCHours();
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const meridiem = hours < 12 ? "AM" : "PM";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}, ${hour12}:${minutes} ${meridiem} UTC`;
}

export interface FirstNoteRef {
  id: string;
  pubkey: string;
  created_at: number;
}

/**
 * Build the kind-1 content and tags for reposting a first note.
 * `relays` are hints written into the nevent and the `q` tag so clients know
 * where to fetch the quoted note from.
 */
export function buildFirstNoteShare(
  note: FirstNoteRef,
  { relays = [] }: { relays?: string[] } = {},
): { content: string; tags: string[][]; nevent: string } {
  const hints = relays.slice(0, 3);
  const nevent = nip19.neventEncode({
    id: note.id,
    relays: hints,
    author: note.pubkey,
  });

  const content = [
    FIRST_NOTE_CAPTION,
    "",
    `📅 ${formatFirstNoteTimestamp(note.created_at)}`,
    "",
    `nostr:${nevent}`,
  ].join("\n");

  const tags: string[][] = [
    ["q", note.id, hints[0] ?? "", note.pubkey],
    ["p", note.pubkey],
    ["t", "MyFirstNote"],
    ["t", "Mutable"],
    ["client", "Mutable"],
  ];

  return { content, tags, nevent };
}
