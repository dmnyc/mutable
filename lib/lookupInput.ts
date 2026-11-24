// Turns whatever someone pastes into a "look up any user" box into a pubkey,
// an event to resolve to its author, or a plain-language reason it can't be
// used. Pure (no network) so every edge case can be tested; the async
// resolver at the bottom is the only part that touches relays.
//
// Why this exists: the lookup boxes used to test `startsWith("npub")` and
// send everything else to a name search, so a pasted nevent came back as
// "No user found", a mistyped npub blew up with a raw decoder error, and a
// pasted nsec was sent to relays as a search term.

import { nip19 } from "nostr-tools";

export type LookupInput =
  | { kind: "empty" }
  | { kind: "pubkey"; pubkey: string }
  /** A note with no author in the reference: fetch it to learn the author. */
  | { kind: "event"; id: string; relays: string[] }
  /** A private key. Never searched, never logged, never sent anywhere. */
  | { kind: "secret" }
  | { kind: "invalid"; message: string }
  /** Anything else: a name or NIP-05 for profile search. */
  | { kind: "name"; query: string };

const HEX64 = /^[0-9a-f]{64}$/i;
const BECH32_REF =
  /^(npub|nprofile|nevent|note|naddr|nsec|ncryptsec)1[02-9ac-hj-np-z]{6,}$/i;
// A reference embedded in a pasted link, e.g. https://jumble.social/notes/note1…
const BECH32_IN_TEXT =
  /(?:npub|nprofile|nevent|note|naddr|nsec|ncryptsec)1[02-9ac-hj-np-z]{6,}/i;

const SECRET_MESSAGE =
  "That looks like a private key (nsec). Never paste it into a website. Use a public npub, name, or NIP-05 instead.";

/** What to show for a bech32 string that won't decode. */
function brokenMessage(prefix: string): string {
  const label = prefix === "note" || prefix === "nevent" ? "note ID" : prefix;
  return `That ${label} doesn’t look right. It may be cut off or have a typo. Paste the full thing again.`;
}

export function parseLookupInput(raw: string): LookupInput {
  let text = raw.trim();
  if (!text) return { kind: "empty" };

  // Pasted from a client or link: nostr:npub1…, @npub1…, https://…/npub1….
  text = text.replace(/^(?:web\+)?nostr:/i, "").replace(/^@/, "");
  if (/^https?:\/\//i.test(text)) {
    const embedded = text.match(BECH32_IN_TEXT);
    if (!embedded) return { kind: "name", query: raw.trim() };
    text = embedded[0];
  }

  if (HEX64.test(text)) return { kind: "pubkey", pubkey: text.toLowerCase() };

  const ref = text.match(BECH32_REF);
  if (!ref) return { kind: "name", query: raw.trim() };
  const prefix = ref[1].toLowerCase();

  if (prefix === "nsec" || prefix === "ncryptsec") return { kind: "secret" };

  try {
    const decoded = nip19.decode(text.toLowerCase());
    switch (decoded.type) {
      case "npub":
        return { kind: "pubkey", pubkey: decoded.data };
      case "nprofile":
        return { kind: "pubkey", pubkey: decoded.data.pubkey };
      case "naddr":
        // An address names its author directly.
        return { kind: "pubkey", pubkey: decoded.data.pubkey };
      case "nevent":
        if (decoded.data.author) {
          return { kind: "pubkey", pubkey: decoded.data.author };
        }
        return {
          kind: "event",
          id: decoded.data.id,
          relays: decoded.data.relays ?? [],
        };
      case "note":
        return { kind: "event", id: decoded.data, relays: [] };
      default:
        return { kind: "invalid", message: brokenMessage(prefix) };
    }
  } catch {
    // Bad checksum, truncated, or the wrong characters.
    return { kind: "invalid", message: brokenMessage(prefix) };
  }
}

/** True when the input is an identifier, so a name search would be pointless. */
export function isDirectLookup(raw: string): boolean {
  const parsed = parseLookupInput(raw);
  return parsed.kind !== "name" && parsed.kind !== "empty";
}

/** The query, shortened so a long paste can't blow out an error message. */
export function shortenForMessage(query: string, max = 40): string {
  const clean = query.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function noUserFoundMessage(query: string): string {
  return `No user found for “${shortenForMessage(query)}”. Try a name, NIP-05, or npub.`;
}

export type LookupResolution =
  | { ok: true; pubkey: string }
  | { ok: false; message: string }
  /** A name: the caller runs its own profile search. */
  | { ok: "name"; query: string };

/**
 * Resolve a parsed identifier to a pubkey. Names are left to the caller,
 * since each page runs its own search with its own relay set and timeout.
 */
export async function resolveLookupInput(
  raw: string,
  fetchEvent: (
    id: string,
    relays: string[],
  ) => Promise<{ pubkey: string } | null>,
): Promise<LookupResolution> {
  const parsed = parseLookupInput(raw);
  switch (parsed.kind) {
    case "empty":
      return { ok: false, message: "Enter a name, NIP-05 or npub first." };
    case "pubkey":
      return { ok: true, pubkey: parsed.pubkey };
    case "secret":
      return { ok: false, message: SECRET_MESSAGE };
    case "invalid":
      return { ok: false, message: parsed.message };
    case "name":
      return { ok: "name", query: parsed.query };
    case "event": {
      let event: { pubkey: string } | null = null;
      try {
        event = await fetchEvent(parsed.id, parsed.relays);
      } catch {
        event = null;
      }
      if (!event) {
        return {
          ok: false,
          message:
            "Couldn’t find that note on the relays, so its author is unknown. Try an npub or name instead.",
        };
      }
      return { ok: true, pubkey: event.pubkey };
    }
  }
}
