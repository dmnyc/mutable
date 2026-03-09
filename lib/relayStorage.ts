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
import { getPool, getExpandedRelayList, getSigner, signEvent } from "./nostr";
import { useStore } from "./store";
import { MuteList } from "@/types";

// NIP-78 event kind for application-specific data
export const APP_DATA_KIND = 30078;

// D-tag identifiers for different data types
export const D_TAGS = {
  PROTECTED_USERS: "mutable:protected-users",
  BLACKLIST: "mutable:blacklist",
  PREFERENCES: "mutable:preferences",
  IMPORTED_PACKS: "mutable:imported-packs",
  MUTE_BACKUP: "mutable:mute-backup",
  FOLLOW_BACKUP: "mutable:follow-backup",
  PROFILE_BACKUP_0: "mutable:profile-backup:0",
  PROFILE_BACKUP_1: "mutable:profile-backup:1",
  PROFILE_BACKUP_2: "mutable:profile-backup:2",
} as const;

// DTagType includes static tags plus dynamic follow backup chunk tags
export type DTagType = (typeof D_TAGS)[keyof typeof D_TAGS] | `mutable:follow-backup:${number}`;

// Max follows per chunk to stay within NIP-46 transport limits (65KB)
// 500 pubkeys × ~66 bytes = ~33KB raw → ~20KB compressed → well under 65KB
const FOLLOW_CHUNK_SIZE = 500;
const MAX_FOLLOW_CHUNKS = 20; // Support up to 10,000 follows

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
  // Chunk metadata for split follow backups
  totalChunks?: number;
  chunkIndex?: number;
}

export interface ProfileBackupData {
  version: number;
  timestamp: number;
  profile: Record<string, unknown>; // full kind:0 content JSON
}

// Union type for all data types
export type StorageData =
  | ProtectedUsersData
  | BlacklistData
  | PreferencesData
  | ImportedPacksData
  | MuteBackupData
  | ProfileBackupData;

// Prefix marker for compressed data (added before NIP-04 encryption)
const COMPRESSED_PREFIX = "gz:";

/**
 * Compress a string using gzip via native CompressionStream API
 * Returns base64-encoded compressed bytes prefixed with "gz:"
 */
async function compressString(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const inputBytes = encoder.encode(input);

  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(inputBytes);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const compressed = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, offset);
    offset += chunk.length;
  }

  // Convert to base64
  let binary = "";
  for (let i = 0; i < compressed.length; i++) {
    binary += String.fromCharCode(compressed[i]);
  }
  return COMPRESSED_PREFIX + btoa(binary);
}

/**
 * Decompress a "gz:"-prefixed base64 string back to the original string
 */
async function decompressString(input: string): Promise<string> {
  const base64Data = input.slice(COMPRESSED_PREFIX.length);
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const decompressed = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    decompressed.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(decompressed);
}

/**
 * Encrypt data using NIP-44 (preferred) or NIP-04 (fallback) via signer.
 * Compresses data before encryption to stay within NIP-46 transport limits.
 * Returns the encrypted string and which encryption method was used.
 */
async function encryptData(
  data: StorageData,
  userPubkey: string,
  explicitSigner?: import("./signers").Signer,
): Promise<{ encrypted: string; encMethod: "nip44" | "nip04" }> {
  const signer = explicitSigner || getSigner();
  const jsonString = JSON.stringify(data);

  // Always compress to reduce relay storage and stay within NIP-46 limits
  const payload = await compressString(jsonString);

  // Try NIP-44 first (modern, better supported by NIP-46 bunkers)
  let encrypted: string;
  let encMethod: "nip44" | "nip04";

  if (signer.nip44Encrypt) {
    try {
      encrypted = await signer.nip44Encrypt(userPubkey, payload);
      encMethod = "nip44";
    } catch (error) {
      console.warn("[RelayStorage] NIP-44 encrypt failed, falling back to NIP-04:", error);
      encrypted = await signer.nip04Encrypt(userPubkey, payload);
      encMethod = "nip04";
    }
  } else {
    encrypted = await signer.nip04Encrypt(userPubkey, payload);
    encMethod = "nip04";
  }

  console.log(
    `[RelayStorage] Compressed ${jsonString.length} → ${payload.length} bytes (${Math.round((1 - payload.length / jsonString.length) * 100)}% reduction), encrypted: ${encrypted.length} bytes (${encMethod})`,
  );

  return { encrypted, encMethod };
}

/**
 * Decrypt data using NIP-44 or NIP-04 via signer
 * Handles both compressed (new) and uncompressed (legacy) data
 * Includes a timeout to handle slow NIP-46 remote signers
 *
 * @param encMethod - hint from the event tag about which encryption was used
 */
async function decryptData(
  encryptedContent: string,
  authorPubkey: string,
  explicitSigner?: import("./signers").Signer,
  encMethod?: "nip44" | "nip04",
): Promise<StorageData> {
  const signer = explicitSigner || getSigner();
  const signerType = useStore.getState().session?.signerType;

  const withTimeout = <T>(promise: Promise<T>, label: string): Promise<T> => {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} decrypt timed out (15s)`)),
        15000,
      ),
    );
    return Promise.race([promise, timeoutPromise]);
  };

  // Determine which decryption to use based on the enc tag
  // NIP-04 and NIP-44 produce incompatible ciphertext, so we must match the method
  const useNip44 = encMethod === "nip44";

  let decrypted: string;
  try {
    if (useNip44) {
      if (!signer.nip44Decrypt) {
        throw new Error(
          "Data was encrypted with NIP-44 but current signer doesn't support nip44Decrypt. " +
          "Try logging in with a different signer.",
        );
      }
      decrypted = await withTimeout(
        signer.nip44Decrypt(authorPubkey, encryptedContent),
        "NIP-44",
      );
    } else {
      // NIP-04 (legacy or explicitly tagged)
      decrypted = await withTimeout(
        signer.nip04Decrypt(authorPubkey, encryptedContent),
        "NIP-04",
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (signerType === "nip46") {
      if (msg.includes("plaintext size") || msg.includes("timed out")) {
        throw new Error(
          `Backup too large for remote signer (${Math.round(encryptedContent.length / 1024)}KB ciphertext). ` +
            "Log in with a browser extension (NIP-07), then click 'Save to Relays' " +
            "to re-save with compression.",
        );
      }
      if (msg.includes("no permission") || msg.includes("denied")) {
        if (!useNip44) {
          throw new Error(
            "Remote signer denied NIP-04 decrypt permission. Data needs to be re-saved with NIP-44 encryption. " +
            "Log in with a browser extension (NIP-07), go to Settings > Sync, and click 'Force Re-sync'.",
          );
        }
      }
    }
    throw error;
  }

  // Handle compressed data (new format) vs raw JSON (legacy format)
  if (decrypted.startsWith(COMPRESSED_PREFIX)) {
    const jsonString = await decompressString(decrypted);
    return JSON.parse(jsonString) as StorageData;
  }

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
  explicitSigner?: import("./signers").Signer,
): Promise<Event> {
  const pool = getPool();
  const expandedRelays = getExpandedRelayList(relays);

  // Prepare event content
  let content: string;
  let encMethod: "nip44" | "nip04" | undefined;

  if (encrypted) {
    const result = await encryptData(data, userPubkey, explicitSigner);
    content = result.encrypted;
    encMethod = result.encMethod;
  } else {
    content = JSON.stringify(data);
  }

  // Create event template with encryption method tag
  const tags: string[][] = [
    ["d", dTag],
    ["encrypted", encrypted ? "true" : "false"],
  ];
  if (encMethod) {
    tags.push(["enc", encMethod]);
  }

  const eventTemplate: EventTemplate = {
    kind: APP_DATA_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  };

  // Sign event
  const signedEvent = await signEvent(eventTemplate);

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
  explicitSigner?: import("./signers").Signer,
): Promise<StorageData | null> {
  const pool = getPool();
  const expandedRelays = getExpandedRelayList(relays);
  console.log(
    `[RelayStorage] Fetching ${dTag} from ${expandedRelays.length} relays (timeout: ${timeoutMs}ms)`,
  );

  return new Promise((resolve) => {
    let latestEvent: Event | null = null;
    const timeoutId = setTimeout(() => {
      sub.close();
      if (latestEvent) {
        console.log(
          `[RelayStorage] Fetch ${dTag}: Found event from relay (created: ${new Date(latestEvent.created_at * 1000).toISOString()})`,
        );
        processEvent(latestEvent, explicitSigner)
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
          processEvent(latestEvent, explicitSigner)
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
async function processEvent(
  event: Event,
  explicitSigner?: import("./signers").Signer,
): Promise<StorageData | null> {
  try {
    // Check if encrypted
    const encryptedTag = event.tags.find((t) => t[0] === "encrypted");
    const isEncrypted = encryptedTag?.[1] === "true";

    if (isEncrypted) {
      // Check which encryption method was used (nip44 or nip04)
      const encTag = event.tags.find((t) => t[0] === "enc");
      const encMethod = encTag?.[1] as "nip44" | "nip04" | undefined;
      return await decryptData(event.content, event.pubkey, explicitSigner, encMethod);
    } else {
      return JSON.parse(event.content) as StorageData;
    }
  } catch (error) {
    const dTag = event.tags.find((t) => t[0] === "d")?.[1] || "unknown";
    const errorMsg =
      error instanceof Error ? error.message : String(error);
    console.error(
      `[RelayStorage] Failed to process ${dTag} event: ${errorMsg}`,
    );
    if (errorMsg.includes("No signer")) {
      console.error(
        `[RelayStorage] Signer not available - for NIP-46 sessions, the remote signer may not be restored yet`,
      );
    } else if (errorMsg.includes("timed out")) {
      console.error(
        `[RelayStorage] Decrypt timed out - bunker may be offline or doesn't support decrypt`,
      );
    }
    // Always re-throw so callers can decide how to handle
    // (fetchMuteBackupFromRelay shows errors to UI, follow backup fetch swallows them)
    throw error;
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
  const signedEvent = await signEvent(eventTemplate);

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
  explicitSigner?: import("./signers").Signer,
): Promise<SyncResult<T>> {
  const expandedRelays = getExpandedRelayList(relays);
  console.log(
    `[RelayStorage] Syncing ${dTag} using ${expandedRelays.length} relays (${relays.length} user + defaults)`,
  );
  const relayData = (await fetchAppData(dTag, userPubkey, relays, 5000, explicitSigner)) as T | null;
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
  explicitSigner?: import("./signers").Signer,
): Promise<Event> {
  const timestamp = Date.now();

  // Save mute list as its own event (small enough for NIP-46)
  const muteData: MuteBackupData = {
    version: 1,
    timestamp,
    muteList,
    notes,
  };

  console.log(`[RelayStorage] Saving mute backup to relays...`);
  console.log(
    `[RelayStorage] Backup contains: ${muteList.pubkeys.length} muted pubkeys, ${muteList.words.length} words, ${muteList.tags.length} tags, ${muteList.threads.length} threads`,
  );

  const muteEvent = await publishAppData(D_TAGS.MUTE_BACKUP, muteData, userPubkey, relays, true, explicitSigner);

  // Save follow list in chunks to stay within NIP-46 transport limits
  if (followList && followList.length > 0) {
    const totalChunks = Math.ceil(followList.length / FOLLOW_CHUNK_SIZE);
    console.log(
      `[RelayStorage] Saving follow backup (${followList.length} follows) in ${totalChunks} chunk(s)...`,
    );

    let savedChunks = 0;
    for (let i = 0; i < totalChunks; i++) {
      const chunk = followList.slice(
        i * FOLLOW_CHUNK_SIZE,
        (i + 1) * FOLLOW_CHUNK_SIZE,
      );
      const chunkTag: DTagType = `mutable:follow-backup:${i}`;
      const followData: MuteBackupData = {
        version: 1,
        timestamp,
        muteList: { pubkeys: [], words: [], tags: [], threads: [] },
        followList: chunk,
        notes,
        totalChunks,
        chunkIndex: i,
      };
      try {
        await publishAppData(chunkTag, followData, userPubkey, relays, true, explicitSigner);
        savedChunks++;
      } catch (error) {
        console.warn(`[RelayStorage] Failed to save follow backup chunk ${i}/${totalChunks}:`, error);
      }
    }
    console.log(
      `[RelayStorage] Follow backup: saved ${savedChunks}/${totalChunks} chunks`,
    );
  }

  return muteEvent;
}

export interface MuteBackupResult {
  backup: MuteBackupData | null;
  foundOnRelays: string[];
  queriedRelays: string[];
  decryptError?: string;
}

/**
 * Fetch backup from relays with relay status tracking
 */
export async function fetchMuteBackupFromRelay(
  userPubkey: string,
  relays: string[],
  timeoutMs: number = 5000,
  explicitSigner?: import("./signers").Signer,
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
    const data = await processEvent(latestEvent, explicitSigner);
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

    // If mute backup doesn't include follows, try fetching chunked follow backup
    if (!backup.followList || backup.followList.length === 0) {
      try {
        // First try chunk 0 to see if chunked format exists and get totalChunks
        const chunk0Data = await fetchAppData(
          `mutable:follow-backup:0` as DTagType,
          userPubkey,
          relays,
          timeoutMs,
          explicitSigner,
        );

        if (chunk0Data) {
          const chunk0 = chunk0Data as MuteBackupData;
          const totalChunks = chunk0.totalChunks || 1;
          const allFollows: string[] = [...(chunk0.followList || [])];

          // Fetch remaining chunks in parallel
          if (totalChunks > 1) {
            const chunkPromises: Promise<StorageData | null>[] = [];
            for (let i = 1; i < Math.min(totalChunks, MAX_FOLLOW_CHUNKS); i++) {
              chunkPromises.push(
                fetchAppData(
                  `mutable:follow-backup:${i}` as DTagType,
                  userPubkey,
                  relays,
                  timeoutMs,
                  explicitSigner,
                ),
              );
            }

            const chunkResults = await Promise.allSettled(chunkPromises);
            let fetchedChunks = 1; // chunk 0 already fetched

            for (const result of chunkResults) {
              if (result.status === "fulfilled" && result.value) {
                const chunkData = result.value as MuteBackupData;
                if (chunkData.followList) {
                  allFollows.push(...chunkData.followList);
                  fetchedChunks++;
                }
              }
            }
            console.log(
              `[RelayStorage] Fetched ${fetchedChunks}/${totalChunks} follow backup chunks`,
            );
          }

          if (allFollows.length > 0) {
            backup.followList = allFollows;
            console.log(
              `[RelayStorage] Merged chunked follow backup: ${allFollows.length} follows`,
            );
          }
        } else {
          // Fall back to legacy single follow backup (pre-chunking format)
          const legacyData = await fetchAppData(
            D_TAGS.FOLLOW_BACKUP,
            userPubkey,
            relays,
            timeoutMs,
            explicitSigner,
          );
          if (legacyData) {
            const legacyBackup = legacyData as MuteBackupData;
            if (legacyBackup.followList && legacyBackup.followList.length > 0) {
              backup.followList = legacyBackup.followList;
              console.log(
                `[RelayStorage] Merged legacy follow backup: ${legacyBackup.followList.length} follows`,
              );
            }
          }
        }
      } catch {
        // Follow backup fetch failed — not critical, mute backup still works
        console.warn("[RelayStorage] Could not fetch follow backup");
      }
    }

    if (backup.followList) {
      console.log(
        `[RelayStorage] Backup includes: ${backup.followList.length} follows`,
      );
    }

    return { backup, foundOnRelays, queriedRelays: expandedRelays };
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : String(error);
    console.error(`[RelayStorage] Error processing backup:`, errorMsg);
    return {
      backup: null,
      foundOnRelays,
      queriedRelays: expandedRelays,
      decryptError: errorMsg,
    };
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
