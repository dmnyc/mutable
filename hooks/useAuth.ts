import { useCallback, useEffect } from 'react';
import { useStore } from '@/lib/store';
import {
  hasNip07,
  getNip07Pubkey,
  getNip07Relays,
  fetchMuteList,
  parseMuteListEvent
} from '@/lib/nostr';
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
      const relays = await getNip07Relays();

      const newSession: UserSession = {
        pubkey,
        relays,
        connected: true,
        signerType: 'nip07'
      };

      setSession(newSession);
      setAuthState('connected');

      // Fetch user's mute list
      await loadMuteList(pubkey, relays);

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
        const parsedList = parseMuteListEvent(event);
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
