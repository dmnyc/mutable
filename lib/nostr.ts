import {
  SimplePool,
  Event,
  EventTemplate,
  getPublicKey,
  nip19,
  nip04
} from 'nostr-tools';
import { MuteList, MuteItem, MUTE_LIST_KIND, PUBLIC_LIST_KIND } from '@/types';

// Default relay list
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.wine',
  'wss://relay.snort.social'
];

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

// Parse mute list event into structured data
export function parseMuteListEvent(event: Event): MuteList {
  const muteList: MuteList = {
    pubkeys: [],
    words: [],
    tags: [],
    threads: []
  };

  for (const tag of event.tags) {
    const [tagType, value, ...rest] = tag;
    const reason = rest.find(item => !item.startsWith('wss://'));

    switch (tagType) {
      case 'p':
        muteList.pubkeys.push({ type: 'pubkey', value, reason });
        break;
      case 'word':
        muteList.words.push({ type: 'word', value, reason });
        break;
      case 't':
        muteList.tags.push({ type: 'tag', value, reason });
        break;
      case 'e':
        muteList.threads.push({ type: 'thread', value, reason });
        break;
    }
  }

  return muteList;
}

// Convert mute list to event tags
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

// Publish mute list
export async function publishMuteList(
  muteList: MuteList,
  relays: string[] = DEFAULT_RELAYS
): Promise<Event> {
  const tags = muteListToTags(muteList);

  const eventTemplate: EventTemplate = {
    kind: MUTE_LIST_KIND,
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

// Parse public list event
export function parsePublicListEvent(event: Event) {
  const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || '';
  const nameTag = event.tags.find(tag => tag[0] === 'name')?.[1] || dTag;
  const descTag = event.tags.find(tag => tag[0] === 'description')?.[1];

  return {
    id: event.id,
    dTag,
    name: nameTag,
    description: descTag,
    author: event.pubkey,
    createdAt: event.created_at,
    list: parseMuteListEvent(event)
  };
}

// Publish public mute list
export async function publishPublicList(
  name: string,
  description: string,
  muteList: MuteList,
  relays: string[] = DEFAULT_RELAYS
): Promise<Event> {
  const tags = muteListToTags(muteList);
  tags.unshift(['d', name]);
  tags.push(['name', name]);
  if (description) {
    tags.push(['description', description]);
  }

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
