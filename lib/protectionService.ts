// Protection Service for Decimator
// Manages the list of protected users (immunity from decimation)
// Now with relay storage support for multi-device sync

import {
  publishAppData,
  fetchAppData,
  syncData,
  D_TAGS,
  type ProtectedUsersData,
} from './relayStorage';

export interface ProtectionRecord {
  pubkey: string;
  addedAt: number;
  note?: string;
}

class ProtectionService {
  private storageKey = 'mutable_protected_users';
  private syncInProgress = false;

  // Cache for performance optimization
  private cache: {
    records: ProtectionRecord[] | null;
    pubkeySet: Set<string> | null;
    lastCheck: number;
    storageVersion: string | null;
  } = {
    records: null,
    pubkeySet: null,
    lastCheck: 0,
    storageVersion: null,
  };

  /**
   * Get current localStorage value for cache validation
   */
  private getCurrentStorageVersion(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(this.storageKey);
  }

  /**
   * Check if cache is valid
   */
  private isCacheValid(): boolean {
    // Cache is valid if storage hasn't changed
    const currentVersion = this.getCurrentStorageVersion();
    return this.cache.storageVersion === currentVersion;
  }

  /**
   * Invalidate cache (call after any modification)
   */
  private invalidateCache(): void {
    this.cache.records = null;
    this.cache.pubkeySet = null;
    this.cache.storageVersion = null;
  }

  /**
   * Load and cache protection records
   */
  private loadAndCacheRecords(): ProtectionRecord[] {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) {
        this.cache.records = [];
        this.cache.pubkeySet = new Set();
        this.cache.storageVersion = stored;
        return [];
      }

      const records: ProtectionRecord[] = JSON.parse(stored);
      this.cache.records = records;
      this.cache.pubkeySet = new Set(records.map(r => r.pubkey));
      this.cache.storageVersion = stored;
      return records;
    } catch (error) {
      console.error('Failed to load protection records:', error);
      this.cache.records = [];
      this.cache.pubkeySet = new Set();
      return [];
    }
  }

  /**
   * Load protected pubkeys from localStorage (cached)
   */
  loadProtectedUsers(): Set<string> {
    if (!this.isCacheValid()) {
      this.loadAndCacheRecords();
    }
    return this.cache.pubkeySet || new Set();
  }

  /**
   * Load all protection records with metadata (cached)
   */
  loadProtectionRecords(): ProtectionRecord[] {
    if (!this.isCacheValid()) {
      this.loadAndCacheRecords();
    }
    return this.cache.records || [];
  }

  /**
   * Save protected pubkeys to localStorage
   */
  private saveProtectionRecords(records: ProtectionRecord[]): boolean {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(records));
      this.invalidateCache(); // Invalidate cache after save
      return true;
    } catch (error) {
      console.error('Failed to save protection records:', error);
      return false;
    }
  }

  /**
   * Add a user to the protected list
   */
  addProtection(pubkey: string, note?: string): boolean {
    if (!pubkey) return false;

    const records = this.loadProtectionRecords();

    // Check if already protected
    if (records.some(r => r.pubkey === pubkey)) {
      return true;
    }

    // Add new protection record
    records.push({
      pubkey,
      addedAt: Date.now(),
      note
    });

    return this.saveProtectionRecords(records);
  }

  /**
   * Remove a user from the protected list
   */
  removeProtection(pubkey: string): boolean {
    if (!pubkey) return false;

    const records = this.loadProtectionRecords();
    const filtered = records.filter(r => r.pubkey !== pubkey);

    return this.saveProtectionRecords(filtered);
  }

  /**
   * Check if a user is protected
   */
  isProtected(pubkey: string): boolean {
    const protectedSet = this.loadProtectedUsers();
    return protectedSet.has(pubkey);
  }

  /**
   * Get all protected pubkeys
   */
  getProtectedPubkeys(): string[] {
    return Array.from(this.loadProtectedUsers());
  }

  /**
   * Get count of protected users
   */
  getProtectedCount(): number {
    return this.loadProtectedUsers().size;
  }

  /**
   * Clear all protection records
   */
  clearAllProtection(): boolean {
    try {
      localStorage.removeItem(this.storageKey);
      this.invalidateCache(); // Invalidate cache after clear
      return true;
    } catch (error) {
      console.error('Failed to clear protection records:', error);
      return false;
    }
  }

  /**
   * Filter users to remove protected ones
   */
  filterProtectedUsers<T extends { pubkey: string }>(users: T[]): T[] {
    const protectedSet = this.loadProtectedUsers();
    return users.filter(user => !protectedSet.has(user.pubkey));
  }

  /**
   * Convert ProtectionRecord[] to ProtectedUsersData format
   */
  private toStorageFormat(records: ProtectionRecord[]): ProtectedUsersData {
    return {
      version: 1,
      timestamp: Date.now(),
      users: records.map(r => ({
        pubkey: r.pubkey,
        addedAt: r.addedAt,
        reason: r.note,
      })),
    };
  }

  /**
   * Convert ProtectedUsersData to ProtectionRecord[] format
   */
  private fromStorageFormat(data: ProtectedUsersData): ProtectionRecord[] {
    if (!data.users || data.users.length === 0) {
      return [];
    }
    return data.users.map(u => ({
      pubkey: u.pubkey,
      addedAt: u.addedAt,
      note: u.reason,
    }));
  }

  /**
   * Sync protection data with relay storage
   * Call this on app initialization and after sign-in
   */
  async syncWithRelay(userPubkey: string, relays: string[]): Promise<boolean> {
    if (this.syncInProgress) {
      console.log('[ProtectionService] Sync already in progress');
      return false;
    }

    this.syncInProgress = true;

    try {
      // Load local data
      const localRecords = this.loadProtectionRecords();
      console.log(`[ProtectionService] Local records count: ${localRecords.length}`);
      const localData = localRecords.length > 0
        ? this.toStorageFormat(localRecords)
        : null;

      if (localData) {
        console.log(`[ProtectionService] Local data to sync:`, {
          version: localData.version,
          timestamp: localData.timestamp,
          userCount: localData.users.length
        });
      } else {
        console.log('[ProtectionService] No local data to sync');
      }

      // Sync with relay
      const syncResult = await syncData<ProtectedUsersData>(
        D_TAGS.PROTECTED_USERS,
        localData,
        userPubkey,
        relays
      );

      console.log(`[ProtectionService] Sync result:`, {
        source: syncResult.source,
        needsPublish: syncResult.needsPublish,
        dataUserCount: syncResult.data.users?.length || 0
      });

      // Only update local storage if relay data is newer
      if (syncResult.source === 'relay' || syncResult.source === 'merged') {
        const syncedRecords = this.fromStorageFormat(syncResult.data);
        console.log(`[ProtectionService] Updating local storage with ${syncedRecords.length} records from ${syncResult.source}`);
        this.saveProtectionRecords(syncedRecords);
      }

      // If local was newer, publish to relay
      if (syncResult.needsPublish) {
        console.log('[ProtectionService] Publishing local data to relay');
        await publishAppData(
          D_TAGS.PROTECTED_USERS,
          syncResult.data,
          userPubkey,
          relays,
          true // encrypted
        );
      }

      console.log(`[ProtectionService] Protection sync completed (source: ${syncResult.source})`);
      return true;
    } catch (error) {
      console.error('[ProtectionService] Failed to sync protection data:', error);
      return false;
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Publish current protection data to relay
   * Call this after adding/removing protected users
   */
  async publishToRelay(userPubkey: string, relays: string[]): Promise<boolean> {
    try {
      const records = this.loadProtectionRecords();
      const data = this.toStorageFormat(records);

      await publishAppData(
        D_TAGS.PROTECTED_USERS,
        data,
        userPubkey,
        relays,
        true // encrypted
      );

      console.log('Protection data published to relay');
      return true;
    } catch (error) {
      console.error('Failed to publish protection data:', error);
      return false;
    }
  }

  /**
   * Fetch latest protection data from relay
   * Useful for manual refresh
   */
  async fetchFromRelay(userPubkey: string, relays: string[]): Promise<ProtectionRecord[]> {
    try {
      const data = await fetchAppData(
        D_TAGS.PROTECTED_USERS,
        userPubkey,
        relays
      ) as ProtectedUsersData | null;

      if (!data) {
        return [];
      }

      return this.fromStorageFormat(data);
    } catch (error) {
      console.error('Failed to fetch protection data from relay:', error);
      return [];
    }
  }
}

// Create singleton instance
export const protectionService = new ProtectionService();
