import { EventTemplate, VerifiedEvent } from "nostr-tools";

/**
 * Extended Signer interface that includes NIP-04 encryption methods
 * needed for private mute list encryption.
 */
export interface Signer {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<VerifiedEvent>;
  nip04Encrypt(pubkey: string, plaintext: string): Promise<string>;
  nip04Decrypt(pubkey: string, ciphertext: string): Promise<string>;
}

export type SignerType = "nip07" | "nip46";
