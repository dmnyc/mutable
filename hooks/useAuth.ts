import { useCallback, useEffect } from 'react';
import { useStore } from '@/lib/store';
import {
  hasNip07,
  getNip07Pubkey,
  getNip07Relays,
  fetchMuteList,
  parseMuteListEvent
} from '@/lib/nostr';
import { syncManager } from '@/lib/syncManager';
import { UserSession } from '@/types';

export function useAuth() {
  const {
    session,
    authState,
    setSession,
    setAuthState,
    setMuteList,
    setMuteListLoading,
    setMuteListError,
    clearSession
  } = useStore();

  // Connect with NIP-07
  const connectWithNip07 = useCallback(async () => {
    try {
      setAuthState('connecting');

      if (!hasNip07()) {
        throw new Error('No NIP-07 extension found. Please install Alby, nos2x, or another compatible extension.');
      }

      const pubkey = await getNip07Pubkey();
      // Use getBestRelayList to fetch from Nostr first, then fall back to NIP-07
      const { getBestRelayList } = await import('@/lib/nostr');
      const { relays, metadata } = await getBestRelayList(pubkey);

      const newSession: UserSession = {
        pubkey,
        relays,
        connected: true,
        signerType: 'nip07',
        relayListMetadata: metadata || undefined
      };

      setSession(newSession);
      setAuthState('connected');

      // Fetch user's mute list
      await loadMuteList(pubkey, relays);

      // Sync all app data with relay storage
      syncManager.syncAll(pubkey, relays).catch((error) => {
        console.error('Failed to sync app data with relays:', error);
        // Don't throw - sync errors shouldn't block login
      });

      return newSession;
    } catch (error) {
      setAuthState('error');
      throw error;
    }
  }, [setSession, setAuthState, setMuteList, setMuteListLoading, setMuteListError]);

  // Load mute list from Nostr
  const loadMuteList = useCallback(async (pubkey: string, relays: string[]) => {
    try {
      setMuteListLoading(true);
      setMuteListError(null);

      const event = await fetchMuteList(pubkey, relays);

      if (event) {
        const parsedList = await parseMuteListEvent(event);
        setMuteList(parsedList);
      } else {
        // No existing mute list, start with empty
        setMuteList({
          pubkeys: [],
          words: [],
          tags: [],
          threads: []
        });
      }
    } catch (error) {
      setMuteListError(error instanceof Error ? error.message : 'Failed to load mute list');
      throw error;
    } finally {
      setMuteListLoading(false);
    }
  }, [setMuteList, setMuteListLoading, setMuteListError]);

  // Disconnect
  const disconnect = useCallback(() => {
    clearSession();
  }, [clearSession]);

  // Reload mute list
  const reloadMuteList = useCallback(async () => {
    if (session) {
      await loadMuteList(session.pubkey, session.relays);
    }
  }, [session, loadMuteList]);

  // Auto-restore session on mount
  useEffect(() => {
    // If we have a persisted session but authState is disconnected,
    // restore the connection and refresh mute list
    if (session && authState === 'disconnected') {
      setAuthState('connected');
      // Refresh mute list to ensure we have latest data from relays
      loadMuteList(session.pubkey, session.relays);

      // Sync all app data with relay storage
      syncManager.syncAll(session.pubkey, session.relays).catch((error) => {
        console.error('Failed to sync app data with relays:', error);
      });
    }
  }, [session, authState, setAuthState, loadMuteList]);

  return {
    session,
    authState,
    isConnected: authState === 'connected',
    isConnecting: authState === 'connecting',
    hasNip07Extension: hasNip07(),
    connectWithNip07,
    disconnect,
    reloadMuteList
  };
}
