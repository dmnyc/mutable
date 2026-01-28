import { EventTemplate, VerifiedEvent } from "nostr-tools";
import { Signer } from "./types";

interface WindowWithNostr extends Window {
  nostr?: {
    getPublicKey(): Promise<string>;
    signEvent(event: EventTemplate): Promise<VerifiedEvent>;
    getRelays?(): Promise<{ [url: string]: { read: boolean; write: boolean } }>;
    nip04?: {
      encrypt(pubkey: string, plaintext: string): Promise<string>;
      decrypt(pubkey: string, ciphertext: string): Promise<string>;
    };
  };
}

declare const window: WindowWithNostr;

/**
 * Check if NIP-07 extension is available in the browser
 */
export function hasNip07(): boolean {
  return typeof window !== "undefined" && window.nostr !== undefined;
}

/**
 * NIP-07 Signer implementation that wraps browser extension signing
 */
export class Nip07Signer implements Signer {
  async getPublicKey(): Promise<string> {
    if (!hasNip07() || !window.nostr) {
      throw new Error("NIP-07 extension not found");
    }
    return await window.nostr.getPublicKey();
  }

  async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    if (!hasNip07() || !window.nostr) {
      throw new Error("NIP-07 extension not found");
    }
    return await window.nostr.signEvent(event) as VerifiedEvent;
  }

  async nip04Encrypt(pubkey: string, plaintext: string): Promise<string> {
    if (!hasNip07() || !window.nostr?.nip04) {
      throw new Error("NIP-07 extension or nip04 methods not available");
    }
    return await window.nostr.nip04.encrypt(pubkey, plaintext);
  }

  async nip04Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    if (!hasNip07() || !window.nostr?.nip04) {
      throw new Error("NIP-07 extension or nip04 methods not available");
    }
    return await window.nostr.nip04.decrypt(pubkey, ciphertext);
  }

  /**
   * Get relays from NIP-07 extension (optional method, not part of Signer interface)
   */
  async getRelays(): Promise<{ [url: string]: { read: boolean; write: boolean } } | null> {
    if (!hasNip07() || !window.nostr?.getRelays) {
      return null;
    }
    try {
      return await window.nostr.getRelays();
    } catch {
      return null;
    }
  }
}
