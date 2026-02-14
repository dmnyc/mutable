/**
 * Profile Backup Service
 *
 * Manages rotating 3-slot encrypted profile backups on Nostr relays
 * using NIP-78 (kind:30078). Before publishing profile edits, the
 * current profile is automatically backed up to allow restoration.
 *
 * D-tags: mutable:profile-backup:0, :1, :2
 * Encryption: NIP-04 (encrypted to user's own pubkey)
 */

import {
  D_TAGS,
  DTagType,
  ProfileBackupData,
  publishAppData,
  fetchAppData,
} from "./relayStorage";

const SLOT_COUNT = 3;
const SLOT_INDEX_KEY = "mutable_profile_backup_slot_index";

const SLOT_DTAGS: DTagType[] = [
  D_TAGS.PROFILE_BACKUP_0,
  D_TAGS.PROFILE_BACKUP_1,
  D_TAGS.PROFILE_BACKUP_2,
];

class ProfileBackupService {
  /**
   * Get the next slot index (rotating 0 -> 1 -> 2 -> 0 -> ...)
   */
  private getNextSlotIndex(): number {
    try {
      const stored = localStorage.getItem(SLOT_INDEX_KEY);
      const current = stored ? parseInt(stored, 10) : -1;
      const next = (current + 1) % SLOT_COUNT;
      localStorage.setItem(SLOT_INDEX_KEY, String(next));
      return next;
    } catch {
      return 0;
    }
  }

  /**
   * Save a profile backup to the next rotating slot.
   * Called automatically before publishing profile edits.
   */
  async saveBackup(
    profileContent: Record<string, unknown>,
    userPubkey: string,
    relays: string[],
  ): Promise<{ success: boolean; slot: number; error?: string }> {
    const slotIndex = this.getNextSlotIndex();
    const dTag = SLOT_DTAGS[slotIndex];

    const data: ProfileBackupData = {
      version: 1,
      timestamp: Date.now(),
      profile: profileContent,
    };

    try {
      await publishAppData(dTag, data, userPubkey, relays, true);
      console.log(
        `[ProfileBackup] Saved backup to slot ${slotIndex} (${dTag})`,
      );
      return { success: true, slot: slotIndex };
    } catch (error) {
      console.error(`[ProfileBackup] Failed to save backup:`, error);
      return {
        success: false,
        slot: slotIndex,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Fetch all available profile backups from all 3 slots
   */
  async fetchAllBackups(
    userPubkey: string,
    relays: string[],
  ): Promise<Array<{ slot: number; data: ProfileBackupData | null }>> {
    const results = await Promise.all(
      SLOT_DTAGS.map(async (dTag, slot) => {
        try {
          const data = await fetchAppData(dTag, userPubkey, relays);
          return { slot, data: data as ProfileBackupData | null };
        } catch {
          return { slot, data: null };
        }
      }),
    );
    return results;
  }

  /**
   * Fetch the most recent backup across all slots
   */
  async fetchLatestBackup(
    userPubkey: string,
    relays: string[],
  ): Promise<{ slot: number; data: ProfileBackupData } | null> {
    const all = await this.fetchAllBackups(userPubkey, relays);
    const valid = all.filter(
      (r): r is { slot: number; data: ProfileBackupData } =>
        r.data !== null && typeof r.data.timestamp === "number",
    );

    if (valid.length === 0) return null;

    valid.sort((a, b) => b.data.timestamp - a.data.timestamp);
    return valid[0];
  }
}

export const profileBackupService = new ProfileBackupService();
