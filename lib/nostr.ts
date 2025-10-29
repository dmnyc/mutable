import {
  SimplePool,
  Event,
  EventTemplate,
  getPublicKey,
  nip19,
  nip04
} from 'nostr-tools';
import { MuteList, MuteItem, MUTE_LIST_KIND, PUBLIC_LIST_KIND, Profile, PROFILE_KIND, FOLLOW_LIST_KIND, RELAY_LIST_KIND, MutealResult } from '@/types';

// Default relay list - reliable, well-maintained relays
// Based on what works consistently across clients
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.wine'
];

// Get expanded relay list by combining user's relays with defaults
export function getExpandedRelayList(userRelays: string[]): string[] {
  const relaySet = new Set([...DEFAULT_RELAYS, ...userRelays]);
  return Array.from(relaySet);
}

// Namespace tags for community packs
export const PACK_NAMESPACE = 'mutable';
export const PACK_CATEGORY = 'community-pack';

// Nostrguard compatibility
export const NOSTRGUARD_NAMESPACE = 'nostrguard';
export const NOSTRGUARD_CATEGORY = 'scammer-pack';

// Pack categories
export const PACK_CATEGORIES = {
  SPAM: 'spam',
  NSFW: 'nsfw',
  SCAM: 'scam',
  IMPERSONATION: 'impersonation',
  BOT: 'bot',
  HARASSMENT: 'harassment',
  OTHER: 'other'
} as const;

export type PackCategory = typeof PACK_CATEGORIES[keyof typeof PACK_CATEGORIES];

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
  return typeof window !== 'undefined' && window.nostr !== undefined;
}

// Get pubkey from NIP-07 extension
export async function getNip07Pubkey(): Promise<string> {
  if (!hasNip07() || !window.nostr) {
    throw new Error('NIP-07 extension not found');
  }
  return await window.nostr.getPublicKey();
}

// Sign event with NIP-07
export async function signWithNip07(event: EventTemplate): Promise<Event> {
  if (!hasNip07() || !window.nostr) {
    throw new Error('NIP-07 extension not found');
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
    const relays = Object.keys(relayObj).filter(url => relayObj[url].write);
    return relays.length > 0 ? relays : DEFAULT_RELAYS;
  } catch {
    return DEFAULT_RELAYS;
  }
}

// Fetch user's relay list from Nostr (NIP-65 kind:10002)
// Returns both the write relays and the full metadata
export async function fetchRelayListFromNostr(pubkey: string): Promise<{
  writeRelays: string[];
  metadata: { read: string[]; write: string[]; both: string[]; timestamp: number } | null;
}> {
  const pool = getPool();

  try {
    // Query kind:10002 relay list metadata from default relays
    const events = await pool.querySync(DEFAULT_RELAYS, {
      kinds: [RELAY_LIST_KIND],
      authors: [pubkey],
      limit: 1
    });

    if (events.length === 0) {
      return { writeRelays: [], metadata: null };
    }

    const event = events[0];
    const read: string[] = [];
    const write: string[] = [];
    const both: string[] = [];

    // Parse all relay tags
    event.tags.forEach(tag => {
      if (tag[0] === 'r') {
        const relay = tag[1];
        const permission = tag[2];

        if (!permission) {
          both.push(relay);
        } else if (permission === 'read') {
          read.push(relay);
        } else if (permission === 'write') {
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
        timestamp: event.created_at
      }
    };
  } catch (error) {
    console.error('Failed to fetch relay list from Nostr:', error);
    return { writeRelays: [], metadata: null };
  }
}

// Get best relay list - tries Nostr first, falls back to NIP-07, then defaults
// Returns both the relay URLs and the full metadata (if available from NIP-65)
export async function getBestRelayList(pubkey: string): Promise<{
  relays: string[];
  metadata: { read: string[]; write: string[]; both: string[]; timestamp: number } | null;
}> {
  // Try fetching from Nostr first (most accurate, matches what clients like Jumble show)
  const result = await fetchRelayListFromNostr(pubkey);
  if (result.writeRelays.length > 0) {
    console.log('Using relay list from Nostr (NIP-65):', result.writeRelays);
    return { relays: result.writeRelays, metadata: result.metadata };
  }

  // Fall back to NIP-07 extension relays
  const nip07Relays = await getNip07Relays();
  if (nip07Relays.length > 0 && nip07Relays !== DEFAULT_RELAYS) {
    console.log('Using relay list from NIP-07 extension:', nip07Relays);
    return { relays: nip07Relays, metadata: null };
  }

  // Last resort: use defaults
  console.log('Using default relay list');
  return { relays: DEFAULT_RELAYS, metadata: null };
}

// Fetch user's mute list (kind:10000)
export async function fetchMuteList(
  pubkey: string,
  relays: string[] = DEFAULT_RELAYS
): Promise<Event | null> {
  const pool = getPool();
  const events = await pool.querySync(relays, {
    kinds: [MUTE_LIST_KIND],
    authors: [pubkey],
    limit: 1
  });

  return events.length > 0 ? events[0] : null;
}

// Decrypt private mutes from content field using NIP-07 extension
async function decryptPrivateMutes(encryptedContent: string, authorPubkey: string): Promise<MuteList> {
  const privateMutes: MuteList = {
    pubkeys: [],
    words: [],
    tags: [],
    threads: []
  };

  if (!encryptedContent || encryptedContent.trim() === '') {
    return privateMutes;
  }

  try {
    // Use NIP-07 extension for decryption
    if (!hasNip07() || !window.nostr) {
      console.warn('NIP-07 extension not available for decryption');
      return privateMutes;
    }

    // NIP-04 decryption via NIP-07
    const decrypted = await window.nostr.nip04?.decrypt(authorPubkey, encryptedContent);
    if (!decrypted) {
      console.warn('No nip04.decrypt method available in NIP-07 extension');
      return privateMutes;
    }

    const privateTags = JSON.parse(decrypted) as string[][];

    for (const tag of privateTags) {
      const [tagType, value, ...rest] = tag;
      const reason = rest.find(item => !item.startsWith('wss://'));

      switch (tagType) {
        case 'p':
          privateMutes.pubkeys.push({ type: 'pubkey', value, reason, private: true });
          break;
        case 'word':
          privateMutes.words.push({ type: 'word', value, reason, private: true });
          break;
        case 't':
          privateMutes.tags.push({ type: 'tag', value, reason, private: true });
          break;
        case 'e':
          privateMutes.threads.push({ type: 'thread', value, reason, private: true });
          break;
      }
    }
  } catch (error) {
    console.error('Failed to decrypt private mutes:', error);
  }

  return privateMutes;
}

// Parse mute list event into structured data (handles both public and private mutes)
// If skipCategoryTags is true, 't' tags are skipped (used for kind 30001 public lists where 't' = category, not muted hashtag)
export async function parseMuteListEvent(event: Event, skipCategoryTags: boolean = false): Promise<MuteList> {
  const muteList: MuteList = {
    pubkeys: [],
    words: [],
    tags: [],
    threads: []
  };

  // Parse public mutes from tags
  for (const tag of event.tags) {
    const [tagType, value, ...rest] = tag;
    const reason = rest.find(item => !item.startsWith('wss://'));

    switch (tagType) {
      case 'p':
        muteList.pubkeys.push({ type: 'pubkey', value, reason, private: false });
        break;
      case 'word':
        muteList.words.push({ type: 'word', value, reason, private: false });
        break;
      case 't':
        // For kind 30001 (public lists), 't' tags are categories, not muted hashtags
        if (!skipCategoryTags) {
          muteList.tags.push({ type: 'tag', value, reason, private: false });
        }
        break;
      case 'e':
        muteList.threads.push({ type: 'thread', value, reason, private: false });
        break;
    }
  }

  // Parse private mutes from encrypted content (if any)
  if (event.content && event.content.trim() !== '') {
    try {
      const privateMutes = await decryptPrivateMutes(event.content, event.pubkey);
      muteList.pubkeys.push(...privateMutes.pubkeys);
      muteList.words.push(...privateMutes.words);
      muteList.tags.push(...privateMutes.tags);
      muteList.threads.push(...privateMutes.threads);
    } catch (error) {
      console.error('Failed to parse private mutes:', error);
    }
  }

  return muteList;
}

// Separate mute list into public and private items
function separateMuteList(muteList: MuteList): { publicList: MuteList; privateList: MuteList } {
  const publicList: MuteList = {
    pubkeys: muteList.pubkeys.filter(item => !item.private),
    words: muteList.words.filter(item => !item.private),
    tags: muteList.tags.filter(item => !item.private),
    threads: muteList.threads.filter(item => !item.private)
  };

  const privateList: MuteList = {
    pubkeys: muteList.pubkeys.filter(item => item.private),
    words: muteList.words.filter(item => item.private),
    tags: muteList.tags.filter(item => item.private),
    threads: muteList.threads.filter(item => item.private)
  };

  return { publicList, privateList };
}

// Convert mute list to event tags (only public items)
export function muteListToTags(muteList: MuteList): string[][] {
  const tags: string[][] = [];

  muteList.pubkeys.forEach(item => {
    const tag = ['p', item.value];
    if (item.reason) tag.push(item.reason);
    tags.push(tag);
  });

  muteList.words.forEach(item => {
    const tag = ['word', item.value];
    if (item.reason) tag.push(item.reason);
    tags.push(tag);
  });

  muteList.tags.forEach(item => {
    const tag = ['t', item.value];
    if (item.reason) tag.push(item.reason);
    tags.push(tag);
  });

  muteList.threads.forEach(item => {
    const tag = ['e', item.value];
    if (item.reason) tag.push(item.reason);
    tags.push(tag);
  });

  return tags;
}

// Encrypt private mutes for content field using NIP-07 extension
async function encryptPrivateMutes(privateList: MuteList, recipientPubkey: string): Promise<string> {
  const privateTags = muteListToTags(privateList);

  if (privateTags.length === 0) {
    return '';
  }

  try {
    // Use NIP-07 extension for encryption
    if (!hasNip07() || !window.nostr?.nip04) {
      throw new Error('NIP-07 extension or nip04 methods not available');
    }

    // NIP-04 encryption via NIP-07 (encrypt to yourself)
    const encrypted = await window.nostr.nip04.encrypt(recipientPubkey, JSON.stringify(privateTags));
    return encrypted;
  } catch (error) {
    console.error('Failed to encrypt private mutes:', error);
    throw new Error('Failed to encrypt private mutes: ' + (error instanceof Error ? error.message : 'Unknown error'));
  }
}

// Publish mute list (handles both public and private mutes)
export async function publishMuteList(
  muteList: MuteList,
  relays: string[] = DEFAULT_RELAYS
): Promise<Event> {
  // Get current user's pubkey for encryption
  const userPubkey = await getNip07Pubkey();

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
    created_at: Math.floor(Date.now() / 1000)
  };

  const signedEvent = await signWithNip07(eventTemplate);
  const pool = getPool();

  await Promise.any(
    pool.publish(relays, signedEvent)
  );

  return signedEvent;
}

// Search for public mute lists by author
export async function searchPublicListsByAuthor(
  authorPubkey: string,
  relays: string[] = DEFAULT_RELAYS
): Promise<Event[]> {
  const pool = getPool();
  return await pool.querySync(relays, {
    kinds: [PUBLIC_LIST_KIND],
    authors: [authorPubkey]
  });
}

// Search for public mute lists by name (d tag)
export async function searchPublicListsByName(
  name: string,
  relays: string[] = DEFAULT_RELAYS
): Promise<Event[]> {
  const pool = getPool();
  return await pool.querySync(relays, {
    kinds: [PUBLIC_LIST_KIND],
    '#d': [name]
  });
}

// Fetch all public community packs with namespace filtering
export async function fetchAllPublicPacks(
  relays: string[] = DEFAULT_RELAYS,
  limit: number = 100,
  category?: PackCategory,
  includeUntagged: boolean = false,
  includeNostrguard: boolean = true  // NEW: Include nostrguard packs by default
): Promise<Event[]> {
  const pool = getPool();
  const expandedRelays = getExpandedRelayList(relays);

  // If includeUntagged is true, fetch both namespaced and non-namespaced packs
  if (includeUntagged) {
    const filter: any = {
      kinds: [PUBLIC_LIST_KIND],
      limit
    };

    // Add category filter if specified
    if (category) {
      filter['#t'] = [category];
    }

    return await pool.querySync(expandedRelays, filter);
  }

  // Fetch packs with namespace filtering
  const namespaces = [PACK_NAMESPACE];  // Always include mutable
  if (includeNostrguard) {
    namespaces.push(NOSTRGUARD_NAMESPACE);  // Optionally include nostrguard
  }

  const filter: any = {
    kinds: [PUBLIC_LIST_KIND],
    '#L': namespaces,
    limit
  };

  // Add category filter if specified
  if (category) {
    filter['#t'] = [category];
  }

  console.log('Fetching community packs with filter:', filter);
  const events = await pool.querySync(expandedRelays, filter);
  console.log(`Found ${events.length} community pack events (mutable + nostrguard)`);

  return events;
}

// Parse public list event
// Supports both mutable format (using "name" tag) and nostrguard format (using "title" tag)
export async function parsePublicListEvent(event: Event) {
  const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || '';

  // Support both "name" (mutable) and "title" (nostrguard) tags for display name
  const nameTag = event.tags.find(tag => tag[0] === 'name')?.[1];
  const titleTag = event.tags.find(tag => tag[0] === 'title')?.[1];
  const displayName = nameTag || titleTag || dTag;  // Fallback chain

  const descTag = event.tags.find(tag => tag[0] === 'description')?.[1];

  // Check which namespace this pack belongs to
  const namespaceTag = event.tags.find(tag => tag[0] === 'L')?.[1];
  const isMutablePack = namespaceTag === PACK_NAMESPACE;
  const isNostrguardPack = namespaceTag === NOSTRGUARD_NAMESPACE;

  // Extract category tags (t tags)
  const categories = event.tags
    .filter(tag => tag[0] === 't')
    .map(tag => tag[1])
    .filter(cat => Object.values(PACK_CATEGORIES).includes(cat as PackCategory)) as PackCategory[];

  return {
    id: event.id,
    dTag,
    name: displayName,
    description: descTag,
    author: event.pubkey,
    createdAt: event.created_at,
    list: await parseMuteListEvent(event, true),  // Skip 't' tags as they're categories in kind 30001
    categories,
    isMutablePack,  // Track whether this is a mutable-namespaced pack
    isNostrguardPack,  // Track whether this is a nostrguard pack
    namespace: namespaceTag  // Track the actual namespace
  };
}

// Publish public mute list
export async function publishPublicList(
  name: string,
  description: string,
  muteList: MuteList,
  relays: string[] = DEFAULT_RELAYS,
  categories: PackCategory[] = []
): Promise<Event> {
  const tags = muteListToTags(muteList);
  tags.unshift(['d', name]);
  tags.push(['name', name]);
  if (description) {
    tags.push(['description', description]);
  }

  // Add namespace tags for community pack discoverability
  tags.push(['L', PACK_NAMESPACE]);
  tags.push(['l', PACK_CATEGORY, PACK_NAMESPACE]);

  // Add category tags
  categories.forEach(category => {
    tags.push(['t', category]);
  });

  const eventTemplate: EventTemplate = {
    kind: PUBLIC_LIST_KIND,
    tags,
    content: '',
    created_at: Math.floor(Date.now() / 1000)
  };

  const signedEvent = await signWithNip07(eventTemplate);
  const pool = getPool();

  await Promise.any(
    pool.publish(relays, signedEvent)
  );

  return signedEvent;
}

// Convert npub to hex
export function npubToHex(npub: string): string {
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type === 'npub') {
      return decoded.data;
    }
    throw new Error('Invalid npub format');
  } catch (error) {
    throw new Error('Failed to decode npub');
  }
}

// Convert hex to npub
export function hexToNpub(hex: string): string {
  try {
    return nip19.npubEncode(hex);
  } catch (error) {
    throw new Error('Failed to encode npub');
  }
}

// Fetch profile metadata for a specific pubkey
export async function fetchProfile(
  pubkey: string,
  relays: string[] = DEFAULT_RELAYS
): Promise<Profile | null> {
  const pool = getPool();
  const events = await pool.querySync(relays, {
    kinds: [PROFILE_KIND],
    authors: [pubkey],
    limit: 1
  });

  if (events.length === 0) return null;

  try {
    const metadata = JSON.parse(events[0].content);
    return {
      pubkey,
      name: metadata.name,
      display_name: metadata.display_name,
      about: metadata.about,
      picture: metadata.picture,
      nip05: metadata.nip05,
      lud16: metadata.lud16
    };
  } catch (error) {
    return null;
  }
}

// Search profiles by query string (searches name, display_name, nip05)
export async function searchProfiles(
  query: string,
  relays: string[] = DEFAULT_RELAYS,
  limit: number = 20
): Promise<Profile[]> {
  // First, check if query is a pubkey or npub
  let searchPubkey: string | null = null;
  try {
    if (query.startsWith('npub')) {
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

  // Otherwise, fetch recent profiles and filter by query
  const pool = getPool();
  const events = await pool.querySync(relays, {
    kinds: [PROFILE_KIND],
    limit: 500 // Fetch more to filter through
  });

  const profiles: Profile[] = [];
  const queryLower = query.toLowerCase();

  for (const event of events) {
    try {
      const metadata = JSON.parse(event.content);
      const profile: Profile = {
        pubkey: event.pubkey,
        name: metadata.name,
        display_name: metadata.display_name,
        about: metadata.about,
        picture: metadata.picture,
        nip05: metadata.nip05,
        lud16: metadata.lud16
      };

      // Check if query matches name, display_name, or nip05
      const matchesName = profile.name?.toLowerCase().includes(queryLower);
      const matchesDisplayName = profile.display_name?.toLowerCase().includes(queryLower);
      const matchesNip05 = profile.nip05?.toLowerCase().includes(queryLower);

      if (matchesName || matchesDisplayName || matchesNip05) {
        profiles.push(profile);
      }

      if (profiles.length >= limit) break;
    } catch (error) {
      // Skip invalid profile JSON
      continue;
    }
  }

  return profiles;
}

// Fetch user's follow list (kind:3)
export async function fetchFollowList(
  pubkey: string,
  relays: string[] = DEFAULT_RELAYS,
  retries: number = 0
): Promise<Event | null> {
  const pool = getPool();

  // Use only the user's configured relays (not expanded with defaults)
  // This ensures we query their actual relays where their follow list is stored

  // Wait a moment for relay connections to stabilize before querying
  if (retries === 0) {
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  const events = await pool.querySync(relays, {
    kinds: [FOLLOW_LIST_KIND],
    authors: [pubkey],
    limit: 1
  });

  // If no events found and retries remaining, wait and try again
  if (events.length === 0 && retries > 0) {
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    return fetchFollowList(pubkey, relays, retries - 1);
  }

  return events.length > 0 ? events[0] : null;
}

// Remove a user from follow list
export async function unfollowUser(
  targetPubkey: string,
  relays: string[] = DEFAULT_RELAYS
): Promise<Event> {
  // Fetch current follow list
  const currentFollowList = await fetchFollowList(
    await getNip07Pubkey(),
    relays
  );

  // Filter out the target pubkey from the follow list
  const tags = currentFollowList
    ? currentFollowList.tags.filter(tag => tag[0] === 'p' && tag[1] !== targetPubkey)
    : [];

  const eventTemplate: EventTemplate = {
    kind: FOLLOW_LIST_KIND,
    tags,
    content: currentFollowList?.content || '',
    created_at: Math.floor(Date.now() / 1000)
  };

  const signedEvent = await signWithNip07(eventTemplate);
  const pool = getPool();

  await Promise.any(
    pool.publish(relays, signedEvent)
  );

  return signedEvent;
}

// Check if a user is in the follow list
export async function isFollowing(
  targetPubkey: string,
  userPubkey: string,
  relays: string[] = DEFAULT_RELAYS
): Promise<boolean> {
  const followList = await fetchFollowList(userPubkey, relays);
  if (!followList) return false;

  return followList.tags.some(
    tag => tag[0] === 'p' && tag[1] === targetPubkey
  );
}

// ============================================================================
// MUTEUALS DISCOVERY FUNCTIONS
// ============================================================================

// Fetch all public mute lists from a specific author
export async function fetchPublicMuteLists(
  authorPubkey: string,
  relays: string[] = DEFAULT_RELAYS
): Promise<Event[]> {
  const pool = getPool();
  return await pool.querySync(relays, {
    kinds: [PUBLIC_LIST_KIND],
    authors: [authorPubkey]
  });
}

// Search for muteuals within your follow list
export async function searchMutealsFromFollows(
  userPubkey: string,
  relays: string[] = DEFAULT_RELAYS,
  onProgress?: (current: number, total: number) => void,
  abortSignal?: AbortSignal
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
    .filter(tag => tag[0] === 'p')
    .map(tag => tag[1]);

  if (followedPubkeys.length === 0) {
    return muteuals;
  }

  console.log(`Checking ${followedPubkeys.length} follows for kind:10000 mute lists`);

  // Step 2: Fetch ALL kind:10000 mute lists from followed users in one query
  console.log('Fetching all kind:10000 events from your follows...');
  const allMuteListEvents = await pool.querySync(relays, {
    kinds: [MUTE_LIST_KIND], // kind 10000
    authors: followedPubkeys
  });

  console.log(`Found ${allMuteListEvents.length} kind:10000 events from your follows`);

  // Group by author and keep only the latest per author
  const latestByAuthor = new Map<string, Event>();
  for (const event of allMuteListEvents) {
    const existing = latestByAuthor.get(event.pubkey);
    if (!existing || event.created_at > existing.created_at) {
      latestByAuthor.set(event.pubkey, event);
    }
  }

  console.log(`After deduplication: ${latestByAuthor.size} unique authors with mute lists`);

  // Step 3: Check each follow's latest mute list
  let checked = 0;
  for (const followedPubkey of followedPubkeys) {
    // Check if scan was aborted
    if (abortSignal?.aborted) {
      console.log(`Scan aborted after checking ${checked}/${followedPubkeys.length} follows`);
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
      tag => tag[0] === 'p' && tag[1] === userPubkey
    );

    if (hasMuted) {
      console.log(`MUTEUAL FOUND: ${followedPubkey} has you in their mute list`);

      muteuals.push({
        mutedBy: followedPubkey,
        listName: 'Public Mute List',
        listDescription: undefined,
        mutedAt: muteListEvent.created_at,
        isFollowing: true,
        eventId: muteListEvent.id
      });
    }
  }

  console.log(`Follows scan complete: Found ${muteuals.length} Muteuals out of ${followedPubkeys.length} follows`);
  return muteuals;
}

// Search for muteuals network-wide
export async function searchMutealsNetworkWide(
  userPubkey: string,
  relays: string[] = DEFAULT_RELAYS,
  onProgress?: (count: number) => void,
  abortSignal?: AbortSignal
): Promise<MutealResult[]> {
  const pool = getPool();
  const muteuals: MutealResult[] = [];
  const seenPubkeys = new Set<string>();

  console.log('Network-wide search: Querying for kind 10000 mute lists with your pubkey in public tags:', userPubkey);

  // Query all mute lists (kind 10000) that contain the user's pubkey in PUBLIC tags
  // Per NIP-51, kind 10000 mute lists have:
  // - PUBLIC mutes in the 'tags' array (what we search)
  // - PRIVATE mutes encrypted in the 'content' field (which we cannot see)
  // NOTE: Kind 10000 is a REPLACEABLE event, meaning each user should only have ONE
  // But we might get multiple old versions from different relays
  const events = await pool.querySync(relays, {
    kinds: [MUTE_LIST_KIND], // kind 10000
    '#p': [userPubkey]
  });

  console.log(`Found ${events.length} kind:10000 mute list events with your pubkey in public 'p' tags`);

  // Group events by author to find the LATEST one per author
  // Kind 10000 is REPLACEABLE, so we should only use the newest event per author
  const eventsByAuthor = new Map<string, Event>();
  for (const event of events) {
    const existing = eventsByAuthor.get(event.pubkey);
    if (!existing || event.created_at > existing.created_at) {
      eventsByAuthor.set(event.pubkey, event);
    } else {
      console.log(`Skipping older event from ${event.pubkey}: ${new Date(event.created_at * 1000).toISOString()} (newer: ${new Date(existing.created_at * 1000).toISOString()})`);
    }
  }

  console.log(`After initial deduplication: ${eventsByAuthor.size} unique authors (removed ${events.length - eventsByAuthor.size} duplicate events)`);

  // CRITICAL FIX: Now fetch the ACTUAL latest kind:10000 for each author
  // The #p filter only gives us events WHERE WE'RE MUTED, but there might be newer events where we're NOT
  console.log('Fetching latest kind:10000 events for each author to verify...');

  const authorsToCheck = Array.from(eventsByAuthor.keys());
  const latestEvents = await pool.querySync(relays, {
    kinds: [MUTE_LIST_KIND],
    authors: authorsToCheck
  });

  console.log(`Fetched ${latestEvents.length} total kind:10000 events from these ${authorsToCheck.length} authors`);

  // Update our map with the truly latest events
  let updatedCount = 0;
  for (const event of latestEvents) {
    const existing = eventsByAuthor.get(event.pubkey);
    if (existing && event.created_at > existing.created_at) {
      console.log(`⚠️  Found NEWER event for ${event.pubkey}:`);
      console.log(`   Old: ${existing.id} (${new Date(existing.created_at * 1000).toISOString()})`);
      console.log(`   New: ${event.id} (${new Date(event.created_at * 1000).toISOString()})`);
      eventsByAuthor.set(event.pubkey, event);
      updatedCount++;
    }
  }

  console.log(`Updated ${updatedCount} events with newer versions`);

  // Get user's follow list to check if they're following the muteals
  const followListEvent = await fetchFollowList(userPubkey, relays);
  const followedPubkeys = new Set(
    followListEvent?.tags
      .filter(tag => tag[0] === 'p')
      .map(tag => tag[1]) || []
  );

  // Now iterate through only the LATEST event per author
  for (const event of eventsByAuthor.values()) {
    // Check if scan was aborted
    if (abortSignal?.aborted) {
      console.log(`Scan aborted after checking ${seenPubkeys.size} authors`);
      break;
    }

    const pTags = event.tags.filter(t => t[0] === 'p');
    const allTagTypes = [...new Set(event.tags.map(t => t[0]))];

    console.log('Analyzing kind:10000 event:', {
      id: event.id,
      author: event.pubkey,
      created_at: new Date(event.created_at * 1000).toISOString(),
      totalTags: event.tags.length,
      tagTypes: allTagTypes,
      pTagCount: pTags.length,
      pTags: pTags.map(t => ({ pubkey: t[1], relay: t[2] })),
      content: event.content.substring(0, 100)
    });

    // Kind 10000 is the standard public mute list, so no need to check d-tag
    // Just verify the event actually contains the user's pubkey in a 'p' tag
    const hasMuted = event.tags.some(
      tag => tag[0] === 'p' && tag[1] === userPubkey
    );

    if (hasMuted) {
      seenPubkeys.add(event.pubkey);

      console.log(`✅ CONFIRMED MUTEUAL: ${event.pubkey} has muted you in their public mute list (kind:10000)`);
      console.log(`   Event ID: ${event.id}`);
      console.log(`   Your pubkey was found in 'p' tags`);

      muteuals.push({
        mutedBy: event.pubkey,
        listName: 'Public Mute List',
        listDescription: undefined,
        mutedAt: event.created_at,
        isFollowing: followedPubkeys.has(event.pubkey),
        eventId: event.id
      });

      if (onProgress) {
        onProgress(muteuals.length);
      }
    } else {
      console.log(`⚠️  Event has 'p' tags but NOT your pubkey - this shouldn't happen with #p filter!`);
    }
  }

  console.log(`Final count: ${muteuals.length} confirmed Muteuals`);
  return muteuals;
}

// Fetch profiles for muteuals results
export async function enrichMutealsWithProfiles(
  muteuals: MutealResult[],
  relays: string[] = DEFAULT_RELAYS,
  onProgress?: (current: number, total: number) => void,
  abortSignal?: AbortSignal
): Promise<MutealResult[]> {
  const enriched: MutealResult[] = [];

  for (let i = 0; i < muteuals.length; i++) {
    // Check if enrichment was aborted
    if (abortSignal?.aborted) {
      console.log(`Profile enrichment aborted after ${i}/${muteuals.length} profiles`);
      // Return what we have so far with remaining items without profiles
      return [...enriched, ...muteuals.slice(i)];
    }

    const muteal = muteuals[i];

    if (onProgress) {
      onProgress(i + 1, muteuals.length);
    }

    try {
      const profile = await fetchProfile(muteal.mutedBy, relays);
      enriched.push({
        ...muteal,
        profile: profile || undefined
      });
    } catch (error) {
      console.error(`Failed to fetch profile for ${muteal.mutedBy}:`, error);
      enriched.push(muteal);
    }
  }

  return enriched;
}

// Get follow list as array of pubkeys
export async function getFollowListPubkeys(
  pubkey: string,
  relays: string[] = DEFAULT_RELAYS,
  retries: number = 2
): Promise<string[]> {
  const followListEvent = await fetchFollowList(pubkey, relays, retries);
  if (!followListEvent) return [];

  // Extract pubkeys from p tags
  return followListEvent.tags
    .filter(tag => tag[0] === 'p' && tag[1])
    .map(tag => tag[1]);
}
