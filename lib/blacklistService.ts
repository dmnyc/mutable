// Blacklist Service
// Manages the list of blacklisted pubkeys (prevents re-import of removed inactive profiles)
// Now with relay storage support for multi-device sync

import {
  publishAppData,
  fetchAppData,
  syncData,
  D_TAGS,
  type BlacklistData,
} from './relayStorage';

class BlacklistService {
  private storageKey = 'mutable_blacklisted_pubkeys';
  private syncInProgress = false;

  // Cache for performance optimization
  private cache: {
    blacklist: Set<string> | null;
    storageVersion: string | null;
  } = {
    blacklist: null,
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
    const currentVersion = this.getCurrentStorageVersion();
    return this.cache.storageVersion === currentVersion;
  }

  /**
   * Invalidate cache (call after any modification)
   */
  private invalidateCache(): void {
    this.cache.blacklist = null;
    this.cache.storageVersion = null;
  }

  /**
   * Load blacklisted pubkeys from localStorage (cached)
   */
  loadBlacklist(): Set<string> {
    if (typeof window === 'undefined') return new Set<string>();

    // Return cached value if valid
    if (this.isCacheValid() && this.cache.blacklist) {
      return this.cache.blacklist;
    }

    // Load and cache
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const array = JSON.parse(stored);
        const blacklist = new Set<string>(array);
        this.cache.blacklist = blacklist;
        this.cache.storageVersion = stored;
        return blacklist;
      }
    } catch (error) {
      console.error('Failed to load blacklist from localStorage:', error);
    }

    const emptySet = new Set<string>();
    this.cache.blacklist = emptySet;
    this.cache.storageVersion = null;
    return emptySet;
  }

  /**
   * Save blacklist to localStorage
   */
  private saveBlacklist(pubkeys: Set<string>): boolean {
    if (typeof window === 'undefined') return false;

    try {
      localStorage.setItem(this.storageKey, JSON.stringify(Array.from(pubkeys)));
      this.invalidateCache(); // Invalidate cache after save
      return true;
    } catch (error) {
      console.error('Failed to save blacklist to localStorage:', error);
      return false;
    }
  }

  /**
   * Add a pubkey to the blacklist
   */
  addToBlacklist(pubkey: string): boolean {
    if (!pubkey) return false;

    const blacklist = this.loadBlacklist();
    blacklist.add(pubkey);

    return this.saveBlacklist(blacklist);
  }

  /**
   * Remove a pubkey from the blacklist
   */
  removeFromBlacklist(pubkey: string): boolean {
    if (!pubkey) return false;

    const blacklist = this.loadBlacklist();
    blacklist.delete(pubkey);

    return this.saveBlacklist(blacklist);
  }

  /**
   * Check if a pubkey is blacklisted
   */
  isBlacklisted(pubkey: string): boolean {
    return this.loadBlacklist().has(pubkey);
  }

  /**
   * Get all blacklisted pubkeys
   */
  getBlacklistedPubkeys(): string[] {
    return Array.from(this.loadBlacklist());
  }

  /**
   * Get count of blacklisted pubkeys
   */
  getBlacklistCount(): number {
    return this.loadBlacklist().size;
  }

  /**
   * Clear all blacklisted pubkeys
   */
  clearBlacklist(): boolean {
    if (typeof window === 'undefined') return false;

    try {
      localStorage.setItem(this.storageKey, JSON.stringify([]));
      this.invalidateCache(); // Invalidate cache after clear
      return true;
    } catch (error) {
      console.error('Failed to clear blacklist:', error);
      return false;
    }
  }

  /**
   * Convert Set<string> to BlacklistData format
   */
  private toStorageFormat(pubkeys: Set<string>): BlacklistData {
    return {
      version: 1,
      timestamp: Date.now(),
      pubkeys: Array.from(pubkeys),
    };
  }

  /**
   * Convert BlacklistData to Set<string> format
   */
  private fromStorageFormat(data: BlacklistData): Set<string> {
    if (!data.pubkeys || data.pubkeys.length === 0) {
      return new Set();
    }
    return new Set(data.pubkeys);
  }

  /**
   * Sync blacklist data with relay storage
   * Call this on app initialization and after sign-in
   */
  async syncWithRelay(userPubkey: string, relays: string[]): Promise<boolean> {
    if (this.syncInProgress) {
      console.log('Blacklist sync already in progress');
      return false;
    }

    this.syncInProgress = true;

    try {
      // Load local data
      const localBlacklist = this.loadBlacklist();
      const localData = localBlacklist.size > 0
        ? this.toStorageFormat(localBlacklist)
        : null;

      // Sync with relay
      const syncResult = await syncData<BlacklistData>(
        D_TAGS.BLACKLIST,
        localData,
        userPubkey,
        relays
      );

      // Only update local storage if relay data is newer
      if (syncResult.source === 'relay' || syncResult.source === 'merged') {
        const syncedBlacklist = this.fromStorageFormat(syncResult.data);
        this.saveBlacklist(syncedBlacklist);
      }

      // If local was newer, publish to relay
      if (syncResult.needsPublish) {
        await publishAppData(
          D_TAGS.BLACKLIST,
          syncResult.data,
          userPubkey,
          relays,
          true // encrypted
        );
      }

      console.log(`Blacklist sync completed (source: ${syncResult.source})`);
      return true;
    } catch (error) {
      console.error('Failed to sync blacklist data:', error);
      return false;
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Publish current blacklist data to relay
   * Call this after adding/removing blacklisted pubkeys
   */
  async publishToRelay(userPubkey: string, relays: string[]): Promise<boolean> {
    try {
      const blacklist = this.loadBlacklist();
      const data = this.toStorageFormat(blacklist);

      await publishAppData(
        D_TAGS.BLACKLIST,
        data,
        userPubkey,
        relays,
        true // encrypted
      );

      console.log('Blacklist data published to relay');
      return true;
    } catch (error) {
      console.error('Failed to publish blacklist data:', error);
      return false;
    }
  }

  /**
   * Fetch latest blacklist data from relay
   * Useful for manual refresh
   */
  async fetchFromRelay(userPubkey: string, relays: string[]): Promise<Set<string>> {
    try {
      const data = await fetchAppData(
        D_TAGS.BLACKLIST,
        userPubkey,
        relays
      ) as BlacklistData | null;

      if (!data) {
        return new Set();
      }

      return this.fromStorageFormat(data);
    } catch (error) {
      console.error('Failed to fetch blacklist data from relay:', error);
      return new Set();
    }
  }
}

// Create singleton instance
export const blacklistService = new BlacklistService();
