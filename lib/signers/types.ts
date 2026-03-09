import { EventTemplate, VerifiedEvent } from "nostr-tools";

/**
 * Extended Signer interface that includes encryption methods
 * needed for private mute list and relay storage encryption.
 *
 * NIP-04 methods are required (used for kind 10000 private mute lists).
 * NIP-44 methods are optional but preferred for relay storage (NIP-78)
 * because some NIP-46 bunkers don't grant nip04_decrypt permission.
 */
export interface Signer {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<VerifiedEvent>;
  nip04Encrypt(pubkey: string, plaintext: string): Promise<string>;
  nip04Decrypt(pubkey: string, ciphertext: string): Promise<string>;
  nip44Encrypt?(pubkey: string, plaintext: string): Promise<string>;
  nip44Decrypt?(pubkey: string, ciphertext: string): Promise<string>;
}

export type SignerType = "nip07" | "nip46";
