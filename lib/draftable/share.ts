/**
 * Share messages for Draftable: a pack, or the packs someone's been drafted
 * into. Pure so the wording can be tested; ShareModal copies or posts them.
 */

import { nip19 } from "nostr-tools";
import { FollowPack, packPath } from "./pack";

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
        `${noExit(count)} 🎖️\n\n` +
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
  const url = `${SHARE_ORIGIN}/draftable?npub=${nip19.npubEncode(pubkey)}&view=drafted`;

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
