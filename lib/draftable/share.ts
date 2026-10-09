/**
 * Share messages for Draftable: a pack, or the packs someone's been drafted
 * into. Pure so the wording can be tested; ShareModal copies or posts them.
 */

import { nip19 } from "nostr-tools";
import {
  AUTHOR_PREFIX_LENGTH,
  FollowPack,
  packPath,
  resolvePubkey,
} from "./pack";

/** Shared links always point at production, like Mutable's other tools. */
export const SHARE_ORIGIN = "https://mutable.top";

/**
 * Plain text plus people to mention. A mention becomes a nostr:npub reference
 * (and a `p` tag) in the posted note, and the person's name in the preview.
 */
export type SharePart = string | { pubkey: string; name: string };

/** Who's sharing a pack, relative to it. */
export type PackShareRole = "author" | "drafted" | "bystander";

export function shareContent(parts: SharePart[]): string {
  return parts
    .map((part) =>
      typeof part === "string"
        ? part
        : `nostr:${nip19.npubEncode(part.pubkey)}`,
    )
    .join("");
}

export function shareMentions(parts: SharePart[]): string[] {
  const pubkeys = parts.flatMap((part) =>
    typeof part === "string" ? [] : [part.pubkey],
  );
  return Array.from(new Set(pubkeys));
}

function people(count: number): string {
  return `${count} ${count === 1 ? "person" : "people"}`;
}

function noExit(count: number): string {
  return count === 1
    ? "They weren't asked, and they can't leave."
    : "None of them were asked, and none of them can leave.";
}

export function packShareUrl(pack: Pick<FollowPack, "author" | "dTag">) {
  return `${SHARE_ORIGIN}${packPath(pack)}`;
}

/** The card a pack link unfurls to (served by this app's card route). */
export function packCardPath(pack: Pick<FollowPack, "author" | "dTag">) {
  return `/draftable/card?d=${encodeURIComponent(pack.dTag)}&p=${pack.author.slice(0, AUTHOR_PREFIX_LENGTH)}`;
}

/** Someone's drafted-into lookup, the page a drafted share links to. */
export function draftedShareUrl(pubkey: string) {
  return `${SHARE_ORIGIN}/draftable?npub=${nip19.npubEncode(pubkey)}&view=drafted`;
}

export function packShareMessage(
  pack: FollowPack,
  role: PackShareRole,
  authorName: string,
): SharePart[] {
  const count = pack.members.length;
  const url = packShareUrl(pack);
  const author = { pubkey: pack.author, name: authorName };

  if (role === "author") {
    return [
      `I drafted ${people(count)} into my follow pack “${pack.name}”. ` +
        `Follow ${count === 1 ? "them" : "them all"} in one click. ` +
        `${noExit(count)} Unless they ask me. 🎖️\n\n` +
        `Drafted with Draftable by #Mutable:\n${url}`,
    ];
  }

  if (role === "drafted") {
    const others = count - 1;
    return [
      `I've been drafted into “${pack.name}”, a follow pack by `,
      author,
      others > 0
        ? `, along with ${others} ${others === 1 ? "other person" : "others"}`
        : "",
      `. Nobody asked me, and there's no way out. 🎖️\n\n` +
        `${others > 0 ? "See who else got drafted" : "See the pack"} ` +
        `on Draftable by #Mutable:\n${url}`,
    ];
  }

  return [
    `“${pack.name}” is a follow pack of ${people(count)} drafted by `,
    author,
    `. ${noExit(count)} 🎖️\n\n` +
      `See who's in it on Draftable by #Mutable:\n${url}`,
  ];
}

/**
 * A conscript's public note asking the author to take them out of a pack
 * they never asked to join. Mentions the author so they're notified.
 */
export function releaseRequestMessage(
  pack: FollowPack,
  authorName: string,
): SharePart[] {
  return [
    "Hi ",
    { pubkey: pack.author, name: authorName },
    `, you drafted me into your follow pack “${pack.name}”, but I never asked ` +
      `to be in it, and Nostr gives me no way to leave on my own. Please ` +
      `release me by removing me from the pack.\n\n` +
      `Found it with Draftable by #Mutable:\n${packShareUrl(pack)}`,
  ];
}

/**
 * "Drafted into N packs" for yourself or someone you looked up. `more` means
 * only the first page has loaded, so the count is a floor.
 */
export function draftedShareMessage({
  pubkey,
  name,
  self,
  count,
  more,
}: {
  pubkey: string;
  name: string;
  self: boolean;
  count: number;
  more: boolean;
}): SharePart[] {
  const single = count === 1 && !more;
  const packs = `${count}${more ? "+" : ""} follow ${single ? "pack" : "packs"}`;
  const leave = single ? "it" : "any of them";
  const url = draftedShareUrl(pubkey);

  if (self) {
    return [
      `I've been drafted into ${packs} on Nostr, and I can't leave ${leave}. 🎖️\n\n` +
        `See mine, or look yourself up, on Draftable by #Mutable:\n${url}`,
    ];
  }

  return [
    "Hey ",
    { pubkey, name },
    `, you've been drafted into ${packs} on Nostr, and you can't leave ${leave}. 🎖️\n\n` +
      `See ${single ? "it" : "them"} on Draftable by #Mutable:\n${url}`,
  ];
}

/** A note's text split the way clients render it. */
export type NoteSegment =
  | { type: "text"; value: string }
  | { type: "mention"; value: string; pubkey: string }
  | { type: "url"; value: string }
  | { type: "hashtag"; value: string };

const NOTE_TOKEN =
  /(nostr:(?:npub|nprofile)1[02-9ac-hj-np-z]+|https?:\/\/[^\s<>"]+|#[\p{L}\p{N}_]+)/giu;

export function noteSegments(text: string): NoteSegment[] {
  const out: NoteSegment[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const prev = out[out.length - 1];
    if (prev?.type === "text") prev.value += value;
    else out.push({ type: "text", value });
  };
  let last = 0;
  for (const match of text.matchAll(NOTE_TOKEN)) {
    const start = match.index ?? 0;
    const token = match[0];
    pushText(text.slice(last, start));
    if (token.toLowerCase().startsWith("nostr:")) {
      const pubkey = resolvePubkey(token);
      if (pubkey) out.push({ type: "mention", value: token, pubkey });
      else pushText(token);
    } else if (token.startsWith("#")) {
      out.push({ type: "hashtag", value: token });
    } else {
      // Sentence punctuation after a link isn't part of it.
      const url = token.replace(/[.,!?;:)\]]+$/, "");
      out.push({ type: "url", value: url });
      pushText(token.slice(url.length));
    }
    last = start + token.length;
  }
  pushText(text.slice(last));
  return out;
}

/**
 * Tags for a note built from its text, so edits carry through: a `p` for
 * each person mentioned, a `t` for each hashtag (plus Draftable), and the
 * client tag.
 */
export function noteTags(text: string): string[][] {
  const segments = noteSegments(text);
  const pubkeys = new Set<string>();
  const topics = new Set<string>(["Draftable"]);
  for (const segment of segments) {
    if (segment.type === "mention") pubkeys.add(segment.pubkey);
    if (segment.type === "hashtag") topics.add(segment.value.slice(1));
  }
  return [
    ...Array.from(pubkeys, (pubkey) => ["p", pubkey]),
    ...Array.from(topics, (topic) => ["t", topic]),
    ["client", "Mutable"],
  ];
}

const PROFILE_REF =
  /(?:nostr:)?(?:npub1[02-9ac-hj-np-z]{58}|nprofile1[02-9ac-hj-np-z]+)/gi;

/** npubs and nprofiles pasted into the editor, with or without nostr:. */
export function profileRefs(text: string): { ref: string; pubkey: string }[] {
  const out: { ref: string; pubkey: string }[] = [];
  for (const match of text.matchAll(PROFILE_REF)) {
    const pubkey = resolvePubkey(match[0]);
    if (pubkey) out.push({ ref: match[0], pubkey });
  }
  return out;
}
