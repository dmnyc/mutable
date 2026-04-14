import { Event, EventTemplate } from "nostr-tools";
import {
  fetchProfile,
  fetchRawProfileContent,
  fetchFollowList,
  fetchMuteList,
  fetchRelayListFromNostr,
  publishProfile,
  publishFollowList,
  publishMuteList,
  muteListToTags,
  getExpandedRelayList,
  getPool,
  signEvent,
  DEFAULT_RELAYS,
} from "./nostr";
import {
  MuteList,
  Profile,
  RelayListMetadata,
  RELAY_LIST_KIND,
  MUTE_LIST_KIND,
  FOLLOW_LIST_KIND,
} from "@/types";
import { NsecSigner } from "./signers/NsecSigner";
import { extractTagReason, extractTagEventRef } from "@/lib/utils/nostrHelpers";

export interface RawListEvent {
  tags: string[][];
  content: string;
  kind: number;
}

export interface CloneableData {
  profile: { parsed: Profile; rawContent: Record<string, unknown> } | null;
  followList: string[] | null;
  followListContent: string;
  muteList: MuteList | null;
  muteListHasPrivate: boolean;
  relayList: RelayListMetadata | null;
  pinnedNotes: RawListEvent | null;
  bookmarks: RawListEvent | null;
  communities: RawListEvent | null;
  searchRelays: RawListEvent | null;
  interests: RawListEvent | null;
  emojiLists: RawListEvent | null;
  dmRelays: RawListEvent | null;
}

/**
 * Fetch a raw list event by kind for a given pubkey.
 */
async function fetchRawListEvent(
  pubkey: string,
  kind: number,
  relays: string[],
): Promise<RawListEvent | null> {
  const pool = getPool();
  const events = await pool.querySync(relays, {
    kinds: [kind],
    authors: [pubkey],
    limit: 5,
  });
  if (events.length === 0) return null;
  events.sort((a, b) => b.created_at - a.created_at);
  const event = events[0];
  return { tags: event.tags, content: event.content, kind: event.kind };
}

/**
 * Publish a raw list event, optionally using a destination signer.
 */
async function publishClonedRawListEvent(
  event: RawListEvent,
  relays: string[],
  destinationSigner?: NsecSigner,
): Promise<Event> {
  const eventTemplate: EventTemplate = {
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    created_at: Math.floor(Date.now() / 1000),
  };

  const signedEvent = destinationSigner
    ? await destinationSigner.signEvent(eventTemplate)
    : await signEvent(eventTemplate);
  const pool = getPool();

  const publishPromise = Promise.any(pool.publish(relays, signedEvent));
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Publish timeout")), 15000),
  );
  await Promise.race([publishPromise, timeoutPromise]);

  return signedEvent;
}

/**
 * Fetch all cloneable data from a source account.
 * If nsecSigner is provided, private mutes will be decrypted using it.
 */
export async function fetchSourceData(
  pubkey: string,
  nsecSigner?: NsecSigner,
): Promise<CloneableData> {
  // Step 1: Fetch relay list first to get source account's relays
  const relayResult = await fetchRelayListFromNostr(pubkey);
  const sourceRelays = relayResult.writeRelays.length > 0
    ? getExpandedRelayList(relayResult.writeRelays)
    : DEFAULT_RELAYS;

  // Step 2: Fetch all other data in parallel using source relays
  const [
    rawContent,
    profile,
    followEvent,
    muteEvent,
    pinnedNotes,
    bookmarks,
    communities,
    searchRelays,
    interests,
    emojiLists,
    dmRelays,
  ] = await Promise.all([
    fetchRawProfileContent(pubkey, sourceRelays),
    fetchProfile(pubkey, sourceRelays),
    fetchFollowList(pubkey, sourceRelays),
    fetchMuteList(pubkey, sourceRelays),
    fetchRawListEvent(pubkey, 10001, sourceRelays),
    fetchRawListEvent(pubkey, 10003, sourceRelays),
    fetchRawListEvent(pubkey, 10004, sourceRelays),
    fetchRawListEvent(pubkey, 10007, sourceRelays),
    fetchRawListEvent(pubkey, 10015, sourceRelays),
    fetchRawListEvent(pubkey, 10030, sourceRelays),
    fetchRawListEvent(pubkey, 10050, sourceRelays),
  ]);

  // Parse profile
  const profileData = profile && rawContent
    ? { parsed: profile, rawContent }
    : profile
      ? { parsed: profile, rawContent: {} }
      : null;

  // Parse follow list
  let followList: string[] | null = null;
  let followListContent = "";
  if (followEvent) {
    followList = followEvent.tags
      .filter((tag) => tag[0] === "p" && tag[1])
      .map((tag) => tag[1]);
    followListContent = followEvent.content || "";
  }

  // Parse mute list
  let muteList: MuteList | null = null;
  let muteListHasPrivate = false;
  if (muteEvent) {
    muteList = parseMuteEventPublicTags(muteEvent);
    muteListHasPrivate = !!(muteEvent.content && muteEvent.content.trim() !== "");

    // Decrypt private mutes if nsecSigner provided
    if (nsecSigner && muteListHasPrivate) {
      try {
        const privateMutes = await decryptPrivateMutesWithSigner(
          muteEvent.content,
          pubkey,
          nsecSigner,
        );
        muteList.pubkeys.push(...privateMutes.pubkeys);
        muteList.words.push(...privateMutes.words);
        muteList.tags.push(...privateMutes.tags);
        muteList.threads.push(...privateMutes.threads);
      } catch (error) {
        console.error("Failed to decrypt private mutes:", error);
      }
    }
  }

  return {
    profile: profileData,
    followList,
    followListContent,
    muteList,
    muteListHasPrivate,
    relayList: relayResult.metadata,
    pinnedNotes,
    bookmarks,
    communities,
    searchRelays,
    interests,
    emojiLists,
    dmRelays,
  };
}

/**
 * Parse only the public tags from a mute list event.
 */
function parseMuteEventPublicTags(event: Event): MuteList {
  const muteList: MuteList = {
    pubkeys: [],
    words: [],
    tags: [],
    threads: [],
  };

  for (const tag of event.tags) {
    const [tagType, value, ...rest] = tag;
    const reason = extractTagReason(rest);
    const eventRef = extractTagEventRef(rest);

    switch (tagType) {
      case "p":
        muteList.pubkeys.push({ type: "pubkey", value, reason, eventRef, private: false });
        break;
      case "word":
        muteList.words.push({ type: "word", value, reason, eventRef, private: false });
        break;
      case "t":
        muteList.tags.push({ type: "tag", value, reason, eventRef, private: false });
        break;
      case "e":
        muteList.threads.push({ type: "thread", value, reason, private: false });
        break;
    }
  }

  return muteList;
}

/**
 * Decrypt private mutes using a specific signer (not the store signer).
 */
async function decryptPrivateMutesWithSigner(
  encryptedContent: string,
  authorPubkey: string,
  signer: NsecSigner,
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

  // Per NIP-51: detect NIP-04 vs NIP-44 by checking for "?iv=" in ciphertext
  const isNip04 = encryptedContent.includes("?iv=");
  let decrypted: string;
  if (isNip04) {
    decrypted = await signer.nip04Decrypt(authorPubkey, encryptedContent);
  } else {
    decrypted = await signer.nip44Decrypt(authorPubkey, encryptedContent);
  }

  // Guard against signers returning non-string values
  if (typeof decrypted !== "string" || !decrypted.trim()) {
    return privateMutes;
  }

  const parsed = JSON.parse(decrypted);
  if (!Array.isArray(parsed)) {
    return privateMutes;
  }
  const privateTags = parsed as string[][];

  for (const tag of privateTags) {
    const [tagType, value, ...rest] = tag;
    const reason = extractTagReason(rest);
    const eventRef = extractTagEventRef(rest);

    switch (tagType) {
      case "p":
        privateMutes.pubkeys.push({ type: "pubkey", value, reason, eventRef, private: true });
        break;
      case "word":
        privateMutes.words.push({ type: "word", value, reason, eventRef, private: true });
        break;
      case "t":
        privateMutes.tags.push({ type: "tag", value, reason, eventRef, private: true });
        break;
      case "e":
        privateMutes.threads.push({ type: "thread", value, reason, private: true });
        break;
    }
  }

  return privateMutes;
}

/**
 * Publish a relay list (kind 10002) for the currently logged-in user.
 */
export async function publishClonedRelayList(
  relayData: RelayListMetadata,
  relays: string[] = DEFAULT_RELAYS,
  destinationSigner?: NsecSigner,
): Promise<Event> {
  const tags: string[][] = [];

  for (const url of relayData.both) {
    tags.push(["r", url]);
  }
  for (const url of relayData.read) {
    tags.push(["r", url, "read"]);
  }
  for (const url of relayData.write) {
    tags.push(["r", url, "write"]);
  }

  const eventTemplate: EventTemplate = {
    kind: RELAY_LIST_KIND,
    tags,
    content: "",
    created_at: Math.floor(Date.now() / 1000),
  };

  const signedEvent = destinationSigner
    ? await destinationSigner.signEvent(eventTemplate)
    : await signEvent(eventTemplate);
  const pool = getPool();

  const publishPromise = Promise.any(pool.publish(relays, signedEvent));
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Publish timeout")), 15000),
  );
  await Promise.race([publishPromise, timeoutPromise]);

  return signedEvent;
}

/**
 * Publish cloned profile data for the currently logged-in user.
 */
export async function publishClonedProfile(
  rawContent: Record<string, unknown>,
  relays: string[] = DEFAULT_RELAYS,
  destinationSigner?: NsecSigner,
): Promise<Event> {
  if (destinationSigner) {
    const cleanContent: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawContent)) {
      if (value !== "" && value !== undefined && value !== null) {
        cleanContent[key] = value;
      }
    }
    const eventTemplate: EventTemplate = {
      kind: 0,
      tags: [],
      content: JSON.stringify(cleanContent),
      created_at: Math.floor(Date.now() / 1000),
    };
    const signedEvent = await destinationSigner.signEvent(eventTemplate);
    const pool = getPool();
    const publishPromise = Promise.any(pool.publish(relays, signedEvent));
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Publish timeout")), 15000),
    );
    await Promise.race([publishPromise, timeoutPromise]);
    return signedEvent;
  }
  return publishProfile({}, rawContent, relays);
}

/**
 * Publish cloned follow list for the currently logged-in user.
 */
export async function publishClonedFollows(
  pubkeys: string[],
  relays: string[] = DEFAULT_RELAYS,
  content: string = "",
  destinationSigner?: NsecSigner,
): Promise<Event> {
  if (destinationSigner) {
    const tags = pubkeys.map((pubkey) => ["p", pubkey]);
    const eventTemplate: EventTemplate = {
      kind: FOLLOW_LIST_KIND,
      tags,
      content,
      created_at: Math.floor(Date.now() / 1000),
    };
    const signedEvent = await destinationSigner.signEvent(eventTemplate);
    const pool = getPool();
    const publishPromise = Promise.any(pool.publish(relays, signedEvent));
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Publish timeout")), 15000),
    );
    await Promise.race([publishPromise, timeoutPromise]);
    return signedEvent;
  }
  return publishFollowList(pubkeys, relays, content);
}

/**
 * Publish cloned mute list for the currently logged-in user.
 * Private items are re-encrypted using the destination signer when provided.
 */
export async function publishClonedMutes(
  muteList: MuteList,
  relays: string[] = DEFAULT_RELAYS,
  destinationSigner?: NsecSigner,
): Promise<Event> {
  if (destinationSigner) {
    const destPubkey = await destinationSigner.getPublicKey();
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
    const tags = muteListToTags(publicList);
    const privateTags = muteListToTags(privateList);
    let encryptedContent = "";
    if (privateTags.length > 0) {
      encryptedContent = await destinationSigner.nip04Encrypt(
        destPubkey,
        JSON.stringify(privateTags),
      );
    }
    const eventTemplate: EventTemplate = {
      kind: MUTE_LIST_KIND,
      tags,
      content: encryptedContent,
      created_at: Math.floor(Date.now() / 1000),
    };
    const signedEvent = await destinationSigner.signEvent(eventTemplate);
    const pool = getPool();
    const publishPromise = Promise.any(pool.publish(relays, signedEvent));
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Publish timeout")), 15000),
    );
    await Promise.race([publishPromise, timeoutPromise]);
    return signedEvent;
  }
  return publishMuteList(muteList, relays);
}

export async function publishClonedPinnedNotes(
  event: RawListEvent,
  relays: string[] = DEFAULT_RELAYS,
  destinationSigner?: NsecSigner,
): Promise<Event> {
  return publishClonedRawListEvent(event, relays, destinationSigner);
}

export async function publishClonedBookmarks(
  event: RawListEvent,
  relays: string[] = DEFAULT_RELAYS,
  destinationSigner?: NsecSigner,
): Promise<Event> {
  return publishClonedRawListEvent(event, relays, destinationSigner);
}

export async function publishClonedCommunities(
  event: RawListEvent,
  relays: string[] = DEFAULT_RELAYS,
  destinationSigner?: NsecSigner,
): Promise<Event> {
  return publishClonedRawListEvent(event, relays, destinationSigner);
}

export async function publishClonedSearchRelays(
  event: RawListEvent,
  relays: string[] = DEFAULT_RELAYS,
  destinationSigner?: NsecSigner,
): Promise<Event> {
  return publishClonedRawListEvent(event, relays, destinationSigner);
}

export async function publishClonedInterests(
  event: RawListEvent,
  relays: string[] = DEFAULT_RELAYS,
  destinationSigner?: NsecSigner,
): Promise<Event> {
  return publishClonedRawListEvent(event, relays, destinationSigner);
}

export async function publishClonedEmojiLists(
  event: RawListEvent,
  relays: string[] = DEFAULT_RELAYS,
  destinationSigner?: NsecSigner,
): Promise<Event> {
  return publishClonedRawListEvent(event, relays, destinationSigner);
}

export async function publishClonedDmRelays(
  event: RawListEvent,
  relays: string[] = DEFAULT_RELAYS,
  destinationSigner?: NsecSigner,
): Promise<Event> {
  return publishClonedRawListEvent(event, relays, destinationSigner);
}
