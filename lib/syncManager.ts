/**
 * Sync Manager
 *
 * Coordinates synchronization of all app data with relay storage.
 * Call syncAll() on app initialization and after sign-in to ensure
 * data consistency across devices.
 */

import { protectionService } from './protectionService';
import { blacklistService } from './blacklistService';
import { preferencesService } from './preferencesService';
import { importedPacksService } from './importedPacksService';

export interface SyncStatus {
  inProgress: boolean;
  lastSyncTime: number | null;
  errors: string[];
  syncedServices: string[];
}

class SyncManager {
  private syncStatus: SyncStatus = {
    inProgress: false,
    lastSyncTime: null,
    errors: [],
    syncedServices: [],
  };

  private statusChangeListeners: Array<(status: SyncStatus) => void> = [];

  /**
   * Register a listener for sync status changes
   */
  onStatusChange(listener: (status: SyncStatus) => void): () => void {
    this.statusChangeListeners.push(listener);
    // Return unsubscribe function
    return () => {
      const index = this.statusChangeListeners.indexOf(listener);
      if (index > -1) {
        this.statusChangeListeners.splice(index, 1);
      }
    };
  }

  /**
   * Notify all listeners of status change
   */
  private notifyStatusChange(): void {
    this.statusChangeListeners.forEach(listener => {
      listener({ ...this.syncStatus });
    });
  }

  /**
   * Get current sync status
   */
  getStatus(): SyncStatus {
    return { ...this.syncStatus };
  }

  /**
   * Sync all services with relay storage
   * This should be called on app initialization and after sign-in
   */
  async syncAll(userPubkey: string, relays: string[]): Promise<SyncStatus> {
    if (this.syncStatus.inProgress) {
      console.log('Sync already in progress');
      return this.getStatus();
    }

    this.syncStatus = {
      inProgress: true,
      lastSyncTime: null,
      errors: [],
      syncedServices: [],
    };
    this.notifyStatusChange();

    console.log('Starting relay storage sync for all services...');

    const services = [
      {
        name: 'Protected Users',
        syncFn: () => protectionService.syncWithRelay(userPubkey, relays),
      },
      {
        name: 'Blacklist',
        syncFn: () => blacklistService.syncWithRelay(userPubkey, relays),
      },
      {
        name: 'Preferences',
        syncFn: () => preferencesService.syncWithRelay(userPubkey, relays),
      },
      {
        name: 'Imported Packs',
        syncFn: () => importedPacksService.syncWithRelay(userPubkey, relays),
      },
    ];

    // Sync all services in parallel
    const results = await Promise.allSettled(
      services.map(async (service) => {
        try {
          const success = await service.syncFn();
          if (success) {
            this.syncStatus.syncedServices.push(service.name);
            console.log(`✓ ${service.name} synced successfully`);
          } else {
            throw new Error(`Failed to sync ${service.name}`);
          }
        } catch (error) {
          const errorMsg = `${service.name}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          this.syncStatus.errors.push(errorMsg);
          console.error(`✗ ${errorMsg}`);
          throw error;
        }
      })
    );

    this.syncStatus.inProgress = false;
    this.syncStatus.lastSyncTime = Date.now();

    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failCount = results.filter(r => r.status === 'rejected').length;

    console.log(
      `Relay storage sync completed: ${successCount} succeeded, ${failCount} failed`
    );

    this.notifyStatusChange();
    return this.getStatus();
  }

  /**
   * Publish a specific service's data to relay
   * Call this after making changes to ensure they're synced
   */
  async publishService(
    serviceName: 'protected-users' | 'blacklist' | 'preferences' | 'imported-packs',
    userPubkey: string,
    relays: string[]
  ): Promise<boolean> {
    try {
      switch (serviceName) {
        case 'protected-users':
          return await protectionService.publishToRelay(userPubkey, relays);
        case 'blacklist':
          return await blacklistService.publishToRelay(userPubkey, relays);
        case 'preferences':
          return await preferencesService.publishToRelay(userPubkey, relays);
        case 'imported-packs':
          return await importedPacksService.publishToRelay(userPubkey, relays);
        default:
          console.error(`Unknown service: ${serviceName}`);
          return false;
      }
    } catch (error) {
      console.error(`Failed to publish ${serviceName}:`, error);
      return false;
    }
  }

  /**
   * Fetch latest data from relay for all services
   * Useful for manual refresh/pull operation
   */
  async fetchAll(userPubkey: string, relays: string[]): Promise<{
    protectedUsers: Awaited<ReturnType<typeof protectionService.fetchFromRelay>>;
    blacklist: Awaited<ReturnType<typeof blacklistService.fetchFromRelay>>;
    preferences: Awaited<ReturnType<typeof preferencesService.fetchFromRelay>>;
    importedPacks: Awaited<ReturnType<typeof importedPacksService.fetchFromRelay>>;
  }> {
    const [protectedUsers, blacklist, preferences, importedPacks] = await Promise.all([
      protectionService.fetchFromRelay(userPubkey, relays),
      blacklistService.fetchFromRelay(userPubkey, relays),
      preferencesService.fetchFromRelay(userPubkey, relays),
      importedPacksService.fetchFromRelay(userPubkey, relays),
    ]);

    return {
      protectedUsers,
      blacklist,
      preferences,
      importedPacks,
    };
  }
}

// Create singleton instance
export const syncManager = new SyncManager();
