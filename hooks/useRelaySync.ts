/**
 * useRelaySync Hook
 *
 * Provides methods to interact with relay-synced services
 * that automatically publish changes to relays.
 */

import { useCallback } from 'react';
import { useStore } from '@/lib/store';
import { protectionService } from '@/lib/protectionService';
import { blacklistService } from '@/lib/blacklistService';
import { preferencesService } from '@/lib/preferencesService';
import { importedPacksService } from '@/lib/importedPacksService';
import { syncManager } from '@/lib/syncManager';

export function useRelaySync() {
  const { session } = useStore();

  /**
   * Add a user to the protected list and sync to relay
   */
  const addProtection = useCallback(
    async (pubkey: string, note?: string): Promise<boolean> => {
      const success = protectionService.addProtection(pubkey, note);

      if (success && session) {
        // Fire-and-forget publish
        syncManager
          .publishService('protected-users', session.pubkey, session.relays)
          .catch((error) => console.error('Failed to publish protection:', error));
      }

      return success;
    },
    [session]
  );

  /**
   * Remove a user from the protected list and sync to relay
   */
  const removeProtection = useCallback(
    async (pubkey: string): Promise<boolean> => {
      const success = protectionService.removeProtection(pubkey);

      if (success && session) {
        // Fire-and-forget publish
        syncManager
          .publishService('protected-users', session.pubkey, session.relays)
          .catch((error) => console.error('Failed to publish protection:', error));
      }

      return success;
    },
    [session]
  );

  /**
   * Add a pubkey to the blacklist and sync to relay
   */
  const addToBlacklist = useCallback(
    async (pubkey: string): Promise<boolean> => {
      const success = blacklistService.addToBlacklist(pubkey);

      if (success && session) {
        // Fire-and-forget publish
        syncManager
          .publishService('blacklist', session.pubkey, session.relays)
          .catch((error) => console.error('Failed to publish blacklist:', error));
      }

      return success;
    },
    [session]
  );

  /**
   * Remove a pubkey from the blacklist and sync to relay
   */
  const removeFromBlacklist = useCallback(
    async (pubkey: string): Promise<boolean> => {
      const success = blacklistService.removeFromBlacklist(pubkey);

      if (success && session) {
        // Fire-and-forget publish
        syncManager
          .publishService('blacklist', session.pubkey, session.relays)
          .catch((error) => console.error('Failed to publish blacklist:', error));
      }

      return success;
    },
    [session]
  );

  /**
   * Update a preference and sync to relay
   */
  const setPreference = useCallback(
    async (key: string, value: unknown): Promise<boolean> => {
      const success = preferencesService.setPreference(key, value);

      if (success && session) {
        // Fire-and-forget publish
        syncManager
          .publishService('preferences', session.pubkey, session.relays)
          .catch((error) => console.error('Failed to publish preferences:', error));
      }

      return success;
    },
    [session]
  );

  /**
   * Mark pack items as imported and sync to relay
   */
  const markPackItemsAsImported = useCallback(
    async (packId: string, items: string[]): Promise<boolean> => {
      const success = importedPacksService.markPackItemsAsImported(packId, items);

      if (success && session) {
        // Fire-and-forget publish
        syncManager
          .publishService('imported-packs', session.pubkey, session.relays)
          .catch((error) => console.error('Failed to publish imported packs:', error));
      }

      return success;
    },
    [session]
  );

  /**
   * Manually trigger a full sync
   */
  const triggerSync = useCallback(async () => {
    if (!session) {
      console.warn('Cannot sync: no active session');
      return null;
    }

    return await syncManager.syncAll(session.pubkey, session.relays);
  }, [session]);

  /**
   * Get current sync status
   */
  const getSyncStatus = useCallback(() => {
    return syncManager.getStatus();
  }, []);

  return {
    addProtection,
    removeProtection,
    addToBlacklist,
    removeFromBlacklist,
    setPreference,
    markPackItemsAsImported,
    triggerSync,
    getSyncStatus,
    isOnline: !!session,
  };
}
