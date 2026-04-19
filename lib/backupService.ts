import { MuteList } from "@/types";
import {
  saveMuteBackupToRelay,
  fetchMuteBackupFromRelay,
  deleteMuteBackupFromRelay,
  saveListBackupToRelay as saveListBackupToRelayImpl,
  fetchListBackupFromRelay as fetchListBackupFromRelayImpl,
  deleteListBackupFromRelay as deleteListBackupFromRelayImpl,
  LIST_BACKUP_PREFIX,
  MuteBackupData,
  ListBackupResult,
  ListBackupSaveResult,
} from "./relayStorage";

export type BackupType =
  | "mute-list"
  | "follow-list"
  | "bookmarks"
  | "pinned-notes"
  | "interests";

export const LIST_BACKUP_TYPES: Readonly<BackupType[]> = [
  "mute-list",
  "follow-list",
  "bookmarks",
  "pinned-notes",
  "interests",
];

// Map between NIP-51 list kind and BackupType for the three list-backup kinds.
export const LIST_KIND_TO_TYPE: Record<number, BackupType> = {
  10001: "pinned-notes",
  10003: "bookmarks",
  10015: "interests",
};
export const LIST_TYPE_TO_KIND: Partial<Record<BackupType, number>> = {
  "pinned-notes": 10001,
  bookmarks: 10003,
  interests: 10015,
};

/**
 * Raw NIP-51 list event payload stored in a list-type Backup. Kept opaque:
 * `content` may be NIP-04/NIP-44 ciphertext (private list items) and is
 * preserved verbatim so restore round-trips without ever decrypting.
 */
export interface RawListBackupPayload {
  kind: number;
  tags: string[][];
  content: string;
}

export interface Backup {
  id: string;
  type: BackupType;
  pubkey: string;
  // mute-list → MuteList; follow-list → string[]; list types → RawListBackupPayload
  data: MuteList | string[] | RawListBackupPayload;
  createdAt: number;
  notes?: string;
  eventId?: string; // The Nostr event ID this backup was created from
}

function isRawListBackupPayload(value: unknown): value is RawListBackupPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<RawListBackupPayload>;
  return (
    typeof v.kind === "number" &&
    Array.isArray(v.tags) &&
    typeof v.content === "string"
  );
}

class BackupService {
  private readonly BACKUP_KEY = "mutable-backups";
  private readonly MAX_BACKUPS = 50; // Keep last 50 backups per type

  /**
   * Generate a unique backup ID
   * Uses timestamp + random string + counter for uniqueness
   */
  private idCounter = 0;
  generateBackupId(): string {
    this.idCounter = (this.idCounter + 1) % 10000; // Reset after 10000
    return `backup-${Date.now()}-${Math.random().toString(36).substring(2, 9)}-${this.idCounter}`;
  }

  /**
   * Get all backups from localStorage
   * Automatically deduplicates by ID to prevent React key conflicts
   */
  getAllBackups(): Backup[] {
    try {
      const stored = localStorage.getItem(this.BACKUP_KEY);
      if (!stored) return [];

      const backups = JSON.parse(stored) as Backup[];

      // Deduplicate by ID (keep first occurrence)
      const seenIds = new Set<string>();
      const uniqueBackups = backups.filter((backup) => {
        if (seenIds.has(backup.id)) {
          console.warn(
            `Duplicate backup ID found: ${backup.id}, skipping duplicate`,
          );
          return false;
        }
        seenIds.add(backup.id);
        return true;
      });

      // If we found duplicates, save the cleaned version back
      if (uniqueBackups.length !== backups.length) {
        console.log(
          `Removed ${backups.length - uniqueBackups.length} duplicate backups from storage`,
        );
        localStorage.setItem(this.BACKUP_KEY, JSON.stringify(uniqueBackups));
      }

      return uniqueBackups;
    } catch (error) {
      console.error("Failed to load backups:", error);
      return [];
    }
  }

  /**
   * Get backups filtered by type
   */
  getBackupsByType(type: BackupType): Backup[] {
    return this.getAllBackups().filter((backup) => backup.type === type);
  }

  /**
   * Save a backup. Caps each backup type at MAX_BACKUPS independently so
   * adding a new type never evicts backups of existing types.
   */
  saveBackup(backup: Backup): boolean {
    try {
      const backups = this.getAllBackups();

      // Add new backup
      backups.unshift(backup); // Add to beginning

      // Cap each known type at MAX_BACKUPS independently. Anything with an
      // unknown type is preserved as-is so forward-compat backups are not lost.
      const byType: Record<string, Backup[]> = {};
      const unknownTypeBackups: Backup[] = [];
      for (const b of backups) {
        if (LIST_BACKUP_TYPES.includes(b.type)) {
          (byType[b.type] = byType[b.type] || []).push(b);
        } else {
          unknownTypeBackups.push(b);
        }
      }

      const limited: Backup[] = [];
      for (const type of LIST_BACKUP_TYPES) {
        limited.push(...(byType[type] || []).slice(0, this.MAX_BACKUPS));
      }
      limited.push(...unknownTypeBackups);
      limited.sort((a, b) => b.createdAt - a.createdAt);

      localStorage.setItem(this.BACKUP_KEY, JSON.stringify(limited));
      return true;
    } catch (error) {
      console.error("Failed to save backup:", error);
      return false;
    }
  }

  /**
   * Create a mute list backup
   */
  createMuteListBackup(
    pubkey: string,
    muteList: MuteList,
    notes?: string,
    eventId?: string,
  ): Backup {
    return {
      id: this.generateBackupId(),
      type: "mute-list",
      pubkey,
      data: muteList,
      createdAt: Date.now(),
      notes,
      eventId,
    };
  }

  /**
   * Create a follow list backup
   */
  createFollowListBackup(
    pubkey: string,
    follows: string[],
    notes?: string,
    eventId?: string,
  ): Backup {
    return {
      id: this.generateBackupId(),
      type: "follow-list",
      pubkey,
      data: follows,
      createdAt: Date.now(),
      notes,
      eventId,
    };
  }

  /**
   * Create a NIP-51 list-type backup (bookmarks / pinned notes / interests).
   * `data` preserves the raw event tags + (possibly encrypted) content so
   * restore can republish the event verbatim.
   */
  createListBackup(
    pubkey: string,
    type: "bookmarks" | "pinned-notes" | "interests",
    payload: RawListBackupPayload,
    notes?: string,
    eventId?: string,
  ): Backup {
    return {
      id: this.generateBackupId(),
      type,
      pubkey,
      data: payload,
      createdAt: Date.now(),
      notes,
      eventId,
    };
  }

  /**
   * Export a backup to JSON file
   */
  exportBackupToFile(backup: Backup): void {
    const timestamp = new Date(backup.createdAt).toISOString().split("T")[0];
    const filename = `mutable-${backup.type}-backup-${timestamp}.json`;
    const jsonString = JSON.stringify(backup, null, 2);

    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Import a backup from JSON file
   */
  async importBackupFromFile(
    fileContent: string,
  ): Promise<{ success: boolean; backup?: Backup; error?: string }> {
    try {
      const backup = JSON.parse(fileContent) as Backup;

      // Validate backup structure
      if (
        !backup.id ||
        !backup.type ||
        !backup.pubkey ||
        !backup.data ||
        !backup.createdAt
      ) {
        return { success: false, error: "Invalid backup file format" };
      }

      // Validate type
      if (!LIST_BACKUP_TYPES.includes(backup.type)) {
        return { success: false, error: "Invalid backup type" };
      }

      // Validate data structure based on type
      if (backup.type === "mute-list") {
        const muteList = backup.data as MuteList;
        if (
          !muteList.pubkeys ||
          !muteList.words ||
          !muteList.tags ||
          !muteList.threads
        ) {
          return { success: false, error: "Invalid mute list backup format" };
        }
      } else if (backup.type === "follow-list") {
        if (!Array.isArray(backup.data)) {
          return { success: false, error: "Invalid follow list backup format" };
        }
      } else if (
        backup.type === "bookmarks" ||
        backup.type === "pinned-notes" ||
        backup.type === "interests"
      ) {
        if (!isRawListBackupPayload(backup.data)) {
          return {
            success: false,
            error: `Invalid ${backup.type} backup format`,
          };
        }
        const expectedKind = LIST_TYPE_TO_KIND[backup.type];
        if (expectedKind && backup.data.kind !== expectedKind) {
          return {
            success: false,
            error: `Backup kind ${backup.data.kind} does not match type ${backup.type}`,
          };
        }
      }

      // Save the backup
      const saved = this.saveBackup(backup);

      if (!saved) {
        return { success: false, error: "Failed to save imported backup" };
      }

      return { success: true, backup };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to parse backup file",
      };
    }
  }

  /**
   * Delete a backup
   */
  deleteBackup(id: string): boolean {
    try {
      const backups = this.getAllBackups();
      const filtered = backups.filter((backup) => backup.id !== id);
      localStorage.setItem(this.BACKUP_KEY, JSON.stringify(filtered));
      return true;
    } catch (error) {
      console.error("Failed to delete backup:", error);
      return false;
    }
  }

  /**
   * Get a specific backup by ID
   */
  getBackupById(id: string): Backup | null {
    const backups = this.getAllBackups();
    return backups.find((backup) => backup.id === id) || null;
  }

  /**
   * Delete all backups (use with caution)
   */
  deleteAllBackups(): boolean {
    try {
      localStorage.removeItem(this.BACKUP_KEY);
      return true;
    } catch (error) {
      console.error("Failed to delete all backups:", error);
      return false;
    }
  }

  /**
   * Get the most recent backup of a specific type
   */
  getMostRecentBackup(type: BackupType): Backup | null {
    const backups = this.getBackupsByType(type);
    if (backups.length === 0) return null;
    return backups[0]; // Already sorted by createdAt descending
  }

  /**
   * Check if user should be reminded to backup
   * Returns true if last backup was more than X days ago
   */
  shouldRemindBackup(
    type: BackupType,
    daysSinceLastBackup: number = 7,
  ): boolean {
    const lastBackup = this.getMostRecentBackup(type);
    if (!lastBackup) return true;

    const daysSince =
      (Date.now() - lastBackup.createdAt) / (1000 * 60 * 60 * 24);
    return daysSince >= daysSinceLastBackup;
  }

  /**
   * Restore a mute list backup
   * Returns the MuteList data if successful, null otherwise
   */
  restoreMuteListBackup(backupId: string): MuteList | null {
    const backup = this.getBackupById(backupId);
    if (!backup || backup.type !== "mute-list") {
      return null;
    }
    return backup.data as MuteList;
  }

  /**
   * Restore a follow list backup
   * Returns the pubkey array if successful, null otherwise
   */
  restoreFollowListBackup(backupId: string): string[] | null {
    const backup = this.getBackupById(backupId);
    if (!backup || backup.type !== "follow-list") {
      return null;
    }
    return backup.data as string[];
  }

  /**
   * Restore a list-type backup (bookmarks / pinned notes / interests).
   * Returns the raw NIP-51 payload if successful, null otherwise.
   */
  restoreListBackup(backupId: string): RawListBackupPayload | null {
    const backup = this.getBackupById(backupId);
    if (!backup) return null;
    if (
      backup.type !== "bookmarks" &&
      backup.type !== "pinned-notes" &&
      backup.type !== "interests"
    ) {
      return null;
    }
    if (!isRawListBackupPayload(backup.data)) return null;
    return backup.data;
  }

  // =============================================================================
  // Relay Backup Functions (NIP-78)
  // =============================================================================

  /**
   * Save mute list and follow list backup to Nostr relays
   * Uses NIP-78 for encrypted cross-device backup storage
   */
  async saveBackupToRelay(
    muteList: MuteList,
    userPubkey: string,
    relays: string[],
    notes?: string,
    followList?: string[],
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await saveMuteBackupToRelay(
        muteList,
        userPubkey,
        relays,
        notes,
        followList,
      );
      return { success: true };
    } catch (error) {
      console.error("Failed to save backup to relays:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to save backup to relays",
      };
    }
  }

  /**
   * Fetch mute list backup from Nostr relays
   */
  async fetchBackupFromRelay(
    userPubkey: string,
    relays: string[],
    signer?: import("./signers").Signer,
  ): Promise<{
    success: boolean;
    backup?: MuteBackupData;
    foundOnRelays?: string[];
    queriedRelays?: string[];
    error?: string;
  }> {
    try {
      const result = await fetchMuteBackupFromRelay(userPubkey, relays, 5000, signer);
      if (!result.backup) {
        return {
          success: true,
          backup: undefined,
          foundOnRelays: result.foundOnRelays,
          queriedRelays: result.queriedRelays,
          error: result.decryptError,
        };
      }
      return {
        success: true,
        backup: result.backup,
        foundOnRelays: result.foundOnRelays,
        queriedRelays: result.queriedRelays,
      };
    } catch (error) {
      console.error("Failed to fetch backup from relays:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch backup from relays",
      };
    }
  }

  /**
   * Delete mute list backup from Nostr relay
   */
  async deleteBackupFromRelay(
    userPubkey: string,
    relays: string[],
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await deleteMuteBackupFromRelay(userPubkey, relays);
      return { success: true };
    } catch (error) {
      console.error("Failed to delete backup from relay:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete backup from relay",
      };
    }
  }

  // =============================================================================
  // List (NIP-51) Backup Relay Functions — bookmarks / pinned notes / interests
  // =============================================================================

  /**
   * Save a NIP-51 list backup to relays (encrypted, chunked).
   */
  async saveListBackupToRelay(
    kind: number,
    rawEvent: RawListBackupPayload,
    userPubkey: string,
    relays: string[],
    notes?: string,
    signer?: import("./signers").Signer,
  ): Promise<{ success: boolean; result?: ListBackupSaveResult; error?: string }> {
    if (!LIST_BACKUP_PREFIX[kind]) {
      return { success: false, error: `Unsupported list backup kind: ${kind}` };
    }
    try {
      const result = await saveListBackupToRelayImpl(
        kind,
        rawEvent,
        userPubkey,
        relays,
        notes,
        signer,
      );
      if (result.savedChunks === 0) {
        return {
          success: false,
          result,
          error: "Failed to save any chunks to relays",
        };
      }
      return { success: true, result };
    } catch (error) {
      console.error("Failed to save list backup to relays:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to save list backup to relays",
      };
    }
  }

  /**
   * Fetch a NIP-51 list backup from relays (chunks reassembled).
   */
  async fetchListBackupFromRelay(
    kind: number,
    userPubkey: string,
    relays: string[],
    signer?: import("./signers").Signer,
  ): Promise<{
    success: boolean;
    backup?: ListBackupResult["backup"];
    foundOnRelays?: string[];
    queriedRelays?: string[];
    error?: string;
  }> {
    if (!LIST_BACKUP_PREFIX[kind]) {
      return { success: false, error: `Unsupported list backup kind: ${kind}` };
    }
    try {
      const result = await fetchListBackupFromRelayImpl(
        kind,
        userPubkey,
        relays,
        5000,
        signer,
      );
      return {
        success: true,
        backup: result.backup || undefined,
        foundOnRelays: result.foundOnRelays,
        queriedRelays: result.queriedRelays,
        error: result.decryptError,
      };
    } catch (error) {
      console.error("Failed to fetch list backup from relays:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch list backup from relays",
      };
    }
  }

  /**
   * Delete a NIP-51 list backup from relays (all chunks).
   */
  async deleteListBackupFromRelay(
    kind: number,
    userPubkey: string,
    relays: string[],
  ): Promise<{ success: boolean; deletedChunks?: number; error?: string }> {
    if (!LIST_BACKUP_PREFIX[kind]) {
      return { success: false, error: `Unsupported list backup kind: ${kind}` };
    }
    try {
      const { deletedChunks } = await deleteListBackupFromRelayImpl(
        kind,
        userPubkey,
        relays,
      );
      return { success: true, deletedChunks };
    } catch (error) {
      console.error("Failed to delete list backup from relay:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete list backup from relay",
      };
    }
  }
}

// Create singleton instance
export const backupService = new BackupService();
