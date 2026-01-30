import {
  SimplePool,
  Event,
  EventTemplate,
  VerifiedEvent,
  getPublicKey,
  nip19,
  nip04,
} from "nostr-tools";
import {
  MuteList,
  MuteItem,
  MUTE_LIST_KIND,
  PUBLIC_LIST_KIND,
  Profile,
  PROFILE_KIND,
  FOLLOW_LIST_KIND,
  RELAY_LIST_KIND,
  MutealResult,
  PublicMuteList,
  DomainPurgeResult,
  ReciprocalResult,
} from "@/types";
import { useStore } from "./store";
import { Signer } from "./signers";

// Default relay list - reliable, well-maintained relays
// Based on what works consistently across clients in 2025
// Includes Primal's cache relays for better data coverage
export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol",
  "wss://relay.snort.social",
  "wss://purplepag.es",
  "wss://relay.nostr.net",
];

// Wider list of known relays for maximum coverage (note nuking, archival, discovery)
export const KNOWN_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.snort.social",
  "wss://nostr.wine",
  "wss://relay.primal.net",
  "wss://purplepag.es",
  "wss://offchain.pub",
  "wss://nostr.mom",
  "wss://relay.nostr.net",
  "wss://relay.noswhere.com",
  "wss://relay.0xchat.com",
  "wss://cache0.primal.net",
  "wss://cache1.primal.net",
  "wss://cache2.primal.net",
];

export function normalizeRelayUrl(relay: string): string | null {
  if (!relay) return null;
  const trimmed = relay.trim();
  if (!/^wss?:\/\//i.test(trimmed)) return null;
  return trimmed.replace(/\/+$/, "").toLowerCase();
}

export function normalizeRelayList(relays: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  relays.forEach((relay) => {
    const clean = normalizeRelayUrl(relay);
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    normalized.push(clean);
  });
  return normalized;
}

export function getComprehensiveRelayList(
  relays: string[],
  extraRelays: string[] = [],
): string[] {
  return normalizeRelayList([
    ...relays,
    ...DEFAULT_RELAYS,
    ...KNOWN_RELAYS,
    ...extraRelays,
  ]);
}

// Get expanded relay list by combining user's relays with defaults
export function getExpandedRelayList(
  userRelays: string[],
  maxRelays: number = 8,
): string[] {
  // Prioritize user relays, then add defaults up to the limit
  const relaySet = new Set<string>();

  // Add user relays first (they're more likely to have the user's data)
  for (const relay of userRelays) {
    if (relaySet.size >= maxRelays) break;
    relaySet.add(relay);
  }

  // Fill remaining slots with default relays
  for (const relay of DEFAULT_RELAYS) {
    if (relaySet.size >= maxRelays) break;
    relaySet.add(relay);
  }

  return Array.from(relaySet);
}

// Namespace tags for community packs
export const PACK_NAMESPACE = "mutable";
export const PACK_CATEGORY = "community-pack";

// Nostrguard compatibility
export const NOSTRGUARD_NAMESPACE = "nostrguard";
export const NOSTRGUARD_CATEGORY = "scammer-pack";

// Pack categories
export const PACK_CATEGORIES = {
  SPAM: "spam",
  NSFW: "nsfw",
  SCAM: "scam",
  IMPERSONATION: "impersonation",
  BOT: "bot",
  HARASSMENT: "harassment",
  OTHER: "other",
} as const;

export type PackCategory =
  (typeof PACK_CATEGORIES)[keyof typeof PACK_CATEGORIES];

// Nostr pool instance (singleton)
let pool: SimplePool | null = null;

export function getPool(): SimplePool {
  if (!pool) {
    pool = new SimplePool();
  }
  return pool;
}

// NIP-07 interface (browser extension)
interface WindowWithNostr extends Window {
  nostr?: {
    getPublicKey(): Promise<string>;
    signEvent(event: EventTemplate): Promise<Event>;
    getRelays?(): Promise<{ [url: string]: { read: boolean; write: boolean } }>;
    nip04?: {
      encrypt(pubkey: string, plaintext: string): Promise<string>;
      decrypt(pubkey: string, ciphertext: string): Promise<string>;
    };
  };
}

declare const window: WindowWithNostr;

// Check if NIP-07 extension is available
export function hasNip07(): boolean {
  return typeof window !== "undefined" && window.nostr !== undefined;
}

// Get pubkey from NIP-07 extension
export async function getNip07Pubkey(): Promise<string> {
  if (!hasNip07() || !window.nostr) {
    throw new Error("NIP-07 extension not found");
  }
  return await window.nostr.getPublicKey();
}

// Sign event with NIP-07
export async function signWithNip07(event: EventTemplate): Promise<Event> {
  if (!hasNip07() || !window.nostr) {
    throw new Error("NIP-07 extension not found");
  }
  return await window.nostr.signEvent(event);
}

// Get relays from NIP-07
export async function getNip07Relays(): Promise<string[]> {
  if (!hasNip07() || !window.nostr?.getRelays) {
    return DEFAULT_RELAYS;
  }
  try {
    const relayObj = await window.nostr.getRelays();
    const relays = Object.keys(relayObj).filter((url) => relayObj[url].write);
    return relays.length > 0 ? relays : DEFAULT_RELAYS;
  } catch {
    return DEFAULT_RELAYS;
  }
}

// Get the active signer from the store
export function getSigner(): Signer {
  const signer = useStore.getState().signer;
  if (!signer) {
    throw new Error("No signer connected. Please log in first.");
  }
  return signer;
}

// Sign an event using the active signer
export async function signEvent(event: EventTemplate): Promise<VerifiedEvent> {
  const signer = getSigner();
  return await signer.signEvent(event);
}

// Get the user's public key from the active signer
export async function getSignerPubkey(): Promise<string> {
  const signer = getSigner();
  return await signer.getPublicKey();
}

// Fetch user's relay list from Nostr (NIP-65 kind:10002)
// Returns both the write relays and the full metadata
export async function fetchRelayListFromNostr(pubkey: string): Promise<{
  writeRelays: string[];
  metadata: {
    read: string[];
    write: string[];
    both: string[];
    timestamp: number;
  } | null;
}> {
  const pool = getPool();

  try {
    // Query kind:10002 relay list metadata from default relays
    const events = await pool.querySync(DEFAULT_RELAYS, {
      kinds: [RELAY_LIST_KIND],
      authors: [pubkey],
      limit: 1,
    });

    if (events.length === 0) {
      return { writeRelays: [], metadata: null };
    }

    const event = events[0];
    const read: string[] = [];
    const write: string[] = [];
    const both: string[] = [];

    // Parse all relay tags
    event.tags.forEach((tag) => {
      if (tag[0] === "r") {
        const relay = tag[1];
        const permission = tag[2];

        if (!permission) {
          both.push(relay);
        } else if (permission === "read") {
          read.push(relay);
        } else if (permission === "write") {
          write.push(relay);
        }
      }
    });

    // Extract write relays (both + write)
    const writeRelays = [...both, ...write];

    return {
      writeRelays,
      metadata: {
        read,
        write,
        both,
        timestamp: event.created_at,
      },
    };
  } catch (error) {
    console.error("Failed to fetch relay list from Nostr:", error);
    return { writeRelays: [], metadata: null };
  }
}

// Get best relay list - tries Nostr first, falls back to NIP-07, then defaults
// Returns both the relay URLs and the full metadata (if available from NIP-65)
export async function getBestRelayList(pubkey: string): Promise<{
  relays: string[];
  metadata: {
    read: string[];
    write: string[];
    both: string[];
    timestamp: number;
  } | null;
}> {
  // Try fetching from Nostr first (most accurate, matches what clients like Jumble show)
  const result = await fetchRelayListFromNostr(pubkey);
  if (result.writeRelays.length > 0) {
    console.log("Using relay list from Nostr (NIP-65):", result.writeRelays);
    return { relays: result.writeRelays, metadata: result.metadata };
  }

  // Fall back to NIP-07 extension relays
  const nip07Relays = await getNip07Relays();
  if (nip07Relays.length > 0 && nip07Relays !== DEFAULT_RELAYS) {
    console.log("Using relay list from NIP-07 extension:", nip07Relays);
    return { relays: nip07Relays, metadata: null };
  }

  // Last resort: use defaults
  console.log("Using default relay list");
  return { relays: DEFAULT_RELAYS, metadata: null };
}

// Fetch user's mute list (kind:10000)
export async function fetchMuteList(
  pubkey: string,
  relays: string[] = DEFAULT_RELAYS,
): Promise<Event | null> {
  const pool = getPool();
  const events = await pool.querySync(relays, {
    kinds: [MUTE_LIST_KIND],
    authors: [pubkey],
    limit: 10,
  });

  if (events.length === 0) return null;

  // Sort by created_at to ensure we get the newest event
  events.sort((a, b) => b.created_at - a.created_at);
  return events[0];
}

// Decrypt private mutes from content field using the active signer
async function decryptPrivateMutes(
  encryptedContent: string,
  authorPubkey: string,
): Promise<MuteList> {
  const privateMutes: MuteList = {
    pubkeys: [],
    words: [],
    tags: [],
    threads: [],
  };

  if (!encryptedContent || encryptedContent.trim() === "") {
    return privateMutes;
  }

  try {
    // Get the active signer for decryption
    const signer = useStore.getState().signer;
    if (!signer) {
      console.warn("No signer available for decryption");
      return privateMutes;
    }

    // NIP-04 decryption via signer
    const decrypted = await signer.nip04Decrypt(authorPubkey, encryptedContent);

    const privateTags = JSON.parse(decrypted) as string[][];

    for (const tag of privateTags) {
      const [tagType, value, ...rest] = tag;
      // Extract reason (filter out relay URLs and event IDs)
      const reason = rest.find(
        (item) => !item.startsWith("wss://") && !isEventId(item),
      );
      // Extract event reference if present
      const eventRef = rest.find((item) => isEventId(item));

      switch (tagType) {
        case "p":
          privateMutes.pubkeys.push({
            type: "pubkey",
            value,
            reason,
            eventRef,
            private: true,
          });
          break;
        case "word":
          privateMutes.words.push({
            type: "word",
            value,
            reason,
            eventRef,
            private: true,
          });
          break;
        case "t":
          privateMutes.tags.push({
            type: "tag",
            value,
            reason,
            eventRef,
            private: true,
          });
          break;
        case "e":
          privateMutes.threads.push({
            type: "thread",
            value,
            reason,
            eventRef,
            private: true,
          });
          break;
      }
    }
  } catch (error) {
    console.error("Failed to decrypt private mutes:", error);
  }

  return privateMutes;
}

// Parse mute list event into structured data (handles both public and private mutes)
// If skipCategoryTags is true, 't' tags are skipped (used for kind 30001 public lists where 't' = category, not muted hashtag)
export async function parseMuteListEvent(
  event: Event,
  skipCategoryTags: boolean = false,
  categoriesToSkip: string[] = [],
): Promise<MuteList> {
  const muteList: MuteList = {
    pubkeys: [],
    words: [],
    tags: [],
    threads: [],
  };

  // Parse public mutes from tags
  for (const tag of event.tags) {
    const [tagType, value, ...rest] = tag;
    // Extract reason (filter out relay URLs and event IDs)
    const reason = rest.find(
      (item) => !item.startsWith("wss://") && !isEventId(item),
    );
    // Extract event reference if present
    const eventRef = rest.find((item) => isEventId(item));

    switch (tagType) {
      case "p":
        muteList.pubkeys.push({
          type: "pubkey",
          value,
          reason,
          eventRef,
          private: false,
        });
        break;
      case "word":
        muteList.words.push({
          type: "word",
          value,
          reason,
          eventRef,
          private: false,
        });
        break;
      case "t":
        // For kind 30001 (public lists), some 't' tags are pack categories, not muted hashtags
        // Skip if it's in the categoriesToSkip array (e.g., "spam", "scam", etc.)
        // This allows us to distinguish between pack categories and actual muted hashtags
        const isCategory =
          categoriesToSkip.length > 0 && categoriesToSkip.includes(value);
        if (!skipCategoryTags && !isCategory) {
          muteList.tags.push({
            type: "tag",
            value,
            reason,
            eventRef,
            private: false,
          });
        }
        break;
      case "e":
        muteList.threads.push({
          type: "thread",
          value,
          reason,
          eventRef,
          private: false,
        });
        break;
    }
  }

  // Parse private mutes from encrypted content (if any)
  if (event.content && event.content.trim() !== "") {
    try {
      const privateMutes = await decryptPrivateMutes(
        event.content,
        event.pubkey,
      );
      muteList.pubkeys.push(...privateMutes.pubkeys);
      muteList.words.push(...privateMutes.words);
      muteList.tags.push(...privateMutes.tags);
      muteList.threads.push(...privateMutes.threads);
    } catch (error) {
      console.error("Failed to parse private mutes:", error);
    }
  }

  return muteList;
}

// Separate mute list into public and private items
function separateMuteList(muteList: MuteList): {
  publicList: MuteList;
  privateList: MuteList;
} {
  const publicList: MuteList = {
    pubkeys: muteList.pubkeys.filter((item) => !item.private),
    words: muteList.words.filter((item) => !item.private),
    tags: muteList.tags.filter((item) => !item.private),
    threads: muteList.threads.filter((item) => !item.private),
  };

  const privateList: MuteList = {
    pubkeys: muteList.pubkeys.filter((item) => item.private),
    words: muteList.words.filter((item) => item.private),
    tags: muteList.tags.filter((item) => item.private),
    threads: muteList.threads.filter((item) => item.private),
  };

  return { publicList, privateList };
}

// Convert mute list to event tags (only public items)
export function muteListToTags(muteList: MuteList): string[][] {
  const tags: string[][] = [];

  muteList.pubkeys.forEach((item) => {
    const tag = ["p", item.value];
    // Add reason (or empty string if eventRef but no reason)
    if (item.reason || item.eventRef) {
      tag.push(item.reason || "");
    }
    // Add eventRef if present
    if (item.eventRef) {
      tag.push(item.eventRef);
    }
    tags.push(tag);
  });

  muteList.words.forEach((item) => {
    const tag = ["word", item.value];
    // Add reason (or empty string if eventRef but no reason)
    if (item.reason || item.eventRef) {
      tag.push(item.reason || "");
    }
    // Add eventRef if present
    if (item.eventRef) {
      tag.push(item.eventRef);
    }
    tags.push(tag);
  });

  muteList.tags.forEach((item) => {
    const tag = ["t", item.value];
    // Add reason (or empty string if eventRef but no reason)
    if (item.reason || item.eventRef) {
      tag.push(item.reason || "");
    }
    // Add eventRef if present
    if (item.eventRef) {
      tag.push(item.eventRef);
    }
    tags.push(tag);
  });

  muteList.threads.forEach((item) => {
    const tag = ["e", item.value];
    // Add reason (or empty string if eventRef but no reason)
    if (item.reason || item.eventRef) {
      tag.push(item.reason || "");
    }
    // Add eventRef if present
    if (item.eventRef) {
      tag.push(item.eventRef);
    }
    tags.push(tag);
  });

  return tags;
}

// Encrypt private mutes for content field using the active signer
async function encryptPrivateMutes(
  privateList: MuteList,
  recipientPubkey: string,
): Promise<string> {
  const privateTags = muteListToTags(privateList);

  if (privateTags.length === 0) {
    return "";
  }

  try {
    // Get the active signer for encryption
    const signer = getSigner();

    // NIP-04 encryption via signer (encrypt to yourself)
    const encrypted = await signer.nip04Encrypt(
      recipientPubkey,
      JSON.stringify(privateTags),
    );
    return encrypted;
  } catch (error) {
    console.error("Failed to encrypt private mutes:", error);
    throw new Error(
      "Failed to encrypt private mutes: " +
        (error instanceof Error ? error.message : "Unknown error"),
    );
  }
}

// Publish mute list (handles both public and private mutes)
export async function publishMuteList(
  muteList: MuteList,
  relays: string[] = DEFAULT_RELAYS,
): Promise<Event> {
  // Get current user's pubkey for encryption
  const userPubkey = await getSignerPubkey();

  // Separate public and private items
  const { publicList, privateList } = separateMuteList(muteList);

  // Convert public items to tags
  const tags = muteListToTags(publicList);

  // Encrypt private items for content field
  const encryptedContent = await encryptPrivateMutes(privateList, userPubkey);

  const eventTemplate: EventTemplate = {
    kind: MUTE_LIST_KIND,
    tags,
    content: encryptedContent,
    created_at: Math.floor(Date.now() / 1000),
  };

  const signedEvent = await signEvent(eventTemplate);
  const pool = getPool();

  await Promise.any(pool.publish(relays, signedEvent));

  return signedEvent;
}

// Publish follow list (kind:3)
export async function publishFollowList(
  followPubkeys: string[],
  relays: string[] = DEFAULT_RELAYS,
  content: string = "",
): Promise<Event> {
  // Convert pubkeys to tags
  const tags = followPubkeys.map((pubkey) => ["p", pubkey]);

  const eventTemplate: EventTemplate = {
    kind: FOLLOW_LIST_KIND,
    tags,
    content, // Usually empty or relay metadata JSON
    created_at: Math.floor(Date.now() / 1000),
  };

  const signedEvent = await signEvent(eventTemplate);
  const pool = getPool();

  await Promise.any(pool.publish(relays, signedEvent));

  return signedEvent;
}

// Search for public mute lists by author
export async function searchPublicListsByAuthor(
  authorPubkey: string,
  relays: string[] = DEFAULT_RELAYS,
): Promise<Event[]> {
  const pool = getPool();
  // Filter by namespace to only get mute packs (mutable or nostrguard)
  return await pool.querySync(relays, {
    kinds: [PUBLIC_LIST_KIND],
    authors: [authorPubkey],
    "#L": [PACK_NAMESPACE, NOSTRGUARD_NAMESPACE],
  });
}

// Search for public mute lists by name (d tag)
export async function searchPublicListsByName(
  name: string,
  relays: string[] = DEFAULT_RELAYS,
): Promise<Event[]> {
  const pool = getPool();
  return await pool.querySync(relays, {
    kinds: [PUBLIC_LIST_KIND],
    "#d": [name],
  });
}

// Fetch all public community packs with namespace filtering
export async function fetchAllPublicPacks(
  relays: string[] = DEFAULT_RELAYS,
  limit: number = 100,
  category?: PackCategory,
  includeUntagged: boolean = false,
  includeNostrguard: boolean = true, // NEW: Include nostrguard packs by default
): Promise<Event[]> {
  const pool = getPool();
  const expandedRelays = getExpandedRelayList(relays);

  // If includeUntagged is true, fetch both namespaced and non-namespaced packs
  if (includeUntagged) {
    const filter: any = {
      kinds: [PUBLIC_LIST_KIND],
      limit,
    };

    // Add category filter if specified
    if (category) {
      filter["#t"] = [category];
    }

    return await pool.querySync(expandedRelays, filter);
  }

  // Fetch packs with namespace filtering
  const namespaces = [PACK_NAMESPACE]; // Always include mutable
  if (includeNostrguard) {
    namespaces.push(NOSTRGUARD_NAMESPACE); // Optionally include nostrguard
  }

  const filter: any = {
    kinds: [PUBLIC_LIST_KIND],
    "#L": namespaces,
    limit,
  };

  // Add category filter if specified
  if (category) {
    filter["#t"] = [category];
  }

  console.log("Fetching community packs with filter:", filter);
  const events = await pool.querySync(expandedRelays, filter);
  console.log(
    `Found ${events.length} community pack events (mutable + nostrguard)`,
  );

  return events;
}

// Parse public list event
// Supports both mutable format (using "name" tag) and nostrguard format (using "title" tag)
export async function parsePublicListEvent(event: Event) {
  const dTag = event.tags.find((tag) => tag[0] === "d")?.[1] || "";

  // Support both "name" (mutable) and "title" (nostrguard) tags for display name
  const nameTag = event.tags.find((tag) => tag[0] === "name")?.[1];
  const titleTag = event.tags.find((tag) => tag[0] === "title")?.[1];
  const displayName = nameTag || titleTag || dTag; // Fallback chain

  const descTag = event.tags.find((tag) => tag[0] === "description")?.[1];

  // Check which namespace this pack belongs to
  const namespaceTag = event.tags.find((tag) => tag[0] === "L")?.[1];
  const isMutablePack = namespaceTag === PACK_NAMESPACE;
  const isNostrguardPack = namespaceTag === NOSTRGUARD_NAMESPACE;

  // Extract category tags (t tags that match known categories)
  const categoryValues = Object.values(PACK_CATEGORIES);
  const categories = event.tags
    .filter((tag) => tag[0] === "t")
    .map((tag) => tag[1])
    .filter((cat) =>
      categoryValues.includes(cat as PackCategory),
    ) as PackCategory[];

  // Parse the mute list - pass the category values so we can skip only those specific tags
  const list = await parseMuteListEvent(event, false, categories);

  return {
    id: event.id,
    dTag,
    name: displayName,
    description: descTag,
    author: event.pubkey,
    createdAt: event.created_at,
    list,
    categories,
    isMutablePack, // Track whether this is a mutable-namespaced pack
    isNostrguardPack, // Track whether this is a nostrguard pack
    namespace: namespaceTag, // Track the actual namespace
  };
}

// Publish public mute list
// Generate URL-safe slug from pack name
function generateSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      // Replace spaces and underscores with hyphens
      .replace(/[\s_]+/g, "-")
      // Remove any characters that aren't alphanumeric, hyphens, or periods
      .replace(/[^a-z0-9-.]/g, "")
      // Replace multiple consecutive hyphens with single hyphen
      .replace(/-+/g, "-")
      // Remove leading/trailing hyphens
      .replace(/^-+|-+$/g, "")
  );
}

export async function publishPublicList(
  name: string,
  description: string,
  muteList: MuteList,
  relays: string[] = DEFAULT_RELAYS,
  categories: PackCategory[] = [],
): Promise<Event> {
  const tags = muteListToTags(muteList);
  const slug = generateSlug(name);
  tags.unshift(["d", slug]);
  tags.push(["name", name]);
  if (description) {
    tags.push(["description", description]);
  }

  // Add namespace tags for community pack discoverability
  tags.push(["L", PACK_NAMESPACE]);
  tags.push(["l", PACK_CATEGORY, PACK_NAMESPACE]);

  // Add category tags
  categories.forEach((category) => {
    tags.push(["t", category]);
  });

  const eventTemplate: EventTemplate = {
    kind: PUBLIC_LIST_KIND,
    tags,
    content: "",
    created_at: Math.floor(Date.now() / 1000),
  };

  const signedEvent = await signEvent(eventTemplate);
  const pool = getPool();

  await Promise.any(pool.publish(relays, signedEvent));

  return signedEvent;
}

// Update existing public pack (same as publish, but used for clarity)
export async function updatePublicList(
  dTag: string,
  name: string,
  description: string,
  muteList: MuteList,
  relays: string[] = DEFAULT_RELAYS,
  categories: PackCategory[] = [],
): Promise<Event> {
  // Kind 30001 is a parameterized replaceable event
  // Publishing a new event with the same d-tag will replace the old one
  const tags = muteListToTags(muteList);
  tags.unshift(["d", dTag]); // Use the same d-tag to replace
  tags.push(["name", name]);
  if (description) {
    tags.push(["description", description]);
  }

  // Add namespace tags for community pack discoverability
  tags.push(["L", PACK_NAMESPACE]);
  tags.push(["l", PACK_CATEGORY, PACK_NAMESPACE]);

  // Add category tags
  categories.forEach((category) => {
    tags.push(["t", category]);
  });

  const eventTemplate: EventTemplate = {
    kind: PUBLIC_LIST_KIND,
    tags,
    content: "",
    created_at: Math.floor(Date.now() / 1000),
  };

  const signedEvent = await signEvent(eventTemplate);
  const pool = getPool();

  await Promise.any(pool.publish(relays, signedEvent));

  return signedEvent;
}

// Publish a text note (kind 1) to relays
export async function publishTextNote(
  content: string,
  tags: string[][] = [],
  relays: string[] = DEFAULT_RELAYS,
): Promise<{ success: boolean; event?: Event; error?: string }> {
  try {
    const eventTemplate: EventTemplate = {
      kind: 1, // Text note
      tags,
      content,
      created_at: Math.floor(Date.now() / 1000),
    };

    const signedEvent = await signEvent(eventTemplate);
    const pool = getPool();

    await Promise.any(pool.publish(relays, signedEvent));

    return { success: true, event: signedEvent };
  } catch (error) {
    console.error("Failed to publish text note:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to publish note",
    };
  }
}

// Delete a public pack (publish kind 5 deletion event)
export async function deletePublicList(
  packEventId: string,
  relays: string[] = DEFAULT_RELAYS,
): Promise<Event> {
  const eventTemplate: EventTemplate = {
    kind: 5, // Deletion event
    tags: [
      ["e", packEventId], // Reference the event to delete
    ],
    content: "Deleted pack",
    created_at: Math.floor(Date.now() / 1000),
  };

  const signedEvent = await signEvent(eventTemplate);
  const pool = getPool();

  await Promise.any(pool.publish(relays, signedEvent));

  return signedEvent;
}

// Fetch user's own public packs
export async function fetchUserPublicPacks(
  userPubkey: string,
  relays: string[] = DEFAULT_RELAYS,
): Promise<Event[]> {
  const pool = getPool();
  return await pool.querySync(relays, {
    kinds: [PUBLIC_LIST_KIND],
    authors: [userPubkey],
    "#L": [PACK_NAMESPACE], // Only fetch mutable-namespaced packs
  });
}

// Fetch a single public pack by event ID
export async function fetchPublicListByEventId(
  eventId: string,
  relays: string[] = DEFAULT_RELAYS,
): Promise<PublicMuteList | null> {
  const pool = getPool();
  const expandedRelays = getExpandedRelayList(relays);

  console.log("Querying relays for event:", eventId);
  console.log("Using relays:", expandedRelays);
  console.log("Query filter:", { kinds: [PUBLIC_LIST_KIND], ids: [eventId] });

  const events = await pool.querySync(expandedRelays, {
    kinds: [PUBLIC_LIST_KIND],
    ids: [eventId],
  });

  console.log("Events found:", events.length);

  if (events.length === 0) {
    console.log("No events found on relays");
    return null;
  }

  const event = events[0];
  console.log("Event found:", event);

  const parsed = await parsePublicListEvent(event);

  console.log("Parsed event:", parsed);

  if (!parsed) {
    console.log("Failed to parse event");
    return null;
  }

  return parsed;
}

// Fetch the latest version of a public pack by author pubkey and d-tag
export async function fetchPublicListByDTag(
  authorPubkey: string,
  dTag: string,
  relays: string[] = DEFAULT_RELAYS,
): Promise<PublicMuteList | null> {
  const pool = getPool();
  const expandedRelays = getExpandedRelayList(relays);

  console.log("Querying relays for pack by author and d-tag");
  console.log("Author:", authorPubkey);
  console.log("d-tag:", dTag);
  console.log("Using relays:", expandedRelays);

  // For parameterized replaceable events, we query by author and d-tag
  const events = await pool.querySync(expandedRelays, {
    kinds: [PUBLIC_LIST_KIND],
    authors: [authorPubkey],
    "#d": [dTag],
  });

  console.log("Events found:", events.length);

  if (events.length === 0) {
    console.log("No events found on relays");
    return null;
  }

  // For replaceable events, relays should return only the latest version
  // But just in case, we sort by created_at and take the most recent
  const sortedEvents = events.sort((a, b) => b.created_at - a.created_at);
  const event = sortedEvents[0];
  console.log("Latest event found:", event);

  const parsed = await parsePublicListEvent(event);

  console.log("Parsed event:", parsed);

  if (!parsed) {
    console.log("Failed to parse event");
    return null;
  }

  return parsed;
}

// Convert npub or nprofile to hex
export function npubToHex(npub: string): string {
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type === "npub") {
      return decoded.data;
    }
    if (decoded.type === "nprofile") {
      return decoded.data.pubkey;
    }
    throw new Error("Invalid npub/nprofile format");
  } catch (error) {
    throw new Error("Failed to decode npub/nprofile");
  }
}

// Convert hex to npub
export function hexToNpub(hex: string): string {
  try {
    return nip19.npubEncode(hex);
  } catch (error) {
    throw new Error("Failed to encode npub");
  }
}

// Convert hex event ID to nevent bech32 format
export function hexToNevent(hex: string): string {
  try {
    return nip19.neventEncode({ id: hex });
  } catch (error) {
    // Fallback to note format if nevent fails
    try {
      return nip19.noteEncode(hex);
    } catch {
      throw new Error("Failed to encode event ID");
    }
  }
}

const EVENT_REFERENCE_REGEX =
  /(?:nostr:)?(note1[0-9a-z]+|nevent1[0-9a-z]+|naddr1[0-9a-z]+|[0-9a-f]{64})/i;

function extractEventReference(input: string): string | null {
  if (!input || !input.trim()) return null;
  const match = input.trim().match(EVENT_REFERENCE_REGEX);
  if (!match) return null;
  return match[1];
}

export type EventAddress = {
  kind: number;
  pubkey: string;
  identifier: string;
};

export function parseEventAddress(address: string): EventAddress | null {
  if (!address) return null;
  const firstColon = address.indexOf(":");
  if (firstColon === -1) return null;
  const secondColon = address.indexOf(":", firstColon + 1);
  if (secondColon === -1) return null;
  const kindRaw = address.slice(0, firstColon);
  const pubkey = address.slice(firstColon + 1, secondColon);
  const identifier = address.slice(secondColon + 1);
  const kind = Number(kindRaw);
  if (!Number.isFinite(kind) || kind <= 0) return null;
  if (!/^[0-9a-f]{64}$/i.test(pubkey)) return null;
  return { kind, pubkey: pubkey.toLowerCase(), identifier };
}

export type ParsedEventTarget = {
  eventId: string | null;
  address: string | null;
  reference: string | null;
};

export function parseEventTarget(input: string): ParsedEventTarget {
  const reference = extractEventReference(input);
  if (!reference) {
    return { eventId: null, address: null, reference: null };
  }

  if (reference.match(/^[0-9a-f]{64}$/i)) {
    return {
      eventId: reference.toLowerCase(),
      address: null,
      reference: reference.toLowerCase(),
    };
  }

  try {
    const decoded = nip19.decode(reference.toLowerCase());
    if (decoded.type === "nevent") {
      return { eventId: decoded.data.id, address: null, reference };
    }
    if (decoded.type === "note") {
      return { eventId: decoded.data, address: null, reference };
    }
    if (decoded.type === "naddr") {
      const identifier = decoded.data.identifier ?? "";
      const address = `${decoded.data.kind}:${decoded.data.pubkey}:${identifier}`;
      return { eventId: null, address, reference };
    }
  } catch (error) {
    console.error("Failed to parse event target:", error);
  }

  return { eventId: null, address: null, reference };
}

// Validate and convert event reference (nevent/note) to hex event ID
export function parseEventReference(input: string): string | null {
  const cleaned = extractEventReference(input);
  if (!cleaned) return null;

  // If already hex, validate and return
  if (cleaned.match(/^[0-9a-f]{64}$/i)) {
    return cleaned.toLowerCase();
  }

  try {
    // Decode using nip19
    const decoded = nip19.decode(cleaned.toLowerCase());

    // Handle nevent (contains event ID + optional relays)
    if (decoded.type === "nevent") {
      return decoded.data.id;
    }

    // Handle note (just event ID)
    if (decoded.type === "note") {
      return decoded.data;
    }

    return null;
  } catch (error) {
    console.error("Failed to parse event reference:", error);
    return null;
  }
}

export async function fetchEventByAddress(
  address: string,
  relays: string[] = DEFAULT_RELAYS,
  timeoutMs: number = 8000,
): Promise<Event | null> {
  const parsed = parseEventAddress(address);
  if (!parsed) return null;
  const pool = getPool();
  const expandedRelays = getExpandedRelayList(relays);

  try {
    const events = await Promise.race([
      pool.querySync(expandedRelays, {
        kinds: [parsed.kind],
        authors: [parsed.pubkey],
        "#d": [parsed.identifier],
        limit: 3,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Event fetch timeout")), timeoutMs),
      ),
    ]);

    if (events.length === 0) return null;
    events.sort((a, b) => b.created_at - a.created_at);
    return events[0];
  } catch (error) {
    console.error("Failed to fetch event by address:", error);
    return null;
  }
}

// Convert hex event ID to note1... format for display
export function hexToNote(eventId: string): string {
  try {
    return nip19.noteEncode(eventId);
  } catch (error) {
    throw new Error("Failed to encode note");
  }
}

// Fetch a single event by ID from relays
export async function fetchEventById(
  eventId: string,
  relays: string[] = DEFAULT_RELAYS,
  timeoutMs: number = 8000,
): Promise<Event | null> {
  const pool = getPool();
  // Use expanded relay list to maximize chances of finding the event
  const expandedRelays = getExpandedRelayList(relays);

  try {
    const events = await Promise.race([
      pool.querySync(expandedRelays, {
        ids: [eventId],
        limit: 3,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Event fetch timeout")), timeoutMs),
      ),
    ]);

    if (events.length === 0) return null;
    events.sort((a, b) => b.created_at - a.created_at);
    return events[0];
  } catch (error) {
    console.error("Failed to fetch event by ID:", error);
    return null;
  }
}

export type RelayPublishStatus = "success" | "error" | "timeout" | "rejected";

export async function publishEventToRelay(
  relayUrl: string,
  event: Event,
  timeoutMs: number = 10000,
): Promise<{ status: RelayPublishStatus; message?: string }> {
  return await new Promise((resolve) => {
    const normalized = normalizeRelayUrl(relayUrl);
    if (!normalized) {
      resolve({ status: "error", message: "Invalid relay URL" });
      return;
    }

    let settled = false;
    const ws = new WebSocket(normalized);
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        // Ignore
      }
      resolve({ status: "timeout" });
    }, timeoutMs);

    const finalize = (status: RelayPublishStatus, message?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        ws.close();
      } catch {
        // Ignore
      }
      resolve({ status, message });
    };

    ws.onopen = () => {
      ws.send(JSON.stringify(["EVENT", event]));
    };

    ws.onmessage = (msg) => {
      try {
        const response = JSON.parse(msg.data);
        if (response[0] !== "OK") return;
        if (response[2] === true) {
          finalize("success");
        } else {
          finalize(
            "rejected",
            typeof response[3] === "string" ? response[3] : undefined,
          );
        }
      } catch (error) {
        finalize("error");
      }
    };

    ws.onerror = () => {
      finalize("error");
    };

    ws.onclose = () => {
      finalize("error");
    };
  });
}

// Check if string is a valid hex event ID
function isEventId(str: string): boolean {
  return /^[0-9a-f]{64}$/i.test(str);
}

// Fetch profile metadata for a specific pubkey
export async function fetchProfile(
  pubkey: string,
  relays: string[] = DEFAULT_RELAYS,
  timeoutMs: number = 5000, // 5 second timeout for mobile
): Promise<Profile | null> {
  const pool = getPool();

  // Use expanded relay list to maximize chances of finding the profile
  const expandedRelays = getExpandedRelayList(relays);

  try {
    // Add timeout wrapper around querySync
    const events = await Promise.race([
      pool.querySync(expandedRelays, {
        kinds: [PROFILE_KIND],
        authors: [pubkey],
        limit: 5,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Profile fetch timeout")), timeoutMs),
      ),
    ]);

    if (events.length === 0) return null;

    // Sort by created_at descending to get the most recent profile
    events.sort((a, b) => b.created_at - a.created_at);
    const newestEvent = events[0];

    try {
      // Sanitize content by removing control characters before parsing
      // Control characters (ASCII 0-31 and 127-159) can break JSON.parse()
      const sanitizedContent = newestEvent.content.replace(
        /[\u0000-\u001F\u007F-\u009F]/g,
        "",
      );
      const metadata = JSON.parse(sanitizedContent);
      return {
        pubkey,
        name: metadata.name || "",
        display_name: metadata.display_name || "",
        about: metadata.about || "",
        picture: metadata.picture || "",
        banner: metadata.banner || "",
        nip05: metadata.nip05 || "",
        lud16: metadata.lud16 || "",
        website: metadata.website || "",
      };
    } catch (error) {
      console.error(
        `Failed to parse profile for ${pubkey.substring(0, 8)}:`,
        error,
      );
      return null;
    }
  } catch (error) {
    // Timeout or fetch error - return null gracefully
    if (error instanceof Error && error.message === "Profile fetch timeout") {
      console.warn(`Profile fetch timeout for ${pubkey.substring(0, 8)}`);
    } else {
      console.error(
        `Failed to fetch profile for ${pubkey.substring(0, 8)}:`,
        error,
      );
    }
    return null;
  }
}

// Primal cache WebSocket connection
let primalWs: WebSocket | null = null;
let primalConnected = false;
let primalConnecting = false;
const primalPendingRequests = new Map<
  string,
  {
    resolve: (value: any[]) => void;
    reject: (reason?: any) => void;
    timeout: NodeJS.Timeout;
    results: any[];
  }
>();

// Connect to Primal cache
async function connectToPrimal(): Promise<boolean> {
  if (primalConnected) {
    return true;
  }

  if (primalConnecting) {
    // Wait for existing connection attempt
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (primalConnected || !primalConnecting) {
          clearInterval(checkInterval);
          resolve(primalConnected);
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkInterval);
        resolve(false);
      }, 5000);
    });
  }

  primalConnecting = true;

  try {
    const endpoint = "wss://cache2.primal.net/v1";
    console.log(`🔍 Connecting to Primal cache: ${endpoint}`);

    return await new Promise((resolve, reject) => {
      primalWs = new WebSocket(endpoint);

      const connectionTimeout = setTimeout(() => {
        if (!primalConnected) {
          primalWs?.close();
          reject(new Error("Connection timeout"));
        }
      }, 5000);

      primalWs.onopen = () => {
        clearTimeout(connectionTimeout);
        primalConnected = true;
        primalConnecting = false;
        console.log("✅ Connected to Primal cache");
        resolve(true);
      };

      primalWs.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const [type, requestId, payload] = message;

          if (type === "EVENT" && primalPendingRequests.has(requestId)) {
            const request = primalPendingRequests.get(requestId)!;
            if (payload && payload.kind === 0) {
              request.results.push(payload);
            }
          }

          if (type === "EOSE" && primalPendingRequests.has(requestId)) {
            const request = primalPendingRequests.get(requestId)!;
            clearTimeout(request.timeout);
            request.resolve(request.results);
            primalPendingRequests.delete(requestId);
          }

          if (type === "NOTICE" && primalPendingRequests.has(requestId)) {
            const request = primalPendingRequests.get(requestId)!;
            clearTimeout(request.timeout);
            request.reject(new Error(`Primal cache error: ${payload}`));
            primalPendingRequests.delete(requestId);
          }
        } catch (error) {
          console.error("Failed to parse Primal cache message:", error);
        }
      };

      primalWs.onerror = (error) => {
        clearTimeout(connectionTimeout);
        // Silently fail - we have relay fallback
        primalConnected = false;
        primalConnecting = false;
        reject(error);
      };

      primalWs.onclose = () => {
        console.log("🔌 Primal cache connection closed");
        primalConnected = false;
        primalConnecting = false;
      };
    });
  } catch (error) {
    primalConnecting = false;
    return false;
  }
}

// Search Primal cache
async function searchPrimalCache(query: string, limit: number): Promise<any[]> {
  const connected = await connectToPrimal();
  if (!connected) {
    throw new Error("Failed to connect to Primal cache");
  }

  const requestId = `primal_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      primalPendingRequests.delete(requestId);
      reject(new Error("Search timeout"));
    }, 5000);

    primalPendingRequests.set(requestId, {
      resolve,
      reject,
      timeout,
      results: [],
    });

    const searchQuery = [
      "REQ",
      requestId,
      {
        cache: [
          "user_search",
          {
            query,
            limit,
          },
        ],
      },
    ];

    primalWs!.send(JSON.stringify(searchQuery));
  });
}

// Search profiles by query string (searches name, display_name, nip05)
export async function searchProfiles(
  query: string,
  relays: string[] = DEFAULT_RELAYS,
  limit: number = 20,
): Promise<Profile[]> {
  // First, check if query is a pubkey, npub, or nprofile
  let searchPubkey: string | null = null;
  try {
    if (query.startsWith("npub") || query.startsWith("nprofile")) {
      searchPubkey = npubToHex(query);
    } else if (query.match(/^[0-9a-f]{64}$/i)) {
      searchPubkey = query.toLowerCase();
    }
  } catch (error) {
    // Not a valid pubkey format
  }

  // If it's a direct pubkey lookup, fetch that profile
  if (searchPubkey) {
    const profile = await fetchProfile(searchPubkey, relays);
    return profile ? [profile] : [];
  }

  // Try Primal cache first for comprehensive search results
  try {
    console.log(`🔍 Searching Primal cache for "${query}"...`);
    const primalResults = await searchPrimalCache(query, limit);

    if (primalResults && primalResults.length > 0) {
      console.log(`✅ Primal cache returned ${primalResults.length} results`);

      const profiles: Profile[] = [];
      for (const event of primalResults) {
        try {
          const metadata = JSON.parse(event.content);

          // Filter out mostr.pub bridged profiles
          if (metadata.nip05 && metadata.nip05.includes("mostr.pub")) {
            continue;
          }

          const profile: Profile = {
            pubkey: event.pubkey,
            name: metadata.name,
            display_name: metadata.display_name,
            about: metadata.about,
            picture: metadata.picture,
            nip05: metadata.nip05,
            lud16: metadata.lud16,
          };

          profiles.push(profile);
        } catch (error) {
          continue;
        }
      }

      return profiles;
    }
  } catch (error) {
    console.warn(
      "⚠️ Primal cache search failed, falling back to relay search:",
      error,
    );
  }

  // Fallback: fetch recent profiles from relays and filter by query
  const pool = getPool();
  const events = await pool.querySync(relays, {
    kinds: [PROFILE_KIND],
    limit: 1000,
  });

  const profiles: Profile[] = [];
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/);

  for (const event of events) {
    try {
      const metadata = JSON.parse(event.content);

      const name = (metadata.name || "").toLowerCase();
      const displayName = (metadata.display_name || "").toLowerCase();
      const nip05 = (metadata.nip05 || "").toLowerCase();

      if (nip05.includes("mostr.pub")) {
        continue;
      }

      const profile: Profile = {
        pubkey: event.pubkey,
        name: metadata.name,
        display_name: metadata.display_name,
        about: metadata.about,
        picture: metadata.picture,
        nip05: metadata.nip05,
        lud16: metadata.lud16,
      };

      const nameWords = name.split(/\s+/);
      const displayNameWords = displayName.split(/\s+/);

      const hasDirectMatch =
        name.includes(queryLower) ||
        displayName.includes(queryLower) ||
        nip05.includes(queryLower);

      const hasWordMatch = queryWords.every(
        (qWord: string) =>
          nameWords.some((nWord: string) => nWord.includes(qWord)) ||
          displayNameWords.some((dWord: string) => dWord.includes(qWord)),
      );

      const hasStartMatch = queryWords.every(
        (qWord: string) =>
          nameWords.some((nWord: string) => nWord.startsWith(qWord)) ||
          displayNameWords.some((dWord: string) => dWord.startsWith(qWord)),
      );

      if (hasDirectMatch || hasWordMatch || hasStartMatch) {
        profiles.push(profile);
      }

      if (profiles.length >= limit) break;
    } catch (error) {
      continue;
    }
  }

  return profiles;
}

// Fetch user's follow list (kind:3)
export async function fetchFollowList(
  pubkey: string,
  relays: string[] = DEFAULT_RELAYS,
  retries: number = 0,
): Promise<Event | null> {
  const pool = getPool();

  // Use only the user's configured relays (not expanded with defaults)
  // This ensures we query their actual relays where their follow list is stored

  // Wait a moment for relay connections to stabilize before querying
  if (retries === 0) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  // Query with higher limit to get multiple events, then pick the newest
  // This ensures we don't get a stale event from a slow/outdated relay
  const events = await pool.querySync(relays, {
    kinds: [FOLLOW_LIST_KIND],
    authors: [pubkey],
    limit: 10, // Get multiple events to ensure we get the newest one
  });

  // If no events found and retries remaining, wait and try again
  if (events.length === 0 && retries > 0) {
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
    return fetchFollowList(pubkey, relays, retries - 1);
  }

  // Sort by created_at descending to get the most recent event
  if (events.length > 0) {
    events.sort((a, b) => b.created_at - a.created_at);
    return events[0];
  }

  return null;
}

// Remove a user from follow list
export async function unfollowUser(
  targetPubkey: string,
  relays: string[] = DEFAULT_RELAYS,
): Promise<Event> {
  // Fetch current follow list
  const currentFollowList = await fetchFollowList(
    await getSignerPubkey(),
    relays,
  );

  // Filter out the target pubkey from the follow list
  const tags = currentFollowList
    ? currentFollowList.tags.filter(
        (tag) => tag[0] === "p" && tag[1] !== targetPubkey,
      )
    : [];

  const eventTemplate: EventTemplate = {
    kind: FOLLOW_LIST_KIND,
    tags,
    content: currentFollowList?.content || "",
    created_at: Math.floor(Date.now() / 1000),
  };

  const signedEvent = await signEvent(eventTemplate);
  const pool = getPool();

  await Promise.any(pool.publish(relays, signedEvent));

  return signedEvent;
}

// Remove multiple users from follow list (optimized - publishes once)
export async function unfollowMultipleUsers(
  targetPubkeys: string[],
  relays: string[] = DEFAULT_RELAYS,
): Promise<Event> {
  // Fetch current follow list
  const currentFollowList = await fetchFollowList(
    await getSignerPubkey(),
    relays,
  );

  // Create a Set of target pubkeys for efficient lookup
  const targetSet = new Set(targetPubkeys);

  // Filter out all target pubkeys from the follow list
  const tags = currentFollowList
    ? currentFollowList.tags.filter(
        (tag) => tag[0] === "p" && !targetSet.has(tag[1]),
      )
    : [];

  const eventTemplate: EventTemplate = {
    kind: FOLLOW_LIST_KIND,
    tags,
    content: currentFollowList?.content || "",
    created_at: Math.floor(Date.now() / 1000),
  };

  const signedEvent = await signEvent(eventTemplate);
  const pool = getPool();

  await Promise.any(pool.publish(relays, signedEvent));

  return signedEvent;
}

// Check if a user is in the follow list
export async function isFollowing(
  targetPubkey: string,
  userPubkey: string,
  relays: string[] = DEFAULT_RELAYS,
): Promise<boolean> {
  const followList = await fetchFollowList(userPubkey, relays);
  if (!followList) return false;

  return followList.tags.some(
    (tag) => tag[0] === "p" && tag[1] === targetPubkey,
  );
}

// ============================================================================
// MUTEUALS DISCOVERY FUNCTIONS
// ============================================================================

// Fetch all public mute lists from a specific author
export async function fetchPublicMuteLists(
  authorPubkey: string,
  relays: string[] = DEFAULT_RELAYS,
): Promise<Event[]> {
  const pool = getPool();
  return await pool.querySync(relays, {
    kinds: [PUBLIC_LIST_KIND],
    authors: [authorPubkey],
  });
}

// Search for muteuals within your follow list
export async function searchMutealsFromFollows(
  userPubkey: string,
  relays: string[] = DEFAULT_RELAYS,
  onProgress?: (current: number, total: number) => void,
  abortSignal?: AbortSignal,
): Promise<MutealResult[]> {
  const pool = getPool();
  const muteuals: MutealResult[] = [];

  // Step 1: Fetch user's follow list
  const followListEvent = await fetchFollowList(userPubkey, relays);
  if (!followListEvent) {
    return muteuals;
  }

  // Extract pubkeys from follow list
  const followedPubkeys = followListEvent.tags
    .filter((tag) => tag[0] === "p")
    .map((tag) => tag[1]);

  if (followedPubkeys.length === 0) {
    return muteuals;
  }

  console.log(
    `Checking ${followedPubkeys.length} follows for kind:10000 mute lists`,
  );

  // Step 2: Fetch ALL kind:10000 mute lists from followed users in one query
  console.log("Fetching all kind:10000 events from your follows...");
  const allMuteListEvents = await pool.querySync(relays, {
    kinds: [MUTE_LIST_KIND], // kind 10000
    authors: followedPubkeys,
  });

  console.log(
    `Found ${allMuteListEvents.length} kind:10000 events from your follows`,
  );

  // Group by author and keep only the latest per author
  const latestByAuthor = new Map<string, Event>();
  for (const event of allMuteListEvents) {
    const existing = latestByAuthor.get(event.pubkey);
    if (!existing || event.created_at > existing.created_at) {
      latestByAuthor.set(event.pubkey, event);
    }
  }

  console.log(
    `After deduplication: ${latestByAuthor.size} unique authors with mute lists`,
  );

  // Step 3: Check each follow's latest mute list
  let checked = 0;
  for (const followedPubkey of followedPubkeys) {
    // Check if scan was aborted
    if (abortSignal?.aborted) {
      console.log(
        `Scan aborted after checking ${checked}/${followedPubkeys.length} follows`,
      );
      break;
    }

    checked++;
    if (onProgress) {
      onProgress(checked, followedPubkeys.length);
    }

    const muteListEvent = latestByAuthor.get(followedPubkey);
    if (!muteListEvent) {
      continue; // This follow doesn't have a kind:10000 mute list
    }

    // Check if it contains the user's pubkey
    const hasMuted = muteListEvent.tags.some(
      (tag) => tag[0] === "p" && tag[1] === userPubkey,
    );

    if (hasMuted) {
      console.log(
        `MUTEUAL FOUND: ${followedPubkey} has you in their mute list`,
      );

      muteuals.push({
        mutedBy: followedPubkey,
        listName: "Public Mute List",
        listDescription: undefined,
        mutedAt: muteListEvent.created_at,
        isFollowing: true,
        eventId: muteListEvent.id,
      });
    }
  }

  console.log(
    `Follows scan complete: Found ${muteuals.length} Muteuals out of ${followedPubkeys.length} follows`,
  );
  return muteuals;
}

// Search for muteuals network-wide
export async function searchMutealsNetworkWide(
  userPubkey: string,
  relays: string[] = DEFAULT_RELAYS,
  onProgress?: (count: number) => void,
  abortSignal?: AbortSignal,
  onResultFound?: (result: MutealResult) => void,
): Promise<MutealResult[]> {
  const pool = getPool();
  const muteuals: MutealResult[] = [];
  const seenPubkeys = new Set<string>();

  // Query all mute lists (kind 10000) that contain the user's pubkey in PUBLIC tags
  // Per NIP-51, kind 10000 mute lists have:
  // - PUBLIC mutes in the 'tags' array (what we search)
  // - PRIVATE mutes encrypted in the 'content' field (which we cannot see)
  // NOTE: Kind 10000 is a REPLACEABLE event, meaning each user should only have ONE
  // But we might get multiple old versions from different relays

  console.log(
    `🔍 Searching ${relays.length} relays for mute lists containing ${userPubkey.substring(0, 8)}...`,
  );
  console.log(`📡 Relays being queried:`, relays);

  // Use subscription-based approach for better mobile reliability
  // This allows us to collect events as they stream in rather than waiting for all relays
  let events: Event[] = [];

  try {
    events = await new Promise<Event[]>((resolve, reject) => {
      const collectedEvents: Event[] = [];
      const seenEventIds = new Set<string>();
      let timeout: NodeJS.Timeout;
      let checkInterval: NodeJS.Timeout;
      let eoseCount = 0; // Track EOSE from each relay
      let lastEventTime = Date.now();
      let resolved = false; // Guard against multiple resolutions

      const sub = pool.subscribeMany(
        relays,
        {
          kinds: [MUTE_LIST_KIND],
          "#p": [userPubkey],
          limit: 5000, // High limit to ensure we get all results
        } as any, // Type assertion needed for tag filter
        {
          onevent(event) {
            // Deduplicate events by ID (same event from multiple relays)
            if (!seenEventIds.has(event.id)) {
              seenEventIds.add(event.id);
              collectedEvents.push(event);

              // Update last event time when we receive a NEW event
              lastEventTime = Date.now();

              // Update progress as events come in
              if (onProgress && collectedEvents.length % 10 === 0) {
                onProgress(collectedEvents.length);
              }
            }
          },
          oneose() {
            // EOSE (End of Stored Events) received from a relay
            eoseCount++;
            console.log(
              `Received EOSE ${eoseCount}/${relays.length}, collected ${collectedEvents.length} events so far`,
            );

            // Calculate how many relays we should wait for (80% or all, whichever is first)
            // This ensures mobile connections don't miss results due to slow/unresponsive relays
            const targetEoseCount = Math.max(1, Math.ceil(relays.length * 0.8));

            // If we've received EOSE from 80% of relays (or all), wait a bit for any in-flight events
            if (eoseCount >= targetEoseCount) {
              const eventCountBeforeWait = collectedEvents.length;
              const receivedFromAll = eoseCount >= relays.length;
              console.log(
                `⏳ Received EOSE from ${eoseCount}/${relays.length} relays (target: ${targetEoseCount}) at ${eventCountBeforeWait} events, waiting ${receivedFromAll ? "5s" : "3s"} for in-flight events...`,
              );
              // Give a grace period for any events still in transit (especially on mobile)
              // Shorter wait if not all relays responded, to avoid excessive delays
              const waitTime = receivedFromAll ? 5000 : 3000;
              setTimeout(() => {
                if (resolved) return;
                resolved = true;
                const additionalEvents =
                  collectedEvents.length - eventCountBeforeWait;
                console.log(
                  `✅ Grace period complete! Started with ${eventCountBeforeWait}, received ${additionalEvents} more during wait, closing with ${collectedEvents.length} total events`,
                );
                clearInterval(checkInterval);
                clearTimeout(timeout);
                sub.close();
                resolve(collectedEvents);
              }, waitTime);
            }
          },
        },
      );

      // Set timeout - very long to ensure all relays respond, especially on mobile
      // For users with many mute lists (600+), we need sufficient time
      timeout = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        console.log(
          `Query timeout reached after 60s, collected ${collectedEvents.length} events from ${eoseCount}/${relays.length} relays`,
        );
        sub.close();
        resolve(collectedEvents);
      }, 60000); // 60 second timeout

      // Fallback: Also resolve if events stop coming in AND we've waited long enough for EOSE
      // This is only a safety net - we should normally close via EOSE callback above
      checkInterval = setInterval(() => {
        const timeSinceLastEvent = Date.now() - lastEventTime;

        // Only use inactivity timer if:
        // 1. We've received EOSE from at least SOME relays (not stuck)
        // 2. No new events for 20 seconds (very conservative for mobile/slow connections)
        if (eoseCount > 0 && timeSinceLastEvent > 20000) {
          if (resolved) return;
          resolved = true;
          console.log(
            `No new events for 20s and received ${eoseCount}/${relays.length} EOSE, closing with ${collectedEvents.length} events`,
          );
          clearInterval(checkInterval);
          clearTimeout(timeout);
          sub.close();
          resolve(collectedEvents);
        }
      }, 1000);
    });

    console.log(`Initial query returned ${events.length} events`);
  } catch (error) {
    console.error("⚠️ Initial query failed:", error);
    console.error(
      "This may indicate slow relay connections. Try again or check your connection.",
    );
    return [];
  }

  // Group events by author to find the LATEST one per author
  // Kind 10000 is REPLACEABLE, so we should only use the newest event per author
  const eventsByAuthor = new Map<string, Event>();
  for (const event of events) {
    const existing = eventsByAuthor.get(event.pubkey);
    if (!existing || event.created_at > existing.created_at) {
      eventsByAuthor.set(event.pubkey, event);
    } else {
      console.log(
        `⏭️  Skipping older event from ${event.pubkey.substring(0, 8)}: ${new Date(event.created_at * 1000).toISOString()} (newer: ${new Date(existing.created_at * 1000).toISOString()})`,
      );
    }
  }

  console.log(
    `🔄 After deduplication: ${eventsByAuthor.size} unique authors (removed ${events.length - eventsByAuthor.size} duplicate/stale events from total ${events.length})`,
  );

  // Note: We previously had a "verification step" that re-fetched events for each author
  // to check if they had newer events where the user was unmuted. However, this is
  // unnecessary because:
  // 1. Kind 10000 is a REPLACEABLE event - relays automatically return only the latest version
  // 2. The #p filter already ensures we only get events where the user IS muted
  // 3. The verification step caused timeouts and data loss on mobile
  // 4. If someone unmuted you, their latest event wouldn't match the #p filter anyway
  //
  // Therefore, we trust the initial query results as authoritative.

  // Get user's follow list to check if they're following the muteals
  const followListEvent = await fetchFollowList(userPubkey, relays);
  const followedPubkeys = new Set(
    followListEvent?.tags
      .filter((tag) => tag[0] === "p")
      .map((tag) => tag[1]) || [],
  );

  // Now iterate through only the LATEST event per author
  for (const event of eventsByAuthor.values()) {
    // Check if scan was aborted
    if (abortSignal?.aborted) {
      console.log(`Scan aborted after checking ${seenPubkeys.size} authors`);
      break;
    }

    const pTags = event.tags.filter((t) => t[0] === "p");
    const allTagTypes = [...new Set(event.tags.map((t) => t[0]))];

    console.log("Analyzing kind:10000 event:", {
      id: event.id,
      author: event.pubkey,
      created_at: new Date(event.created_at * 1000).toISOString(),
      totalTags: event.tags.length,
      tagTypes: allTagTypes,
      pTagCount: pTags.length,
      pTags: pTags.map((t) => ({ pubkey: t[1], relay: t[2] })),
      content: event.content.substring(0, 100),
    });

    // Kind 10000 is the standard public mute list, so no need to check d-tag
    // Just verify the event actually contains the user's pubkey in a 'p' tag
    const hasMuted = event.tags.some(
      (tag) => tag[0] === "p" && tag[1] === userPubkey,
    );

    if (hasMuted) {
      seenPubkeys.add(event.pubkey);

      const result: MutealResult = {
        mutedBy: event.pubkey,
        listName: "Public Mute List",
        listDescription: undefined,
        mutedAt: event.created_at,
        isFollowing: followedPubkeys.has(event.pubkey),
        eventId: event.id,
      };

      muteuals.push(result);

      // Call streaming callback immediately when result is found
      if (onResultFound) {
        onResultFound(result);
      }

      if (onProgress) {
        onProgress(muteuals.length);
      }
    }
  }

  return muteuals;
}

// Fetch profiles for muteuals results
export async function enrichMutealsWithProfiles(
  muteuals: MutealResult[],
  relays: string[] = DEFAULT_RELAYS,
  onProgress?: (current: number, total: number) => void,
  abortSignal?: AbortSignal,
  batchSize: number = 5, // Fetch 5 profiles in parallel
): Promise<MutealResult[]> {
  // Process in batches for better performance on mobile
  const batches: MutealResult[][] = [];
  for (let i = 0; i < muteuals.length; i += batchSize) {
    batches.push(muteuals.slice(i, i + batchSize));
  }

  const enriched: MutealResult[] = [];
  let processedCount = 0;

  for (const batch of batches) {
    try {
      // Check if enrichment was aborted
      if (abortSignal?.aborted) {
        console.log(
          `Profile enrichment aborted after ${processedCount}/${muteuals.length} profiles`,
        );
        // Return what we have so far with remaining items without profiles
        const remainingIndex = processedCount;
        return [...enriched, ...muteuals.slice(remainingIndex)];
      }

      // Fetch all profiles in this batch in parallel with Promise.allSettled
      // This ensures one timeout doesn't block others
      const profilePromises = batch.map((muteal) =>
        fetchProfile(muteal.mutedBy, relays)
          .then((profile) => ({ muteal, profile }))
          .catch((error) => {
            console.error(
              `Failed to fetch profile for ${muteal.mutedBy}:`,
              error,
            );
            return { muteal, profile: null };
          }),
      );

      const results = await Promise.allSettled(profilePromises);

      // Process results
      results.forEach((result) => {
        if (result.status === "fulfilled") {
          enriched.push({
            ...result.value.muteal,
            profile: result.value.profile || undefined,
          });
        } else {
          // This shouldn't happen since we catch errors above, but just in case
          console.error("Unexpected rejection in batch:", result.reason);
        }
      });

      processedCount += batch.length;
      if (onProgress) {
        onProgress(processedCount, muteuals.length);
      }

      // Small delay between batches to let relay connections recover
      if (processedCount < muteuals.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch (batchError) {
      // If entire batch fails, log it and continue with next batch
      console.error(
        `Batch processing error, continuing with next batch:`,
        batchError,
      );
      // Add the batch items without profiles so they still appear
      batch.forEach((muteal) => {
        enriched.push({
          ...muteal,
          profile: undefined,
        });
      });
      processedCount += batch.length;
    }
  }

  return enriched;
}

// Get follow list as array of pubkeys
export async function getFollowListPubkeys(
  pubkey: string,
  relays: string[] = DEFAULT_RELAYS,
  retries: number = 2,
): Promise<string[]> {
  const followListEvent = await fetchFollowList(pubkey, relays, retries);
  if (!followListEvent) return [];

  // Extract pubkeys from p tags
  return followListEvent.tags
    .filter((tag) => tag[0] === "p" && tag[1])
    .map((tag) => tag[1]);
}

// ============================================================================
// LIST CLEANER - ACCOUNT ACTIVITY FUNCTIONS
// ============================================================================

/**
 * Check profile activity status for a single pubkey
 * Queries multiple event kinds to determine if profile is active or abandoned
 * Uses aggressive retry strategy similar to plebs-vs-zombies
 *
 * @param pubkey - Hex pubkey to check
 * @param relays - Relays to query
 * @param inactivityThresholdDays - Number of days to consider as inactive (default: 180)
 * @returns AccountActivityStatus object with activity details
 */
export async function checkAccountActivity(
  pubkey: string,
  relays: string[] = DEFAULT_RELAYS,
  inactivityThresholdDays: number = 180,
): Promise<import("@/types").AccountActivityStatus> {
  const pool = getPool();
  const expandedRelays = getExpandedRelayList(relays);

  let events: any[] = [];

  try {
    // STRATEGY 1: Comprehensive search across all event kinds
    // Query for recent events across MANY kinds to determine activity (comprehensive like plebs-vs-zombies)
    // This includes: profiles, notes, channels, DMs, reactions, reposts, zaps, lists, long-form content, etc.
    console.log(
      `🔍 Strategy 1: Comprehensive search for ${pubkey.substring(0, 8)}... across ${expandedRelays.length} relays`,
    );

    events = await pool.querySync(expandedRelays, {
      kinds: [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 40, 41, 42, 43, 44, 1063,
        1311, 1984, 1985, 9734, 9735, 10000, 10001, 10002, 30000, 30001, 30008,
        30009, 30017, 30018, 30023, 30024, 31890, 31922, 31923, 31924, 31925,
        31989, 31990, 34550,
      ],
      authors: [pubkey],
      limit: 500, // Higher limit to catch more events
      // No 'since' filter - we want to find the MOST RECENT activity regardless of when it was
    });

    console.log(
      `   ✓ Strategy 1: Found ${events.length} events for ${pubkey.substring(0, 8)}...`,
    );

    // STRATEGY 2: If we found less than 5 events, try a more focused search for common activity
    // Sometimes comprehensive searches miss things, so try specific kinds separately
    if (events.length < 5) {
      console.log(
        `🔍 Strategy 2: Focused search for ${pubkey.substring(0, 8)}... (found only ${events.length} so far)`,
      );

      // Try kind 1 (notes) separately - most common activity
      const noteEvents = await pool.querySync(expandedRelays, {
        kinds: [1],
        authors: [pubkey],
        limit: 100,
      });
      console.log(`   ✓ Strategy 2a: Found ${noteEvents.length} notes`);

      // Try kind 6 (reposts) separately
      const repostEvents = await pool.querySync(expandedRelays, {
        kinds: [6],
        authors: [pubkey],
        limit: 100,
      });
      console.log(`   ✓ Strategy 2b: Found ${repostEvents.length} reposts`);

      // Try kind 7 (reactions) separately
      const reactionEvents = await pool.querySync(expandedRelays, {
        kinds: [7],
        authors: [pubkey],
        limit: 100,
      });
      console.log(`   ✓ Strategy 2c: Found ${reactionEvents.length} reactions`);

      // Combine all results
      const allEvents = [
        ...events,
        ...noteEvents,
        ...repostEvents,
        ...reactionEvents,
      ];
      // Deduplicate by event id
      const uniqueEvents = Array.from(
        new Map(allEvents.map((e) => [e.id, e])).values(),
      );
      events = uniqueEvents;
      console.log(
        `   ✓ Strategy 2: Combined total ${events.length} unique events`,
      );
    }

    // STRATEGY 3: If still nothing, try JUST profile with no limit
    if (events.length === 0) {
      console.log(
        `🔍 Strategy 3: Last resort profile search for ${pubkey.substring(0, 8)}...`,
      );
      events = await pool.querySync(expandedRelays, {
        kinds: [0], // Just profiles
        authors: [pubkey],
        // No limit - get everything
      });
      console.log(`   ✓ Strategy 3: Found ${events.length} profile events`);
    }

    if (events.length === 0) {
      // No events found after all strategies - likely deleted or never existed
      console.log(
        `❌ No events found for ${pubkey.substring(0, 8)}... after all strategies`,
      );
      return {
        pubkey,
        lastActivityTimestamp: null,
        lastActivityType: null,
        daysInactive: null,
        hasProfile: false,
        isLikelyAbandoned: true,
      };
    }

    // Find the most recent event
    const sortedEvents = events.sort((a, b) => b.created_at - a.created_at);
    const latestEvent = sortedEvents[0];
    const lastActivityTimestamp = latestEvent.created_at;

    console.log(
      `✅ Found activity for ${pubkey.substring(0, 8)}...: ${events.length} events, most recent ${Math.floor((Date.now() / 1000 - lastActivityTimestamp) / 86400)} days ago (kind ${latestEvent.kind})`,
    );

    // Determine event type (comprehensive mapping)
    const kindToType: Record<number, string> = {
      0: "profile",
      1: "note",
      2: "recommend_relay",
      3: "follows",
      4: "encrypted_dm",
      5: "event_deletion",
      6: "repost",
      7: "reaction",
      8: "badge_award",
      9: "group_chat_message",
      10: "group_chat_threaded_reply",
      11: "group_thread",
      12: "group_thread_reply",
      40: "channel_create",
      41: "channel_metadata",
      42: "channel_message",
      43: "channel_hide_message",
      44: "channel_mute_user",
      1063: "file_metadata",
      1311: "live_chat_message",
      1984: "reporting",
      1985: "label",
      9734: "zap_request",
      9735: "zap",
      10000: "mute_list",
      10001: "pin_list",
      10002: "relay_list",
      30000: "categorized_people",
      30001: "categorized_bookmarks",
      30008: "profile_badges",
      30009: "badge_definition",
      30017: "create_or_update_stall",
      30018: "create_or_update_product",
      30023: "long_form_content",
      30024: "draft_long_form_content",
      31890: "feed",
      31922: "date_based_calendar_event",
      31923: "time_based_calendar_event",
      31924: "calendar",
      31925: "calendar_event_rsvp",
      31989: "handler_recommendation",
      31990: "handler_information",
      34550: "community_post_approval",
    };
    const lastActivityType =
      kindToType[latestEvent.kind] || `kind_${latestEvent.kind}`;

    // Check if they have a profile
    const hasProfile = events.some((e) => e.kind === 0);

    // Calculate days inactive
    const nowSeconds = Math.floor(Date.now() / 1000);
    const secondsInactive = nowSeconds - lastActivityTimestamp;
    const daysInactive = Math.floor(secondsInactive / 86400);

    // Determine if likely abandoned
    const isLikelyAbandoned = daysInactive >= inactivityThresholdDays;

    return {
      pubkey,
      lastActivityTimestamp,
      lastActivityType,
      daysInactive,
      hasProfile,
      isLikelyAbandoned,
    };
  } catch (error) {
    console.error(`Failed to check activity for ${pubkey}:`, error);
    // On error, assume account exists but we couldn't verify
    return {
      pubkey,
      lastActivityTimestamp: null,
      lastActivityType: null,
      daysInactive: null,
      hasProfile: false,
      isLikelyAbandoned: false, // Don't mark as abandoned if we had an error
    };
  }
}

/**
 * Batch check profile activity for multiple pubkeys
 * Processes in batches with progress tracking and abort capability
 *
 * @param pubkeys - Array of hex pubkeys to check
 * @param relays - Relays to query
 * @param inactivityThresholdDays - Number of days to consider as inactive (default: 180)
 * @param onProgress - Optional callback for progress updates (current, total)
 * @param abortSignal - Optional AbortSignal to cancel operation
 * @returns Array of AccountActivityStatus objects
 */
export async function batchCheckAccountActivity(
  pubkeys: string[],
  relays: string[] = DEFAULT_RELAYS,
  inactivityThresholdDays: number = 180,
  onProgress?: (current: number, total: number) => void,
  abortSignal?: AbortSignal,
): Promise<import("@/types").AccountActivityStatus[]> {
  const results: import("@/types").AccountActivityStatus[] = [];
  const BATCH_SIZE = 5; // Process only 5 accounts at a time to avoid overwhelming relays

  console.log(
    `🚀 Starting batch account activity check for ${pubkeys.length} accounts`,
  );
  console.log(`   Inactivity threshold: ${inactivityThresholdDays} days`);
  console.log(`   Batch size: ${BATCH_SIZE} accounts per batch`);
  console.log(`   Relays: ${relays.length} relays will be queried`);

  for (let i = 0; i < pubkeys.length; i += BATCH_SIZE) {
    // Check if operation was aborted
    if (abortSignal?.aborted) {
      console.log(
        `⏸️  Batch check aborted after processing ${results.length}/${pubkeys.length} accounts`,
      );
      break;
    }

    const batch = pubkeys.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(pubkeys.length / BATCH_SIZE);

    console.log(
      `\n📦 Batch ${batchNum}/${totalBatches}: Processing ${batch.length} accounts...`,
    );

    // Process batch in parallel using Promise.allSettled for error tolerance
    const batchPromises = batch.map((pubkey) =>
      checkAccountActivity(pubkey, relays, inactivityThresholdDays),
    );

    const batchResults = await Promise.allSettled(batchPromises);

    // Extract successful results
    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        console.error("❌ Failed to check account:", result.reason);
      }
    }

    // Report progress
    if (onProgress) {
      onProgress(results.length, pubkeys.length);
    }

    console.log(
      `✅ Batch ${batchNum} complete: ${results.length}/${pubkeys.length} total accounts processed`,
    );

    // Longer delay between batches to avoid overwhelming relays
    if (i + BATCH_SIZE < pubkeys.length && !abortSignal?.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 second delay
    }
  }

  console.log(
    `Batch check complete: Processed ${results.length}/${pubkeys.length} accounts`,
  );

  // Summary statistics
  const abandoned = results.filter((r) => r.isLikelyAbandoned).length;
  const noProfile = results.filter((r) => !r.hasProfile).length;
  console.log(
    `Summary: ${abandoned} likely abandoned, ${noProfile} without profiles`,
  );

  return results;
}

// ============================================================================
// DOMAIN PURGE FUNCTIONS
// ============================================================================

/**
 * Search for all users in follow list with a specific NIP-05 domain
 * @param domain - The domain to search for (e.g., "example.com")
 * @param userPubkey - The user's pubkey
 * @param relays - Relays to query
 * @param onProgress - Progress callback (current, total)
 * @param abortSignal - AbortSignal to cancel the operation
 * @returns Array of users with matching domain
 */
export async function searchFollowsByNip05Domain(
  domain: string,
  userPubkey: string,
  relays: string[] = DEFAULT_RELAYS,
  onProgress?: (current: number, total: number) => void,
  abortSignal?: AbortSignal,
): Promise<DomainPurgeResult[]> {
  console.log(`🔍 Searching for follows with NIP-05 domain: ${domain}`);

  // Normalize domain (remove @ prefix if present, convert to lowercase)
  const normalizedDomain = domain.replace(/^@/, "").toLowerCase().trim();

  if (!normalizedDomain) {
    throw new Error("Domain cannot be empty");
  }

  // Fetch user's follow list
  const followPubkeys = await getFollowListPubkeys(userPubkey, relays);

  if (followPubkeys.length === 0) {
    console.log("No follows found");
    return [];
  }

  console.log(`Found ${followPubkeys.length} follows to check`);

  const results: DomainPurgeResult[] = [];
  const BATCH_SIZE = 10; // Process profiles in batches

  // Process follows in batches
  for (let i = 0; i < followPubkeys.length; i += BATCH_SIZE) {
    if (abortSignal?.aborted) {
      throw new Error("Search cancelled");
    }

    const batch = followPubkeys.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(followPubkeys.length / BATCH_SIZE);

    console.log(`Processing batch ${batchNum}/${totalBatches}`);

    // Fetch profiles for this batch
    const profilePromises = batch.map(async (pubkey) => {
      try {
        const profile = await fetchProfile(pubkey, relays);
        return { pubkey, profile };
      } catch (err) {
        console.error(`Failed to fetch profile for ${pubkey}:`, err);
        return { pubkey, profile: null };
      }
    });

    const batchResults = await Promise.allSettled(profilePromises);

    // Check each profile for matching NIP-05 domain
    for (const result of batchResults) {
      if (result.status === "fulfilled" && result.value.profile?.nip05) {
        const nip05 = result.value.profile.nip05.toLowerCase();

        // Check if NIP-05 ends with the domain (handles both "user@domain.com" and "domain.com")
        if (
          nip05.endsWith(`@${normalizedDomain}`) ||
          nip05 === normalizedDomain
        ) {
          results.push({
            pubkey: result.value.pubkey,
            profile: result.value.profile,
            nip05: result.value.profile.nip05,
            isFollowing: true, // They're in the follow list, so we know this is true
          });

          console.log(`✅ Found match: ${result.value.profile.nip05}`);
        }
      }
    }

    // Report progress
    if (onProgress) {
      const processed = Math.min(i + BATCH_SIZE, followPubkeys.length);
      onProgress(processed, followPubkeys.length);
    }

    // Small delay between batches
    if (i + BATCH_SIZE < followPubkeys.length && !abortSignal?.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  console.log(
    `✅ Domain search complete: Found ${results.length} matches for domain "${normalizedDomain}"`,
  );

  return results;
}

/**
 * Mass mute and unfollow users from domain purge results
 * @param pubkeys - Array of pubkeys to mute and unfollow
 * @param userPubkey - The user's pubkey
 * @param relays - Relays to use
 * @param currentMuteList - Current mute list to update
 * @param reason - Optional reason for muting
 * @returns Updated mute list event and follow list event
 */
export async function massMuteAndUnfollowDomain(
  pubkeys: string[],
  userPubkey: string,
  relays: string[] = DEFAULT_RELAYS,
  currentMuteList: MuteList,
  reason: string = "Domain purge",
): Promise<{ muteEvent: Event; followEvent: Event }> {
  console.log(`🚫 Mass muting and unfollowing ${pubkeys.length} users`);

  // 1. Add all pubkeys to mute list (if not already muted)
  const updatedMuteList = { ...currentMuteList };

  for (const pubkey of pubkeys) {
    const alreadyMuted = updatedMuteList.pubkeys.some(
      (m) => m.value === pubkey,
    );
    if (!alreadyMuted) {
      updatedMuteList.pubkeys.push({
        type: "pubkey",
        value: pubkey,
        reason,
        private: false, // Public mutes by default
      });
    }
  }

  // 2. Publish updated mute list
  const muteEvent = await publishMuteList(updatedMuteList, relays);
  console.log("✅ Mute list published");

  // 3. Update follow list to remove all these pubkeys
  const currentFollowList = await fetchFollowList(userPubkey, relays);

  if (!currentFollowList) {
    throw new Error("Failed to fetch current follow list");
  }

  // Filter out all the pubkeys we're unfollowing
  const updatedTags = currentFollowList.tags.filter(
    (tag) => tag[0] === "p" && !pubkeys.includes(tag[1]),
  );

  const followEventTemplate: EventTemplate = {
    kind: FOLLOW_LIST_KIND,
    tags: updatedTags,
    content: currentFollowList.content || "",
    created_at: Math.floor(Date.now() / 1000),
  };

  const followEvent = await signEvent(followEventTemplate);
  const pool = getPool();

  await Promise.any(pool.publish(relays, followEvent));

  console.log("✅ Follow list updated");

  return { muteEvent, followEvent };
}

// Check reciprocal follows - find users you follow who don't follow you back
export async function checkReciprocalFollows(
  userPubkey: string,
  relays: string[] = DEFAULT_RELAYS,
  onProgress?: (current: number, total: number) => void,
  abortSignal?: AbortSignal,
): Promise<string[]> {
  const pool = getPool();

  // Step 1: Get the user's follow list (who they follow)
  const userFollowList = await fetchFollowList(userPubkey, relays);

  if (!userFollowList) {
    return []; // User follows nobody or follow list couldn't be fetched
  }

  // Extract all followed pubkeys
  const followedPubkeys = userFollowList.tags
    .filter((tag) => tag[0] === "p" && tag[1])
    .map((tag) => tag[1]);

  if (followedPubkeys.length === 0) {
    return []; // User follows nobody
  }

  const totalToCheck = followedPubkeys.length;

  // Step 2: Query followed users' follow lists in chunks to avoid relay limits
  // Most relays reject queries with too many authors (>100-500)
  const expandedRelays = getExpandedRelayList(relays);
  const CHUNK_SIZE = 100; // Query 100 authors at a time
  const allFollowListEvents: Event[] = [];

  for (let i = 0; i < followedPubkeys.length; i += CHUNK_SIZE) {
    // Check for abort
    if (abortSignal?.aborted) {
      return [];
    }

    const chunk = followedPubkeys.slice(i, i + CHUNK_SIZE);
    const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
    const totalChunks = Math.ceil(followedPubkeys.length / CHUNK_SIZE);

    if (onProgress) {
      onProgress(i, totalToCheck);
    }

    try {
      const events = await pool.querySync(expandedRelays, {
        kinds: [FOLLOW_LIST_KIND],
        authors: chunk,
      });

      allFollowListEvents.push(...events);
    } catch (err) {
      console.error(
        `Reciprocals check: Error fetching chunk ${chunkNum}:`,
        err,
      );
    }

    // Small delay between chunks to avoid overwhelming relays
    if (i + CHUNK_SIZE < followedPubkeys.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // Check for abort
  if (abortSignal?.aborted) {
    return [];
  }

  // Step 3: Deduplicate events - keep only the newest event per author
  const followListsByAuthor = new Map<string, Event>();

  for (const event of allFollowListEvents) {
    const existing = followListsByAuthor.get(event.pubkey);

    // Keep the newer event (higher created_at timestamp)
    if (!existing || event.created_at > existing.created_at) {
      followListsByAuthor.set(event.pubkey, event);
    }
  }

  // Log summary of results
  const missingCount = followedPubkeys.length - followListsByAuthor.size;
  if (missingCount > 0) {
    console.log(
      `Reciprocals: Successfully fetched ${followListsByAuthor.size}/${followedPubkeys.length} follow lists (${missingCount} missing - may show as non-reciprocal)`,
    );
  }

  // Step 4: Check each followed user to see if they follow back
  const nonReciprocalFollows: string[] = [];
  const missingFollowLists: string[] = [];
  let checked = 0;

  for (const followedPubkey of followedPubkeys) {
    // Check for abort
    if (abortSignal?.aborted) {
      break;
    }

    const theirFollowList = followListsByAuthor.get(followedPubkey);

    if (!theirFollowList) {
      // Couldn't fetch their follow list - mark as non-reciprocal but track separately
      nonReciprocalFollows.push(followedPubkey);
      missingFollowLists.push(followedPubkey);
    } else {
      // We have their follow list - check if they follow back
      const followsBack = theirFollowList.tags.some(
        (tag) => tag[0] === "p" && tag[1] === userPubkey,
      );

      if (!followsBack) {
        nonReciprocalFollows.push(followedPubkey);
      }
    }

    checked++;

    // Report progress every 10 users
    if (onProgress && checked % 10 === 0) {
      onProgress(checked, totalToCheck);
    }
  }

  // Step 5: Second pass - try to fetch missing follow lists from users' preferred relays (NIP-65)
  if (missingFollowLists.length > 0 && !abortSignal?.aborted) {
    console.log(
      `Reciprocals: ${missingFollowLists.length} follow lists missing. Starting second pass with NIP-65 relay discovery...`,
    );

    if (onProgress) {
      onProgress(0, missingFollowLists.length);
    }

    const SECOND_PASS_CHUNK_SIZE = 20; // Smaller chunks for second pass
    let recoveredCount = 0;

    for (
      let i = 0;
      i < missingFollowLists.length;
      i += SECOND_PASS_CHUNK_SIZE
    ) {
      if (abortSignal?.aborted) break;

      const chunk = missingFollowLists.slice(i, i + SECOND_PASS_CHUNK_SIZE);

      if (onProgress) {
        onProgress(i, missingFollowLists.length);
      }

      // Fetch relay lists for this chunk
      const relayListPromises = chunk.map((pubkey) =>
        fetchRelayListFromNostr(pubkey).catch(() => ({
          writeRelays: [],
          metadata: null,
        })),
      );
      const relayLists = await Promise.all(relayListPromises);

      // For each user, try their preferred relays
      for (let j = 0; j < chunk.length; j++) {
        if (abortSignal?.aborted) break;

        const pubkey = chunk[j];
        const { writeRelays } = relayLists[j];

        if (writeRelays.length === 0) continue;

        try {
          // Query this user's preferred relays for their follow list
          const events = await pool.querySync(writeRelays, {
            kinds: [FOLLOW_LIST_KIND],
            authors: [pubkey],
            limit: 1,
          });

          if (events.length > 0) {
            const followList = events[0];
            const followsBack = followList.tags.some(
              (tag) => tag[0] === "p" && tag[1] === userPubkey,
            );

            // Remove from non-reciprocal list if they actually follow back
            if (followsBack) {
              const index = nonReciprocalFollows.indexOf(pubkey);
              if (index !== -1) {
                nonReciprocalFollows.splice(index, 1);
                recoveredCount++;
              }
            }
          }
        } catch (err) {
          // Relay query failed, keep as non-reciprocal
        }
      }

      // Small delay between chunks
      if (i + SECOND_PASS_CHUNK_SIZE < missingFollowLists.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    if (recoveredCount > 0) {
      console.log(
        `Reciprocals: Second pass recovered ${recoveredCount} follow lists, reducing false positives from ${missingFollowLists.length} to ${missingFollowLists.length - recoveredCount}`,
      );
    } else {
      console.log(
        `Reciprocals: Second pass completed, but couldn't recover any follow lists. ${missingFollowLists.length} users still marked as non-reciprocal (possible false positives)`,
      );
    }
  }

  // Final progress report
  if (onProgress && checked > 0) {
    onProgress(checked, totalToCheck);
  }

  return nonReciprocalFollows;
}

// Check if a specific user follows you back
export async function checkSpecificUserReciprocal(
  userPubkey: string,
  targetPubkey: string,
  relays: string[] = DEFAULT_RELAYS,
): Promise<{ followsBack: boolean; isFollowing: boolean }> {
  const pool = getPool();

  // Check if user follows the target
  const userFollowList = await fetchFollowList(userPubkey, relays);
  const isFollowing =
    userFollowList?.tags.some(
      (tag) => tag[0] === "p" && tag[1] === targetPubkey,
    ) || false;

  // If user doesn't follow target, reciprocity doesn't apply
  if (!isFollowing) {
    return { followsBack: false, isFollowing: false };
  }

  // Check if target follows user back
  const targetFollowList = await fetchFollowList(targetPubkey, relays);
  const followsBack =
    targetFollowList?.tags.some(
      (tag) => tag[0] === "p" && tag[1] === userPubkey,
    ) || false;

  return { followsBack, isFollowing: true };
}

// ============================================================================
// PURGATORY - CLIENT TAG FILTERING
// ============================================================================

/**
 * Find follows who are publishing events with a specific client tag
 * Searches recent events from each followed user for matching client tags
 *
 * @param userPubkey - The user's pubkey to get follow list from
 * @param clientString - The client string to search for (case-insensitive contains match)
 * @param relays - Relays to query
 * @param onProgress - Progress callback (current, total)
 * @param abortSignal - Optional abort signal to cancel the operation
 * @returns Array of ClientFilterResult for users with matching client tags
 */
export async function findFollowsUsingClient(
  userPubkey: string,
  clientString: string,
  relays: string[] = DEFAULT_RELAYS,
  onProgress?: (current: number, total: number) => void,
  abortSignal?: AbortSignal,
  onResult?: (result: import("@/types").ClientFilterResult) => void,
): Promise<import("@/types").ClientFilterResult[]> {
  const pool = getPool();
  const expandedRelays = getExpandedRelayList(relays);
  const results: import("@/types").ClientFilterResult[] = [];

  // Get follow list
  const followPubkeys = await getFollowListPubkeys(userPubkey, relays);
  if (followPubkeys.length === 0) {
    return [];
  }

  const total = followPubkeys.length;
  const normalizedClientString = clientString.toLowerCase();
  const BATCH_SIZE = 5;

  // Cache for user relay lists (NIP-65)
  const userRelayCache = new Map<string, string[]>();

  // Process in batches
  for (let i = 0; i < followPubkeys.length; i += BATCH_SIZE) {
    if (abortSignal?.aborted) {
      break;
    }

    const batch = followPubkeys.slice(i, i + BATCH_SIZE);

    const batchPromises = batch.map(async (pubkey) => {
      try {
        // Try to get user's preferred relays via NIP-65
        let userRelays = userRelayCache.get(pubkey);
        if (!userRelays) {
          try {
            const relayResult = await Promise.race([
              fetchRelayListFromNostr(pubkey),
              new Promise<{ writeRelays: string[] }>((resolve) =>
                setTimeout(() => resolve({ writeRelays: [] }), 3000),
              ),
            ]);
            userRelays =
              relayResult.writeRelays.length > 0
                ? relayResult.writeRelays.slice(0, 5) // Limit to 5 relays per user
                : [];
            userRelayCache.set(pubkey, userRelays);
          } catch {
            userRelays = [];
          }
        }

        // Combine user's relays with default expanded relays (user's first for priority)
        const queryRelays = [
          ...new Set([...userRelays, ...expandedRelays.slice(0, 8)]),
        ].slice(0, 10);

        // Query recent events from this user
        const events = await Promise.race([
          pool.querySync(queryRelays, {
            kinds: [0, 1, 6, 7, 30023], // Profile, notes, reposts, reactions, long-form
            authors: [pubkey],
            limit: 50, // Check last 50 events
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Query timeout")), 8000),
          ),
        ]);

        // Find events with matching client tag
        const matchingEvents = events.filter((event) => {
          const clientTag = event.tags.find((tag) => tag[0] === "client");
          if (!clientTag || !clientTag[1]) return false;
          return clientTag[1].toLowerCase().includes(normalizedClientString);
        });

        if (matchingEvents.length > 0) {
          // Get the actual client tag value from the first match
          const clientTag = matchingEvents[0].tags.find(
            (tag) => tag[0] === "client",
          );
          const clientValue = clientTag ? clientTag[1] : clientString;

          // Find most recent event
          const mostRecent = matchingEvents.reduce((latest, event) =>
            event.created_at > latest.created_at ? event : latest,
          );

          // Fetch profile for this user
          const profile = await fetchProfile(pubkey, relays);

          return {
            pubkey,
            profile: profile || undefined,
            clientTag: clientValue,
            eventCount: matchingEvents.length,
            lastSeen: mostRecent.created_at,
          };
        }
        return null;
      } catch (error) {
        console.error(
          `Failed to check client for ${pubkey.substring(0, 8)}:`,
          error,
        );
        return null;
      }
    });

    const batchResults = await Promise.allSettled(batchPromises);

    for (const result of batchResults) {
      if (result.status === "fulfilled" && result.value) {
        results.push(result.value);
        // Immediately notify of new result for real-time UI updates
        onResult?.(result.value);
      }
    }

    // Update progress
    const processed = Math.min(i + BATCH_SIZE, total);
    onProgress?.(processed, total);

    // Small delay between batches to avoid overwhelming relays
    if (i + BATCH_SIZE < followPubkeys.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // Sort by most recently seen
  results.sort((a, b) => b.lastSeen - a.lastSeen);

  return results;
}

// Find follows who have posted hellthreads (top-level notes with excessive p tags)
export async function findFollowsPostingHellthreads(
  userPubkey: string,
  threshold: number,
  relays: string[] = DEFAULT_RELAYS,
  onProgress?: (current: number, total: number) => void,
  abortSignal?: AbortSignal,
  onResult?: (result: import("@/types").HellthreadResult) => void,
): Promise<import("@/types").HellthreadResult[]> {
  const pool = getPool();
  const expandedRelays = getExpandedRelayList(relays);
  const results: import("@/types").HellthreadResult[] = [];

  // Get follow list
  const followPubkeys = await getFollowListPubkeys(userPubkey, relays);
  if (followPubkeys.length === 0) {
    return [];
  }

  const total = followPubkeys.length;
  const BATCH_SIZE = 5;

  // Cache for user relay lists (NIP-65)
  const userRelayCache = new Map<string, string[]>();

  // Process in batches
  for (let i = 0; i < followPubkeys.length; i += BATCH_SIZE) {
    if (abortSignal?.aborted) {
      break;
    }

    const batch = followPubkeys.slice(i, i + BATCH_SIZE);

    const batchPromises = batch.map(async (pubkey) => {
      try {
        // Try to get user's preferred relays via NIP-65
        let userRelays = userRelayCache.get(pubkey);
        if (!userRelays) {
          try {
            const relayResult = await Promise.race([
              fetchRelayListFromNostr(pubkey),
              new Promise<{ writeRelays: string[] }>((resolve) =>
                setTimeout(() => resolve({ writeRelays: [] }), 3000),
              ),
            ]);
            userRelays =
              relayResult.writeRelays.length > 0
                ? relayResult.writeRelays.slice(0, 5)
                : [];
            userRelayCache.set(pubkey, userRelays);
          } catch {
            userRelays = [];
          }
        }

        // Combine user's relays with default expanded relays
        const queryRelays = [
          ...new Set([...userRelays, ...expandedRelays.slice(0, 8)]),
        ].slice(0, 10);

        // Query kind:1 notes only - we need to check for hellthreads
        const events = await Promise.race([
          pool.querySync(queryRelays, {
            kinds: [1], // Text notes only
            authors: [pubkey],
            limit: 100, // Check more events for hellthread detection
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Query timeout")), 10000),
          ),
        ]);

        // Find hellthreads: top-level posts (no 'e' tag) with p-tag count >= threshold
        const hellthreadEvents = events.filter((event) => {
          // Check if it's a top-level post (no 'e' tag = not a reply)
          const hasReplyTag = event.tags.some((tag) => tag[0] === "e");
          if (hasReplyTag) return false;

          // Count unique p tags
          const pTags = event.tags.filter((tag) => tag[0] === "p");
          const uniquePubkeys = new Set(pTags.map((tag) => tag[1]));

          return uniquePubkeys.size >= threshold;
        });

        if (hellthreadEvents.length > 0) {
          // Find the worst offender (most p tags)
          let worstEvent = hellthreadEvents[0];
          let maxTagCount = 0;

          for (const event of hellthreadEvents) {
            const pTags = event.tags.filter((tag) => tag[0] === "p");
            const uniqueCount = new Set(pTags.map((tag) => tag[1])).size;
            if (uniqueCount > maxTagCount) {
              maxTagCount = uniqueCount;
              worstEvent = event;
            }
          }

          // Find most recent hellthread
          const mostRecent = hellthreadEvents.reduce((latest, event) =>
            event.created_at > latest.created_at ? event : latest,
          );

          // Fetch profile for this user
          const profile = await fetchProfile(pubkey, relays);

          return {
            pubkey,
            profile: profile || undefined,
            hellthreadCount: hellthreadEvents.length,
            maxTagCount,
            worstEventId: worstEvent.id,
            lastSeen: mostRecent.created_at,
          };
        }
        return null;
      } catch (error) {
        console.error(
          `Failed to check hellthreads for ${pubkey.substring(0, 8)}:`,
          error,
        );
        return null;
      }
    });

    const batchResults = await Promise.allSettled(batchPromises);

    for (const result of batchResults) {
      if (result.status === "fulfilled" && result.value) {
        results.push(result.value);
        // Immediately notify of new result for real-time UI updates
        onResult?.(result.value);
      }
    }

    // Update progress
    const processed = Math.min(i + BATCH_SIZE, total);
    onProgress?.(processed, total);

    // Small delay between batches to avoid overwhelming relays
    if (i + BATCH_SIZE < followPubkeys.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // Sort by worst offender (most tags) descending
  results.sort((a, b) => b.maxTagCount - a.maxTagCount);

  return results;
}

// ============================================================================
// SNOOPABLE - DM METADATA ANALYSIS (NIP-04)
// ============================================================================

// DM event kind (NIP-04 encrypted direct messages)
const DM_KIND = 4;

/**
 * Assign a fun title based on DM exchange patterns
 */
function assignDMTitle(data: {
  sentCount: number;
  receivedCount: number;
  firstExchange: number;
  lastExchange: number;
}): string {
  const total = data.sentCount + data.receivedCount;
  const ratio =
    data.receivedCount > 0
      ? data.sentCount / data.receivedCount
      : data.sentCount > 0
        ? Infinity
        : 1;

  // Check recency first
  const daysSinceLastDM = (Date.now() / 1000 - data.lastExchange) / 86400;

  // Ghost detection - no activity in 180+ days with significant history
  if (daysSinceLastDM > 180 && total >= 5) return "Ghost";

  // Hot connection - recent activity
  if (daysSinceLastDM < 7 && total >= 3) return "Hot";

  // Volume-based titles
  if (total >= 100) return "BFF";
  if (total >= 50) return "Inner Circle";
  if (total >= 20) return "Frequent Flyer";

  // Ratio-based titles - one-sided conversations
  if (ratio > 5 && data.sentCount >= 10) return "Left on Read";
  if (ratio < 0.2 && data.receivedCount >= 10) return "Popular";

  // Small exchanges
  if (total === 1) return "One-Timer";
  if (total <= 3) return "Acquaintance";

  return "Regular";
}

/**
 * Generate heatmap data from DM events
 */
function generateDMHeatmapData(
  sentEvents: Event[],
  receivedEvents: Event[],
): import("@/types").DMActivityDay[] {
  const dayMap = new Map<string, { sent: number; received: number }>();

  // Process sent DMs
  for (const event of sentEvents) {
    const date = new Date(event.created_at * 1000).toISOString().split("T")[0];
    const existing = dayMap.get(date) || { sent: 0, received: 0 };
    existing.sent++;
    dayMap.set(date, existing);
  }

  // Process received DMs
  for (const event of receivedEvents) {
    const date = new Date(event.created_at * 1000).toISOString().split("T")[0];
    const existing = dayMap.get(date) || { sent: 0, received: 0 };
    existing.received++;
    dayMap.set(date, existing);
  }

  // Convert to array and sort by date
  return Array.from(dayMap.entries())
    .map(([date, data]) => ({
      date,
      count: data.sent + data.received,
      sentCount: data.sent,
      receivedCount: data.received,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Fetch DM metadata for a pubkey (envelope data only - no decryption)
 * Queries kind:4 events by author (sent) and #p tag (received)
 *
 * @param targetPubkey - The pubkey to analyze
 * @param relays - Relays to query
 * @param onProgress - Progress callback with phase and count
 * @param abortSignal - Optional abort signal
 * @param limit - Max events to fetch per direction (default 500)
 * @returns Object with sent and received DM events
 */
export async function fetchDMMetadata(
  targetPubkey: string,
  relays: string[] = DEFAULT_RELAYS,
  onProgress?: (phase: string, count: number) => void,
  abortSignal?: AbortSignal,
  limit: number = 500,
): Promise<{ sent: Event[]; received: Event[] }> {
  const pool = getPool();
  // Filter out known-bad relays and expand the list
  const filteredRelays = relays.filter(
    (r) => !r.includes("garden.zap.cooking"),
  );
  const expandedRelays = getExpandedRelayList(filteredRelays);

  onProgress?.("Intercepting transmissions...", 0);

  // Helper to deduplicate events by ID
  const dedupeEvents = (events: Event[]): Event[] => {
    const seen = new Set<string>();
    return events.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  };

  // Query with a small delay between to avoid overwhelming relays
  // Run query twice and merge results for more consistent data
  const sentDMs1 = await pool.querySync(expandedRelays, {
    kinds: [DM_KIND],
    authors: [targetPubkey],
    limit,
  });

  if (abortSignal?.aborted) throw new Error("Aborted");

  // Small delay before second query
  await new Promise((resolve) => setTimeout(resolve, 500));

  const sentDMs2 = await pool.querySync(expandedRelays, {
    kinds: [DM_KIND],
    authors: [targetPubkey],
    limit,
  });

  const sentDMs = dedupeEvents([...sentDMs1, ...sentDMs2]);

  if (abortSignal?.aborted) throw new Error("Aborted");

  onProgress?.("Surveilling the targets...", sentDMs.length);

  // Query DMs received BY the target (they are in #p tag)
  const receivedDMs1 = await pool.querySync(expandedRelays, {
    kinds: [DM_KIND],
    "#p": [targetPubkey],
    limit,
  });

  if (abortSignal?.aborted) throw new Error("Aborted");

  await new Promise((resolve) => setTimeout(resolve, 500));

  const receivedDMs2 = await pool.querySync(expandedRelays, {
    kinds: [DM_KIND],
    "#p": [targetPubkey],
    limit,
  });

  const receivedDMs = dedupeEvents([...receivedDMs1, ...receivedDMs2]);

  if (abortSignal?.aborted) throw new Error("Aborted");

  // Update progress with total
  onProgress?.(
    "Dusting for fingerprints...",
    sentDMs.length + receivedDMs.length,
  );

  return { sent: sentDMs, received: receivedDMs };
}

/**
 * Analyze DM metadata and generate statistics
 * This only reads PUBLIC envelope data - no decryption of message content
 *
 * @param targetPubkey - The pubkey to analyze
 * @param relays - Relays to query
 * @param onProgress - Progress callback (phase, current, total)
 * @param abortSignal - Optional abort signal
 * @returns DMAnalysis object with contacts, stats, and heatmap data
 */
export async function analyzeDMMetadata(
  targetPubkey: string,
  relays: string[] = DEFAULT_RELAYS,
  onProgress?: (phase: string, current: number, total?: number) => void,
  abortSignal?: AbortSignal,
): Promise<import("@/types").DMAnalysis> {
  // 1. Fetch raw DM events
  const { sent, received } = await fetchDMMetadata(
    targetPubkey,
    relays,
    (phase, count) => onProgress?.(phase, count),
    abortSignal,
  );

  if (abortSignal?.aborted) throw new Error("Aborted");

  onProgress?.("Casing the joint...", sent.length + received.length);

  // 2. Aggregate by counterparty
  const contactMap = new Map<
    string,
    {
      sentCount: number;
      receivedCount: number;
      timestamps: number[];
    }
  >();

  // Process sent DMs - extract recipient from p-tag
  for (const event of sent) {
    const recipientTag = event.tags.find((t) => t[0] === "p");
    if (!recipientTag?.[1]) continue;
    const recipientPubkey = recipientTag[1];

    const existing = contactMap.get(recipientPubkey) || {
      sentCount: 0,
      receivedCount: 0,
      timestamps: [],
    };
    existing.sentCount++;
    existing.timestamps.push(event.created_at);
    contactMap.set(recipientPubkey, existing);
  }

  // Process received DMs - sender is event.pubkey
  for (const event of received) {
    const senderPubkey = event.pubkey;

    const existing = contactMap.get(senderPubkey) || {
      sentCount: 0,
      receivedCount: 0,
      timestamps: [],
    };
    existing.receivedCount++;
    existing.timestamps.push(event.created_at);
    contactMap.set(senderPubkey, existing);
  }

  if (abortSignal?.aborted) throw new Error("Aborted");

  onProgress?.("Dusting for fingerprints...", contactMap.size);

  // 3. Build contacts array with titles
  const contacts: import("@/types").DMContact[] = [];
  for (const [pubkey, data] of contactMap) {
    const timestamps = data.timestamps.sort((a, b) => a - b);
    const firstExchange = timestamps[0];
    const lastExchange = timestamps[timestamps.length - 1];

    contacts.push({
      pubkey,
      sentCount: data.sentCount,
      receivedCount: data.receivedCount,
      totalCount: data.sentCount + data.receivedCount,
      firstExchange,
      lastExchange,
      title: assignDMTitle({
        sentCount: data.sentCount,
        receivedCount: data.receivedCount,
        firstExchange,
        lastExchange,
      }),
    });
  }

  // Sort by total exchanges descending
  contacts.sort((a, b) => b.totalCount - a.totalCount);

  if (abortSignal?.aborted) throw new Error("Aborted");

  // 4. Generate heatmap data
  const heatmapData = generateDMHeatmapData(sent, received);

  // 5. Fetch profiles for top contacts (limit to avoid overwhelming relays)
  onProgress?.("Ranking the suspects...", 0, Math.min(contacts.length, 50));

  const topContacts = contacts.slice(0, 50);
  const PROFILE_BATCH_SIZE = 5;

  for (let i = 0; i < topContacts.length; i += PROFILE_BATCH_SIZE) {
    if (abortSignal?.aborted) throw new Error("Aborted");

    const batch = topContacts.slice(i, i + PROFILE_BATCH_SIZE);
    const profilePromises = batch.map((contact) =>
      fetchProfile(contact.pubkey, relays).catch(() => null),
    );

    const profiles = await Promise.all(profilePromises);

    for (let j = 0; j < batch.length; j++) {
      if (profiles[j]) {
        batch[j].profile = profiles[j] || undefined;
      }
    }

    onProgress?.(
      "Ranking the suspects...",
      Math.min(i + PROFILE_BATCH_SIZE, topContacts.length),
      Math.min(contacts.length, 50),
    );
  }

  // 6. Fetch target's profile
  const targetProfile = await fetchProfile(targetPubkey, relays).catch(
    () => null,
  );

  // Calculate overall stats
  const allTimestamps = [...sent, ...received].map((e) => e.created_at);
  const oldestDM =
    allTimestamps.length > 0 ? Math.min(...allTimestamps) : undefined;
  const newestDM =
    allTimestamps.length > 0 ? Math.max(...allTimestamps) : undefined;

  onProgress?.("Snooping intensifies...", contacts.length, contacts.length);

  return {
    targetPubkey,
    targetProfile: targetProfile || undefined,
    contacts,
    totalSent: sent.length,
    totalReceived: received.length,
    heatmapData,
    scanTimestamp: Date.now(),
    oldestDM,
    newestDM,
  };
}
