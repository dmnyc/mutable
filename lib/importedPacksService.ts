// Imported Packs Service
// Manages tracking of imported pack items to prevent duplicate imports
// Now with relay storage support for multi-device sync

import {
  publishAppData,
  fetchAppData,
  syncData,
  D_TAGS,
  type ImportedPacksData,
} from './relayStorage';

// Type for imported packs tracking
export type ImportedPacks = Record<string, Set<string>>; // packId -> Set of imported item values

class ImportedPacksService {
  private storageKey = 'mutable-imported-packs';
  private syncInProgress = false;

  /**
   * Load imported packs from localStorage
   * Note: This reads from Zustand persist storage
   */
  loadImportedPacks(): ImportedPacks {
    if (typeof window === 'undefined') return {};

    try {
      const zustandStorage = localStorage.getItem('mutable-storage');
      if (!zustandStorage) return {};

      const parsed = JSON.parse(zustandStorage);
      if (!parsed.state?.importedPackItems) return {};

      // Convert serialized data back to Sets
      const importedPacks: ImportedPacks = {};
      for (const [packId, items] of Object.entries(parsed.state.importedPackItems)) {
        if (Array.isArray(items)) {
          importedPacks[packId] = new Set(items);
        }
      }

      return importedPacks;
    } catch (error) {
      console.error('Failed to load imported packs from localStorage:', error);
      return {};
    }
  }

  /**
   * Save imported packs to localStorage
   * Note: This updates Zustand persist storage
   */
  private saveImportedPacks(importedPacks: ImportedPacks): boolean {
    if (typeof window === 'undefined') return false;

    try {
      const zustandStorage = localStorage.getItem('mutable-storage');
      if (!zustandStorage) return false;

      const parsed = JSON.parse(zustandStorage);
      parsed.state = parsed.state || {};

      // Convert Sets to arrays for JSON serialization
      const serialized: Record<string, string[]> = {};
      for (const [packId, items] of Object.entries(importedPacks)) {
        serialized[packId] = Array.from(items);
      }

      parsed.state.importedPackItems = serialized;
      localStorage.setItem('mutable-storage', JSON.stringify(parsed));

      return true;
    } catch (error) {
      console.error('Failed to save imported packs to localStorage:', error);
      return false;
    }
  }

  /**
   * Get imported count for a specific pack
   */
  getImportedCount(packId: string): number {
    const importedPacks = this.loadImportedPacks();
    return importedPacks[packId]?.size || 0;
  }

  /**
   * Mark items as imported for a pack
   */
  markPackItemsAsImported(packId: string, items: string[]): boolean {
    const importedPacks = this.loadImportedPacks();

    if (!importedPacks[packId]) {
      importedPacks[packId] = new Set();
    }

    items.forEach(item => importedPacks[packId].add(item));

    return this.saveImportedPacks(importedPacks);
  }

  /**
   * Check if an item has been imported from a pack
   */
  isItemImported(packId: string, itemValue: string): boolean {
    const importedPacks = this.loadImportedPacks();
    return importedPacks[packId]?.has(itemValue) || false;
  }

  /**
   * Clear imported items for a specific pack
   */
  clearPackImports(packId: string): boolean {
    const importedPacks = this.loadImportedPacks();
    delete importedPacks[packId];
    return this.saveImportedPacks(importedPacks);
  }

  /**
   * Clear all imported packs data
   */
  clearAllImports(): boolean {
    return this.saveImportedPacks({});
  }

  /**
   * Convert ImportedPacks to ImportedPacksData format
   */
  private toStorageFormat(importedPacks: ImportedPacks): ImportedPacksData {
    const packs: ImportedPacksData['packs'] = {};

    for (const [packId, items] of Object.entries(importedPacks)) {
      packs[packId] = {
        importedAt: Date.now(), // Use current time as approximation
        itemsImported: items.size,
      };
    }

    return {
      version: 1,
      timestamp: Date.now(),
      packs,
    };
  }

  /**
   * Convert ImportedPacksData to ImportedPacks format
   * Note: This only tracks which packs have been imported, not individual items
   * For full functionality, we need to store the actual item values
   */
  private fromStorageFormat(data: ImportedPacksData): ImportedPacks {
    const importedPacks: ImportedPacks = {};

    for (const [packId, packInfo] of Object.entries(data.packs)) {
      // Create empty set since we don't have individual item data
      // This is a limitation of the current format - consider enhancing
      importedPacks[packId] = new Set();
    }

    return importedPacks;
  }

  /**
   * Sync imported packs data with relay storage
   * Call this on app initialization and after sign-in
   */
  async syncWithRelay(userPubkey: string, relays: string[]): Promise<boolean> {
    if (this.syncInProgress) {
      console.log('Imported packs sync already in progress');
      return false;
    }

    this.syncInProgress = true;

    try {
      // Load local data
      const localImportedPacks = this.loadImportedPacks();
      const localData = Object.keys(localImportedPacks).length > 0
        ? this.toStorageFormat(localImportedPacks)
        : null;

      // Sync with relay
      const syncResult = await syncData<ImportedPacksData>(
        D_TAGS.IMPORTED_PACKS,
        localData,
        userPubkey,
        relays
      );

      // Note: We intentionally don't update local storage from relay since we don't store
      // individual item values in the relay format. This is a simplification for the initial
      // implementation. The relay storage only tracks which packs have been imported, not
      // the individual items within those packs. If relay data is needed, it will only
      // show pack IDs without item details.

      // If local was newer, publish to relay
      if (syncResult.needsPublish) {
        await publishAppData(
          D_TAGS.IMPORTED_PACKS,
          syncResult.data,
          userPubkey,
          relays,
          false // not encrypted (tracking data is not sensitive)
        );
      }

      console.log(`Imported packs sync completed (source: ${syncResult.source})`);
      return true;
    } catch (error) {
      console.error('Failed to sync imported packs data:', error);
      return false;
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Publish current imported packs data to relay
   * Call this after importing from a pack
   */
  async publishToRelay(userPubkey: string, relays: string[]): Promise<boolean> {
    try {
      const importedPacks = this.loadImportedPacks();
      const data = this.toStorageFormat(importedPacks);

      await publishAppData(
        D_TAGS.IMPORTED_PACKS,
        data,
        userPubkey,
        relays,
        false // not encrypted (tracking data is not sensitive)
      );

      console.log('Imported packs data published to relay');
      return true;
    } catch (error) {
      console.error('Failed to publish imported packs data:', error);
      return false;
    }
  }

  /**
   * Fetch latest imported packs data from relay
   * Useful for manual refresh
   */
  async fetchFromRelay(userPubkey: string, relays: string[]): Promise<ImportedPacks> {
    try {
      const data = await fetchAppData(
        D_TAGS.IMPORTED_PACKS,
        userPubkey,
        relays
      ) as ImportedPacksData | null;

      if (!data) {
        return {};
      }

      return this.fromStorageFormat(data);
    } catch (error) {
      console.error('Failed to fetch imported packs data from relay:', error);
      return {};
    }
  }
}

// Create singleton instance
export const importedPacksService = new ImportedPacksService();
