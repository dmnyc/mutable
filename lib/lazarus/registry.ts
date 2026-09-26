import type { Event } from "nostr-tools";
import { estimatePrivateItems, getContentEncryption } from "./private-items";

// Lazarus kind registry (spec 0.6.0-draft): the only place kind semantics live.
// https://github.com/dmnyc/lazarus/blob/main/SPEC.md

export type LazarusRanking = "count" | "recency" | "intent";

export type LazarusWarning = "remute" | "stale-relays" | "affects-others";

export interface LazarusItemCount {
  count: number;
  // Encrypted private items exist that weren't decrypted for this count.
  partial: boolean;
  privateCount?: number;
  privateEstimate?: { min: number; max: number };
}

export interface LazarusKindProfile {
  kind: number;
  name: string;
  tier: 1 | 2 | 3;
  ranking: LazarusRanking;
  // An empty item set is a defined state (kind 10044), not clobber evidence.
  meaningfulEmpty: boolean;
  requiredWarnings: LazarusWarning[];
  itemCount: (event: Event) => LazarusItemCount;
  privateItemTypes?: string[];
}

const MUTE_TAG_TYPES = ["p", "word", "t", "e"];

function countTags(types: string[], mayHavePrivateItems = false) {
  return (event: Event): LazarusItemCount => {
    const count = event.tags.filter((tag) => types.includes(tag[0])).length;
    // Kind 3 content is often legacy relay JSON, not hidden list items.
    if (!mayHavePrivateItems || !getContentEncryption(event.content)) {
      return { count, partial: false };
    }
    return {
      count,
      partial: true,
      privateEstimate: estimatePrivateItems(event.content),
    };
  };
}

function contentPresence(event: Event): LazarusItemCount {
  return { count: event.content.trim().length > 0 ? 1 : 0, partial: false };
}

export const LAZARUS_REGISTRY: Record<number, LazarusKindProfile> = {
  3: {
    kind: 3,
    name: "Follow list",
    tier: 1,
    ranking: "count",
    meaningfulEmpty: false,
    requiredWarnings: [],
    itemCount: countTags(["p"], true),
    privateItemTypes: ["p"],
  },
  10000: {
    kind: 10000,
    name: "Mute list",
    tier: 1,
    ranking: "count",
    meaningfulEmpty: false,
    requiredWarnings: ["remute", "affects-others"],
    itemCount: countTags(MUTE_TAG_TYPES, true),
    privateItemTypes: MUTE_TAG_TYPES,
  },
  0: {
    kind: 0,
    name: "Profile",
    tier: 2,
    ranking: "recency",
    meaningfulEmpty: false,
    requiredWarnings: [],
    itemCount: contentPresence,
  },
  10003: {
    kind: 10003,
    name: "Bookmarks",
    tier: 2,
    ranking: "count",
    meaningfulEmpty: false,
    requiredWarnings: [],
    itemCount: countTags(["e", "a"], true),
    privateItemTypes: ["e", "a"],
  },
  10044: {
    kind: 10044,
    name: "Encryption keys (NIP-4e)",
    tier: 2,
    ranking: "intent",
    meaningfulEmpty: true,
    requiredWarnings: ["affects-others"],
    // NIP-4e lists keys in `n` tags; `p` tags belong to kind 4455 key shares.
    itemCount: countTags(["n"]),
  },
  10002: {
    kind: 10002,
    name: "Relay list",
    tier: 3,
    ranking: "recency",
    meaningfulEmpty: false,
    requiredWarnings: ["stale-relays"],
    itemCount: countTags(["r"]),
  },
  10050: {
    kind: 10050,
    name: "DM relays",
    tier: 3,
    ranking: "recency",
    meaningfulEmpty: false,
    requiredWarnings: ["stale-relays"],
    itemCount: countTags(["relay"]),
  },
  10006: {
    kind: 10006,
    name: "Blocked relays",
    tier: 3,
    ranking: "count",
    meaningfulEmpty: false,
    requiredWarnings: [],
    itemCount: countTags(["relay"]),
  },
};

export function getLazarusKindProfiles(): LazarusKindProfile[] {
  return Object.values(LAZARUS_REGISTRY).sort(
    (a, b) => a.tier - b.tier || a.kind - b.kind,
  );
}

export function getLazarusKindProfile(
  kind: number,
): LazarusKindProfile | undefined {
  return LAZARUS_REGISTRY[kind];
}
