/**
 * Relay Storage Service
 *
 * Implements NIP-78 (Application-specific Data) for persistent storage
 * across devices using Nostr relays as the source of truth.
 *
 * Uses kind:30078 (addressable event) with app-specific d-tags:
 * - mutable:protected-users
 * - mutable:blacklist
 * - mutable:preferences
 * - mutable:imported-packs
 *
 * Sensitive data is encrypted using NIP-04 (same as private mutes).
 */

import { Event, EventTemplate, Filter } from 'nostr-tools';
import { getPool, getExpandedRelayList, hasNip07, signWithNip07 } from './nostr';

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

// NIP-78 event kind for application-specific data
export const APP_DATA_KIND = 30078;

// D-tag identifiers for different data types
export const D_TAGS = {
  PROTECTED_USERS: 'mutable:protected-users',
  BLACKLIST: 'mutable:blacklist',
  PREFERENCES: 'mutable:preferences',
  IMPORTED_PACKS: 'mutable:imported-packs',
} as const;

export type DTagType = typeof D_TAGS[keyof typeof D_TAGS];

// Type definitions for stored data
export interface ProtectedUsersData {
  version: number;
  timestamp: number;
  users: Array<{
    pubkey: string;
    addedAt: number;
    reason?: string;
  }>;
}

export interface BlacklistData {
  version: number;
  timestamp: number;
  pubkeys: string[]; // hex pubkeys
}

export interface PreferencesData {
  version: number;
  timestamp: number;
  theme?: 'light' | 'dark';
  hasCompletedOnboarding?: boolean;
  [key: string]: unknown; // Allow additional preferences
}

export interface ImportedPacksData {
  version: number;
  timestamp: number;
  packs: {
    [packId: string]: {
      importedAt: number;
      itemsImported: number;
    };
  };
}

// Union type for all data types
export type StorageData =
  | ProtectedUsersData
  | BlacklistData
  | PreferencesData
  | ImportedPacksData;

/**
 * Encrypt data using NIP-04 (encrypt to own pubkey)
 */
async function encryptData(data: StorageData, userPubkey: string): Promise<string> {
  if (!hasNip07() || !window.nostr?.nip04?.encrypt) {
    throw new Error('NIP-07 extension with nip04 support required for encryption');
  }

  const jsonString = JSON.stringify(data);
  return await window.nostr.nip04.encrypt(userPubkey, jsonString);
}

/**
 * Decrypt data using NIP-04
 */
async function decryptData(encryptedContent: string, authorPubkey: string): Promise<StorageData> {
  if (!hasNip07() || !window.nostr?.nip04?.decrypt) {
    throw new Error('NIP-07 extension with nip04 support required for decryption');
  }

  const decrypted = await window.nostr.nip04.decrypt(authorPubkey, encryptedContent);
  return JSON.parse(decrypted) as StorageData;
}

/**
 * Publish data to relays
 */
export async function publishAppData(
  dTag: DTagType,
  data: StorageData,
  userPubkey: string,
  relays: string[],
  encrypted: boolean = true
): Promise<Event> {
  const pool = getPool();
  const expandedRelays = getExpandedRelayList(relays);

  // Prepare event content
  const content = encrypted
    ? await encryptData(data, userPubkey)
    : JSON.stringify(data);

  // Create event template
  const eventTemplate: EventTemplate = {
    kind: APP_DATA_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', dTag],
      ['encrypted', encrypted ? 'true' : 'false'],
    ],
    content,
  };

  // Sign event
  const signedEvent = await signWithNip07(eventTemplate);

  // Publish to relays
  console.log(`[RelayStorage] Publishing ${dTag} to ${expandedRelays.length} relays...`);
  const publishResults = await Promise.allSettled(
    pool.publish(expandedRelays, signedEvent)
  );

  const successCount = publishResults.filter(r => r.status === 'fulfilled').length;
  const failCount = publishResults.filter(r => r.status === 'rejected').length;
  console.log(`[RelayStorage] Publish ${dTag}: ${successCount} succeeded, ${failCount} failed`);

  if (successCount === 0) {
    console.error(`[RelayStorage] WARNING: Failed to publish ${dTag} to any relay!`);
  }

  return signedEvent;
}

/**
 * Fetch data from relays
 */
export async function fetchAppData(
  dTag: DTagType,
  userPubkey: string,
  relays: string[],
  timeoutMs: number = 5000
): Promise<StorageData | null> {
  const pool = getPool();
  const expandedRelays = getExpandedRelayList(relays);

  return new Promise((resolve) => {
    let latestEvent: Event | null = null;
    const timeoutId = setTimeout(() => {
      sub.close();
      if (latestEvent) {
        processEvent(latestEvent).then(resolve).catch(() => resolve(null));
      } else {
        resolve(null);
      }
    }, timeoutMs);

    const filter: Filter = {
      kinds: [APP_DATA_KIND],
      authors: [userPubkey],
      '#d': [dTag],
    };

    const sub = pool.subscribeMany(
      expandedRelays,
      filter,
      {
        onevent(event: Event) {
          // Keep only the most recent event
          if (!latestEvent || event.created_at > latestEvent.created_at) {
            latestEvent = event;
          }
        },
        oneose() {
          clearTimeout(timeoutId);
          sub.close();
          if (latestEvent) {
            processEvent(latestEvent).then(resolve).catch(() => resolve(null));
          } else {
            resolve(null);
          }
        },
      }
    );
  });
}

/**
 * Process and decrypt event
 */
async function processEvent(event: Event): Promise<StorageData | null> {
  try {
    // Check if encrypted
    const encryptedTag = event.tags.find(t => t[0] === 'encrypted');
    const isEncrypted = encryptedTag?.[1] === 'true';

    if (isEncrypted) {
      return await decryptData(event.content, event.pubkey);
    } else {
      return JSON.parse(event.content) as StorageData;
    }
  } catch (error) {
    console.error('Failed to process app data event:', error);
    return null;
  }
}

/**
 * Delete data from relays (publish deletion event)
 */
export async function deleteAppData(
  dTag: DTagType,
  userPubkey: string,
  relays: string[]
): Promise<Event> {
  const pool = getPool();
  const expandedRelays = getExpandedRelayList(relays);

  // Fetch the event to delete
  const dataToDelete = await fetchAppData(dTag, userPubkey, relays, 3000);

  if (!dataToDelete) {
    throw new Error('No data found to delete');
  }

  // Create deletion event (kind 5)
  const eventTemplate: EventTemplate = {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['a', `${APP_DATA_KIND}:${userPubkey}:${dTag}`],
    ],
    content: 'Deleted app data',
  };

  // Sign and publish
  const signedEvent = await signWithNip07(eventTemplate);

  await Promise.allSettled(
    pool.publish(expandedRelays, signedEvent)
  );

  return signedEvent;
}

/**
 * Sync helpers - merge local and relay data
 */

interface SyncResult<T extends StorageData> {
  data: T;
  source: 'local' | 'relay' | 'merged';
  needsPublish: boolean;
}

/**
 * Sync data between local storage and relay
 * Uses timestamp-based conflict resolution (newest wins)
 */
export async function syncData<T extends StorageData>(
  dTag: DTagType,
  localData: T | null,
  userPubkey: string,
  relays: string[]
): Promise<SyncResult<T>> {
  const expandedRelays = getExpandedRelayList(relays);
  console.log(`[RelayStorage] Syncing ${dTag} using ${expandedRelays.length} relays (${relays.length} user + defaults)`);
  const relayData = await fetchAppData(dTag, userPubkey, relays) as T | null;
  console.log(`[RelayStorage] ${dTag} - Relay data:`, relayData ? `Found (timestamp: ${relayData.timestamp})` : 'null');
  console.log(`[RelayStorage] ${dTag} - Local data:`, localData ? `Found (timestamp: ${localData.timestamp})` : 'null');

  // No data exists anywhere - create empty data with current timestamp
  if (!localData && !relayData) {
    // Return a minimal data structure that services can handle
    // The service should define what "empty" means for their data type
    return {
      data: {
        version: 1,
        timestamp: Date.now(),
      } as T,
      source: 'local',
      needsPublish: false, // Don't publish empty data
    };
  }

  // Only local data exists
  if (localData && !relayData) {
    return {
      data: localData,
      source: 'local',
      needsPublish: true,
    };
  }

  // Only relay data exists
  if (!localData && relayData) {
    return {
      data: relayData,
      source: 'relay',
      needsPublish: false,
    };
  }

  // Both exist - use timestamp to resolve
  if (localData && relayData) {
    if (localData.timestamp > relayData.timestamp) {
      return {
        data: localData,
        source: 'local',
        needsPublish: true,
      };
    } else if (relayData.timestamp > localData.timestamp) {
      return {
        data: relayData,
        source: 'relay',
        needsPublish: false,
      };
    } else {
      // Same timestamp - prefer relay version
      return {
        data: relayData,
        source: 'merged',
        needsPublish: false,
      };
    }
  }

  // Fallback (shouldn't reach here)
  throw new Error('Unexpected sync state');
}
