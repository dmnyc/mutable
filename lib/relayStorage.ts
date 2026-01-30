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

import { Event, EventTemplate, Filter } from "nostr-tools";
import {
  getPool,
  getExpandedRelayList,
  hasNip07,
  signWithNip07,
} from "./nostr";
import { MuteList } from "@/types";

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
  PROTECTED_USERS: "mutable:protected-users",
  BLACKLIST: "mutable:blacklist",
  PREFERENCES: "mutable:preferences",
  IMPORTED_PACKS: "mutable:imported-packs",
  MUTE_BACKUP: "mutable:mute-backup",
} as const;

export type DTagType = (typeof D_TAGS)[keyof typeof D_TAGS];

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
  theme?: "light" | "dark";
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

export interface MuteBackupData {
  version: number;
  timestamp: number;
  muteList: MuteList;
  followList?: string[]; // hex pubkeys
  notes?: string;
}

// Union type for all data types
export type StorageData =
  | ProtectedUsersData
  | BlacklistData
  | PreferencesData
  | ImportedPacksData
  | MuteBackupData;

/**
 * Encrypt data using NIP-04 (encrypt to own pubkey)
 */
async function encryptData(
  data: StorageData,
  userPubkey: string,
): Promise<string> {
  if (!hasNip07() || !window.nostr?.nip04?.encrypt) {
    throw new Error(
      "NIP-07 extension with nip04 support required for encryption",
    );
  }

  const jsonString = JSON.stringify(data);
  return await window.nostr.nip04.encrypt(userPubkey, jsonString);
}

/**
 * Decrypt data using NIP-04
 */
async function decryptData(
  encryptedContent: string,
  authorPubkey: string,
): Promise<StorageData> {
  if (!hasNip07() || !window.nostr?.nip04?.decrypt) {
    throw new Error(
      "NIP-07 extension with nip04 support required for decryption",
    );
  }

  const decrypted = await window.nostr.nip04.decrypt(
    authorPubkey,
    encryptedContent,
  );
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
  encrypted: boolean = true,
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
      ["d", dTag],
      ["encrypted", encrypted ? "true" : "false"],
    ],
    content,
  };

  // Sign event
  const signedEvent = await signWithNip07(eventTemplate);

  // Publish to relays
  console.log(
    `[RelayStorage] Publishing ${dTag} to ${expandedRelays.length} relays...`,
  );
  console.log(`[RelayStorage] Event details:`, {
    kind: signedEvent.kind,
    tags: signedEvent.tags,
    contentLength: signedEvent.content.length,
    created_at: new Date(signedEvent.created_at * 1000).toISOString(),
  });

  const publishPromises = pool.publish(expandedRelays, signedEvent);
  const publishResults = await Promise.allSettled(publishPromises);

  const successfulRelays: string[] = [];
  const failedRelays: string[] = [];

  publishResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      successfulRelays.push(expandedRelays[index]);
      console.log(`[RelayStorage] ✅ ${expandedRelays[index]} - fulfilled`);
    } else {
      failedRelays.push(expandedRelays[index]);
      console.log(
        `[RelayStorage] ❌ ${expandedRelays[index]} - ${result.reason}`,
      );
    }
  });

  console.log(
    `[RelayStorage] Publish ${dTag}: ${successfulRelays.length} succeeded, ${failedRelays.length} failed`,
  );

  if (successfulRelays.length === 0) {
    console.error(
      `[RelayStorage] WARNING: Failed to publish ${dTag} to any relay!`,
    );
  }

  // Give relays time to process and verify the event was stored
  console.log(`[RelayStorage] Waiting 2s for relay processing...`);
  await new Promise((resolve) => setTimeout(resolve, 2000));

  return signedEvent;
}

/**
 * Fetch data from relays
 */
export async function fetchAppData(
  dTag: DTagType,
  userPubkey: string,
  relays: string[],
  timeoutMs: number = 5000,
): Promise<StorageData | null> {
  const pool = getPool();
  const expandedRelays = getExpandedRelayList(relays);
  console.log(
    `[RelayStorage] Fetching ${dTag} from ${expandedRelays.length} relays (timeout: ${timeoutMs}ms)`,
  );

  return new Promise((resolve) => {
    let latestEvent: Event | null = null;
    let eventSource: string | null = null;
    const timeoutId = setTimeout(() => {
      sub.close();
      if (latestEvent) {
        console.log(
          `[RelayStorage] Fetch ${dTag}: Found event from relay (created: ${new Date(latestEvent.created_at * 1000).toISOString()})`,
        );
        processEvent(latestEvent)
          .then(resolve)
          .catch(() => resolve(null));
      } else {
        console.log(
          `[RelayStorage] Fetch ${dTag}: No event found after timeout`,
        );
        resolve(null);
      }
    }, timeoutMs);

    const filter: Filter = {
      kinds: [APP_DATA_KIND],
      authors: [userPubkey],
      "#d": [dTag],
    };

    const sub = pool.subscribeMany(expandedRelays, filter, {
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
          processEvent(latestEvent)
            .then(resolve)
            .catch(() => resolve(null));
        } else {
          resolve(null);
        }
      },
    });
  });
}

/**
 * Process and decrypt event
 */
async function processEvent(event: Event): Promise<StorageData | null> {
  try {
    // Check if encrypted
    const encryptedTag = event.tags.find((t) => t[0] === "encrypted");
    const isEncrypted = encryptedTag?.[1] === "true";

    if (isEncrypted) {
      return await decryptData(event.content, event.pubkey);
    } else {
      return JSON.parse(event.content) as StorageData;
    }
  } catch (error) {
    console.error("Failed to process app data event:", error);
    return null;
  }
}

/**
 * Delete data from relays (publish deletion event)
 */
export async function deleteAppData(
  dTag: DTagType,
  userPubkey: string,
  relays: string[],
): Promise<Event> {
  const pool = getPool();
  const expandedRelays = getExpandedRelayList(relays);

  // Fetch the event to delete
  const dataToDelete = await fetchAppData(dTag, userPubkey, relays, 3000);

  if (!dataToDelete) {
    throw new Error("No data found to delete");
  }

  // Create deletion event (kind 5)
  const eventTemplate: EventTemplate = {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["a", `${APP_DATA_KIND}:${userPubkey}:${dTag}`]],
    content: "Deleted app data",
  };

  // Sign and publish
  const signedEvent = await signWithNip07(eventTemplate);

  await Promise.allSettled(pool.publish(expandedRelays, signedEvent));

  return signedEvent;
}

/**
 * Sync helpers - merge local and relay data
 */

interface SyncResult<T extends StorageData> {
  data: T;
  source: "local" | "relay" | "merged";
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
  relays: string[],
): Promise<SyncResult<T>> {
  const expandedRelays = getExpandedRelayList(relays);
  console.log(
    `[RelayStorage] Syncing ${dTag} using ${expandedRelays.length} relays (${relays.length} user + defaults)`,
  );
  const relayData = (await fetchAppData(dTag, userPubkey, relays)) as T | null;
  console.log(
    `[RelayStorage] ${dTag} - Relay data:`,
    relayData ? `Found (timestamp: ${relayData.timestamp})` : "null",
  );
  console.log(
    `[RelayStorage] ${dTag} - Local data:`,
    localData ? `Found (timestamp: ${localData.timestamp})` : "null",
  );

  // No data exists anywhere - create empty data with current timestamp
  if (!localData && !relayData) {
    // Return a minimal data structure that services can handle
    // The service should define what "empty" means for their data type
    return {
      data: {
        version: 1,
        timestamp: Date.now(),
      } as T,
      source: "local",
      needsPublish: false, // Don't publish empty data
    };
  }

  // Only local data exists
  if (localData && !relayData) {
    return {
      data: localData,
      source: "local",
      needsPublish: true,
    };
  }

  // Only relay data exists
  if (!localData && relayData) {
    return {
      data: relayData,
      source: "relay",
      needsPublish: false,
    };
  }

  // Both exist - use smart conflict resolution
  if (localData && relayData) {
    // Special handling for protected users: merge and take union
    if (dTag === D_TAGS.PROTECTED_USERS) {
      const localUsers = (localData as ProtectedUsersData).users || [];
      const relayUsers = (relayData as ProtectedUsersData).users || [];

      console.log(
        `[RelayStorage] Protected users - Local: ${localUsers.length}, Relay: ${relayUsers.length}`,
      );

      // Create a map to deduplicate by pubkey, keeping the earliest addedAt
      const userMap = new Map<string, ProtectedUsersData["users"][0]>();

      // Add relay users first
      relayUsers.forEach((user) => {
        userMap.set(user.pubkey, user);
      });

      // Add/update with local users (keep earliest addedAt)
      localUsers.forEach((user) => {
        const existing = userMap.get(user.pubkey);
        if (!existing || user.addedAt < existing.addedAt) {
          userMap.set(user.pubkey, user);
        }
      });

      const mergedUsers = Array.from(userMap.values());
      console.log(
        `[RelayStorage] Merged protected users: ${mergedUsers.length} total`,
      );

      // If merged count is different from either source, we need to publish
      const needsPublish = mergedUsers.length !== relayUsers.length;

      return {
        data: {
          version: 1,
          timestamp: Date.now(),
          users: mergedUsers,
        } as T,
        source: needsPublish ? "merged" : "relay",
        needsPublish,
      };
    }

    // For other data types, use timestamp-based resolution
    if (localData.timestamp > relayData.timestamp) {
      return {
        data: localData,
        source: "local",
        needsPublish: true,
      };
    } else if (relayData.timestamp > localData.timestamp) {
      return {
        data: relayData,
        source: "relay",
        needsPublish: false,
      };
    } else {
      // Same timestamp - prefer relay version
      return {
        data: relayData,
        source: "merged",
        needsPublish: false,
      };
    }
  }

  // Fallback (shouldn't reach here)
  throw new Error("Unexpected sync state");
}

// =============================================================================
// Mute Backup Specific Functions
// =============================================================================

/**
 * Save mute list and follow list backup to relay
 */
export async function saveMuteBackupToRelay(
  muteList: MuteList,
  userPubkey: string,
  relays: string[],
  notes?: string,
  followList?: string[],
): Promise<Event> {
  const data: MuteBackupData = {
    version: 1,
    timestamp: Date.now(),
    muteList,
    followList,
    notes,
  };

  console.log(`[RelayStorage] Saving backup to relays...`);
  console.log(
    `[RelayStorage] Backup contains: ${muteList.pubkeys.length} muted pubkeys, ${muteList.words.length} words, ${muteList.tags.length} tags, ${muteList.threads.length} threads`,
  );
  if (followList) {
    console.log(
      `[RelayStorage] Backup also contains: ${followList.length} follows`,
    );
  }

  return publishAppData(D_TAGS.MUTE_BACKUP, data, userPubkey, relays, true);
}

export interface MuteBackupResult {
  backup: MuteBackupData | null;
  foundOnRelays: string[];
  queriedRelays: string[];
}

/**
 * Fetch backup from relays with relay status tracking
 */
export async function fetchMuteBackupFromRelay(
  userPubkey: string,
  relays: string[],
  timeoutMs: number = 5000,
): Promise<MuteBackupResult> {
  const pool = getPool();
  const expandedRelays = getExpandedRelayList(relays);
  console.log(
    `[RelayStorage] Fetching backup from ${expandedRelays.length} relays...`,
  );

  const foundOnRelays: string[] = [];
  let latestEvent: Event | null = null;

  const filter: Filter = {
    kinds: [APP_DATA_KIND],
    authors: [userPubkey],
    "#d": [D_TAGS.MUTE_BACKUP],
  };

  // Query each relay individually to track which ones have the backup
  const relayPromises = expandedRelays.map(async (relayUrl) => {
    return new Promise<{
      relay: string;
      hasBackup: boolean;
      event: Event | null;
    }>((resolve) => {
      const relayTimeoutId = setTimeout(() => {
        resolve({ relay: relayUrl, hasBackup: false, event: null });
      }, timeoutMs);

      try {
        const sub = pool.subscribeMany([relayUrl], filter, {
          onevent(event: Event) {
            clearTimeout(relayTimeoutId);
            sub.close();
            resolve({ relay: relayUrl, hasBackup: true, event });
          },
          oneose() {
            clearTimeout(relayTimeoutId);
            sub.close();
            // EOSE without event means no backup on this relay
            resolve({ relay: relayUrl, hasBackup: false, event: null });
          },
        });
      } catch (error) {
        clearTimeout(relayTimeoutId);
        console.warn(`[RelayStorage] Error querying ${relayUrl}:`, error);
        resolve({ relay: relayUrl, hasBackup: false, event: null });
      }
    });
  });

  const results = await Promise.all(relayPromises);

  // Collect relays that have the backup and find the latest event
  for (const result of results) {
    if (result.hasBackup && result.event) {
      foundOnRelays.push(result.relay);
      if (!latestEvent || result.event.created_at > latestEvent.created_at) {
        latestEvent = result.event;
      }
    }
  }

  if (!latestEvent) {
    console.log(`[RelayStorage] No backup found on relays`);
    return { backup: null, foundOnRelays: [], queriedRelays: expandedRelays };
  }

  try {
    const data = await processEvent(latestEvent);
    if (!data) {
      return { backup: null, foundOnRelays, queriedRelays: expandedRelays };
    }

    const backup = data as MuteBackupData;
    if (!backup.muteList || typeof backup.timestamp !== "number") {
      console.error(`[RelayStorage] Invalid backup data structure`);
      return { backup: null, foundOnRelays, queriedRelays: expandedRelays };
    }

    console.log(
      `[RelayStorage] Found backup from ${new Date(backup.timestamp).toISOString()}`,
    );
    console.log(
      `[RelayStorage] Backup contains: ${backup.muteList.pubkeys?.length || 0} muted pubkeys, ${backup.muteList.words?.length || 0} words, ${backup.muteList.tags?.length || 0} tags, ${backup.muteList.threads?.length || 0} threads`,
    );
    console.log(
      `[RelayStorage] Found on ${foundOnRelays.length} relays: ${foundOnRelays.join(", ")}`,
    );
    if (backup.followList) {
      console.log(
        `[RelayStorage] Backup also contains: ${backup.followList.length} follows`,
      );
    }

    return { backup, foundOnRelays, queriedRelays: expandedRelays };
  } catch (error) {
    console.error(`[RelayStorage] Error processing backup:`, error);
    return { backup: null, foundOnRelays, queriedRelays: expandedRelays };
  }
}

/**
 * Delete mute list backup from relay
 */
export async function deleteMuteBackupFromRelay(
  userPubkey: string,
  relays: string[],
): Promise<Event> {
  console.log(`[RelayStorage] Deleting mute backup from relay...`);
  return deleteAppData(D_TAGS.MUTE_BACKUP, userPubkey, relays);
}
