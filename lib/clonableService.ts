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
  getExpandedRelayList,
  getPool,
  signEvent,
  DEFAULT_RELAYS,
} from "./nostr";
import { MuteList, Profile, RelayListMetadata, RELAY_LIST_KIND } from "@/types";
import { NsecSigner } from "./signers/NsecSigner";
import { extractTagReason, extractTagEventRef } from "@/lib/utils/nostrHelpers";

export interface CloneableData {
  profile: { parsed: Profile; rawContent: Record<string, unknown> } | null;
  followList: string[] | null;
  followListContent: string;
  muteList: MuteList | null;
  muteListHasPrivate: boolean;
  relayList: RelayListMetadata | null;
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
  const [rawContent, profile, followEvent, muteEvent] = await Promise.all([
    fetchRawProfileContent(pubkey, sourceRelays),
    fetchProfile(pubkey, sourceRelays),
    fetchFollowList(pubkey, sourceRelays),
    fetchMuteList(pubkey, sourceRelays),
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

  const decrypted = await signer.nip04Decrypt(authorPubkey, encryptedContent);
  if (!decrypted || !decrypted.trim()) {
    return privateMutes;
  }

  const privateTags = JSON.parse(decrypted) as string[][];

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

  const signedEvent = await signEvent(eventTemplate);
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
): Promise<Event> {
  return publishProfile({}, rawContent, relays);
}

/**
 * Publish cloned follow list for the currently logged-in user.
 */
export async function publishClonedFollows(
  pubkeys: string[],
  relays: string[] = DEFAULT_RELAYS,
  content: string = "",
): Promise<Event> {
  return publishFollowList(pubkeys, relays, content);
}

/**
 * Publish cloned mute list for the currently logged-in user.
 * Private items are re-encrypted using the logged-in signer.
 */
export async function publishClonedMutes(
  muteList: MuteList,
  relays: string[] = DEFAULT_RELAYS,
): Promise<Event> {
  return publishMuteList(muteList, relays);
}
