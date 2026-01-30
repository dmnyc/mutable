import { MuteList } from "@/types";
import {
  saveMuteBackupToRelay,
  fetchMuteBackupFromRelay,
  deleteMuteBackupFromRelay,
  MuteBackupData,
} from "./relayStorage";

export interface Backup {
  id: string;
  type: "mute-list" | "follow-list";
  pubkey: string;
  data: MuteList | string[]; // MuteList for mute-list, string[] of pubkeys for follow-list
  createdAt: number;
  notes?: string;
  eventId?: string; // The Nostr event ID this backup was created from
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
  getBackupsByType(type: "mute-list" | "follow-list"): Backup[] {
    return this.getAllBackups().filter((backup) => backup.type === type);
  }

  /**
   * Save a backup
   */
  saveBackup(backup: Backup): boolean {
    try {
      const backups = this.getAllBackups();

      // Add new backup
      backups.unshift(backup); // Add to beginning

      // Limit backups per type
      const muteBackups = backups
        .filter((b) => b.type === "mute-list")
        .slice(0, this.MAX_BACKUPS);
      const followBackups = backups
        .filter((b) => b.type === "follow-list")
        .slice(0, this.MAX_BACKUPS);

      const limitedBackups = [...muteBackups, ...followBackups].sort(
        (a, b) => b.createdAt - a.createdAt,
      );

      localStorage.setItem(this.BACKUP_KEY, JSON.stringify(limitedBackups));
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
      if (backup.type !== "mute-list" && backup.type !== "follow-list") {
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
  getMostRecentBackup(type: "mute-list" | "follow-list"): Backup | null {
    const backups = this.getBackupsByType(type);
    if (backups.length === 0) return null;
    return backups[0]; // Already sorted by createdAt descending
  }

  /**
   * Check if user should be reminded to backup
   * Returns true if last backup was more than X days ago
   */
  shouldRemindBackup(
    type: "mute-list" | "follow-list",
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
  ): Promise<{
    success: boolean;
    backup?: MuteBackupData;
    foundOnRelays?: string[];
    queriedRelays?: string[];
    error?: string;
  }> {
    try {
      const result = await fetchMuteBackupFromRelay(userPubkey, relays);
      if (!result.backup) {
        return {
          success: true,
          backup: undefined,
          foundOnRelays: result.foundOnRelays,
          queriedRelays: result.queriedRelays,
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
}

// Create singleton instance
export const backupService = new BackupService();
