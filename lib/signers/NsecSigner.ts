import {
  EventTemplate,
  VerifiedEvent,
  getPublicKey,
  finalizeEvent,
  nip04,
  nip19,
  nip44,
} from "nostr-tools";
import { Signer } from "./types";

/**
 * Ephemeral signer that wraps a raw secret key (nsec).
 * Used only temporarily during clone operations to decrypt
 * private data from a source account. Never persisted.
 */
export class NsecSigner implements Signer {
  private secretKey: Uint8Array;

  constructor(secretKey: Uint8Array) {
    this.secretKey = secretKey;
  }

  /**
   * Create an NsecSigner from an nsec1... bech32 string
   */
  static fromNsec(nsec: string): NsecSigner {
    const decoded = nip19.decode(nsec);
    if (decoded.type !== "nsec") {
      throw new Error("Invalid nsec string");
    }
    return new NsecSigner(decoded.data);
  }

  async getPublicKey(): Promise<string> {
    return getPublicKey(this.secretKey);
  }

  async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    return finalizeEvent(event, this.secretKey);
  }

  async nip04Encrypt(pubkey: string, plaintext: string): Promise<string> {
    return nip04.encrypt(this.secretKey, pubkey, plaintext);
  }

  async nip04Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    return nip04.decrypt(this.secretKey, pubkey, ciphertext);
  }

  async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    const conversationKey = nip44.v2.utils.getConversationKey(
      this.secretKey,
      pubkey,
    );
    return nip44.v2.encrypt(plaintext, conversationKey);
  }

  async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    const conversationKey = nip44.v2.utils.getConversationKey(
      this.secretKey,
      pubkey,
    );
    return nip44.v2.decrypt(ciphertext, conversationKey);
  }

  /**
   * Zero out the secret key from memory.
   * Call this when the clone operation is complete.
   */
  destroy(): void {
    this.secretKey.fill(0);
  }
}
