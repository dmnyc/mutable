import { useCallback, useEffect, useRef } from "react";
import { useStore, Nip46SessionData } from "@/lib/store";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import {
  hasNip07,
  getNip07Pubkey,
  fetchMuteList,
  parseMuteListEvent,
  fetchProfile,
  getBestRelayList,
} from "@/lib/nostr";
import { Nip07Signer, Nip46Signer } from "@/lib/signers";
import { syncManager } from "@/lib/syncManager";
import { UserSession } from "@/types";

// Store for active nostrconnect sessions (used for cleanup)
interface NostrConnectSession {
  uri: string;
  secretKey: Uint8Array;
  secret: string;
  cancelled: boolean;
}

export function useAuth() {
  const {
    session,
    authState,
    signer,
    nip46Session,
    setSession,
    setAuthState,
    setUserProfile,
    setSigner,
    setNip46Session,
    setMuteList,
    setMuteListLoading,
    setMuteListError,
    clearSession,
  } = useStore();

  // Track active nostrconnect session for cleanup
  const nostrConnectSessionRef = useRef<NostrConnectSession | null>(null);

  // Connect with NIP-07
  const connectWithNip07 = useCallback(async () => {
    try {
      setAuthState("connecting");

      if (!hasNip07()) {
        throw new Error(
          "No NIP-07 extension found. Please install Alby, nos2x, or another compatible extension.",
        );
      }

      // Create NIP-07 signer and set it in the store
      const nip07Signer = new Nip07Signer();
      setSigner(nip07Signer);

      const pubkey = await nip07Signer.getPublicKey();
      const { relays, metadata } = await getBestRelayList(pubkey);

      const newSession: UserSession = {
        pubkey,
        relays,
        connected: true,
        signerType: "nip07",
        relayListMetadata: metadata || undefined,
      };

      setSession(newSession);
      setAuthState("connected");

      // Fetch and cache user profile (don't block on failure)
      fetchProfile(pubkey, relays)
        .then((profile) => {
          if (profile) {
            setUserProfile(profile);
          }
        })
        .catch((error) => {
          console.error("Failed to fetch user profile:", error);
        });

      // Fetch user's mute list
      await loadMuteList(pubkey, relays);

      // Sync all app data with relay storage
      syncManager.syncAll(pubkey, relays).catch((error) => {
        console.error("Failed to sync app data with relays:", error);
      });

      return newSession;
    } catch (error) {
      setAuthState("error");
      setSigner(null);
      throw error;
    }
  }, [
    setSession,
    setAuthState,
    setSigner,
    setMuteList,
    setMuteListLoading,
    setMuteListError,
  ]);

  // Connect with NIP-46 (remote signer / bunker)
  const connectWithNip46 = useCallback(
    async (bunkerInput: string, onAuthUrl?: (url: string) => void) => {
      try {
        setAuthState("connecting");

        // Connect to the bunker
        const nip46Signer = await Nip46Signer.connect(
          bunkerInput,
          undefined,
          onAuthUrl,
        );
        setSigner(nip46Signer);

        // Get the user's public key from the remote signer
        const pubkey = await nip46Signer.getPublicKey();
        const { relays, metadata } = await getBestRelayList(pubkey);

        const newSession: UserSession = {
          pubkey,
          relays,
          connected: true,
          signerType: "nip46",
          relayListMetadata: metadata || undefined,
        };

        // Store NIP-46 session data for restoration
        const nip46Data: Nip46SessionData = {
          bunkerPointer: nip46Signer.getBunkerPointer(),
          clientSecretKey: bytesToHex(nip46Signer.getClientSecretKey()),
        };
        setNip46Session(nip46Data);

        setSession(newSession);
        setAuthState("connected");

        // Fetch and cache user profile (don't block on failure)
        fetchProfile(pubkey, relays)
          .then((profile) => {
            if (profile) {
              setUserProfile(profile);
            }
          })
          .catch((error) => {
            console.error("Failed to fetch user profile:", error);
          });

        // Fetch user's mute list
        await loadMuteList(pubkey, relays);

        // Sync all app data with relay storage
        syncManager.syncAll(pubkey, relays).catch((error) => {
          console.error("Failed to sync app data with relays:", error);
        });

        return newSession;
      } catch (error) {
        setAuthState("error");
        setSigner(null);
        setNip46Session(null);
        throw error;
      }
    },
    [
      setSession,
      setAuthState,
      setSigner,
      setNip46Session,
      setMuteList,
      setMuteListLoading,
      setMuteListError,
    ],
  );

  // Generate nostrconnect:// URI for QR code (client-initiated NIP-46)
  const generateNostrConnectURI = useCallback(() => {
    const connectData = Nip46Signer.generateNostrConnectURI();
    nostrConnectSessionRef.current = {
      ...connectData,
      cancelled: false,
    };
    return connectData.uri;
  }, []);

  // Wait for remote signer to connect after scanning QR code
  const waitForNostrConnect = useCallback(
    async (onAuthUrl?: (url: string) => void) => {
      const connectSession = nostrConnectSessionRef.current;
      if (!connectSession) {
        throw new Error(
          "No nostrconnect session active. Call generateNostrConnectURI first.",
        );
      }

      try {
        setAuthState("connecting");

        // Wait for remote signer to respond (60 second timeout)
        const nip46Signer = await Nip46Signer.connectFromURI(
          connectSession.uri,
          connectSession.secretKey,
          onAuthUrl,
          60000,
        );

        // Check if cancelled during connection
        if (connectSession.cancelled) {
          await nip46Signer.close();
          throw new Error("Connection cancelled");
        }

        setSigner(nip46Signer);

        // Get the user's public key from the remote signer
        const pubkey = await nip46Signer.getPublicKey();
        const { relays, metadata } = await getBestRelayList(pubkey);

        const newSession: UserSession = {
          pubkey,
          relays,
          connected: true,
          signerType: "nip46",
          relayListMetadata: metadata || undefined,
        };

        // Store NIP-46 session data for restoration
        const nip46Data: Nip46SessionData = {
          bunkerPointer: nip46Signer.getBunkerPointer(),
          clientSecretKey: bytesToHex(nip46Signer.getClientSecretKey()),
        };
        setNip46Session(nip46Data);

        setSession(newSession);
        setAuthState("connected");

        // Clear the connect session ref
        nostrConnectSessionRef.current = null;

        // Fetch and cache user profile (don't block on failure)
        fetchProfile(pubkey, relays)
          .then((profile) => {
            if (profile) {
              setUserProfile(profile);
            }
          })
          .catch((error) => {
            console.error("Failed to fetch user profile:", error);
          });

        // Fetch user's mute list
        await loadMuteList(pubkey, relays);

        // Sync all app data with relay storage
        syncManager.syncAll(pubkey, relays).catch((error) => {
          console.error("Failed to sync app data with relays:", error);
        });

        return newSession;
      } catch (error) {
        setAuthState("error");
        setSigner(null);
        setNip46Session(null);
        nostrConnectSessionRef.current = null;
        throw error;
      }
    },
    [
      setSession,
      setAuthState,
      setUserProfile,
      setSigner,
      setNip46Session,
      setMuteList,
      setMuteListLoading,
      setMuteListError,
    ],
  );

  // Cancel an active nostrconnect session
  const cancelNostrConnect = useCallback(() => {
    if (nostrConnectSessionRef.current) {
      nostrConnectSessionRef.current.cancelled = true;
      nostrConnectSessionRef.current = null;
    }
    setAuthState("disconnected");
  }, [setAuthState]);

  // Load mute list from Nostr
  const loadMuteList = useCallback(
    async (pubkey: string, relays: string[]) => {
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
            threads: [],
          });
        }
      } catch (error) {
        setMuteListError(
          error instanceof Error ? error.message : "Failed to load mute list",
        );
        throw error;
      } finally {
        setMuteListLoading(false);
      }
    },
    [setMuteList, setMuteListLoading, setMuteListError],
  );

  // Disconnect
  const disconnect = useCallback(async () => {
    // Close NIP-46 connection if active
    if (signer && session?.signerType === "nip46") {
      try {
        await (signer as Nip46Signer).close();
      } catch (error) {
        console.error("Error closing NIP-46 connection:", error);
      }
    }
    clearSession();
  }, [signer, session, clearSession]);

  // Reload mute list
  const reloadMuteList = useCallback(async () => {
    if (session) {
      await loadMuteList(session.pubkey, session.relays);
    }
  }, [session, loadMuteList]);

  // Restore signer on session restore
  const restoreSigner = useCallback(async () => {
    if (!session || signer) return;

    try {
      if (session.signerType === "nip07") {
        // Restore NIP-07 signer
        if (hasNip07()) {
          const nip07Signer = new Nip07Signer();
          setSigner(nip07Signer);
        } else {
          console.warn("NIP-07 extension not available, cannot restore signer");
          // Don't clear session - user might install extension
        }
      } else if (session.signerType === "nip46" && nip46Session) {
        // Restore NIP-46 signer
        const nip46Signer = await Nip46Signer.restore(
          nip46Session.bunkerPointer,
          hexToBytes(nip46Session.clientSecretKey),
        );
        setSigner(nip46Signer);
      }
    } catch (error) {
      console.error("Failed to restore signer:", error);
      // Clear session if we can't restore the signer
      clearSession();
    }
  }, [session, signer, nip46Session, setSigner, clearSession]);

  // Auto-restore session and signer on mount
  useEffect(() => {
    if (session && authState === "disconnected") {
      setAuthState("connected");

      // Restore signer if needed
      restoreSigner();

      // Refresh mute list to ensure we have latest data from relays
      loadMuteList(session.pubkey, session.relays);

      // Sync all app data with relay storage
      syncManager.syncAll(session.pubkey, session.relays).catch((error) => {
        console.error("Failed to sync app data with relays:", error);
      });
    }
  }, [session, authState, setAuthState, loadMuteList, restoreSigner]);

  return {
    session,
    authState,
    isConnected: authState === "connected",
    isConnecting: authState === "connecting",
    hasNip07Extension: hasNip07(),
    connectWithNip07,
    connectWithNip46,
    generateNostrConnectURI,
    waitForNostrConnect,
    cancelNostrConnect,
    disconnect,
    reloadMuteList,
  };
}
