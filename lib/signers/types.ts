import { EventTemplate, VerifiedEvent } from "nostr-tools";

/**
 * Extended Signer interface that includes encryption methods
 * needed for private mute list and relay storage encryption.
 *
 * NIP-04 methods are required as a fallback for legacy data.
 * NIP-44 methods are optional but preferred for both kind 10000 private
 * mute lists (per NIP-51) and relay storage (NIP-78). NIP-44 is also
 * better supported by NIP-46 bunkers which may deny nip04 permissions.
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
