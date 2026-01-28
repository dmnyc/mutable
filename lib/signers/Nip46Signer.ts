import { EventTemplate, VerifiedEvent, getPublicKey } from "nostr-tools";
import {
  BunkerSigner,
  parseBunkerInput,
  BunkerPointer,
  BunkerSignerParams,
  createNostrConnectURI,
} from "nostr-tools/nip46";
import { generateSecretKey } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils";
import { Signer } from "./types";
import { DEFAULT_RELAYS } from "../nostr";

export type { BunkerPointer };

/**
 * NIP-46 Signer implementation that wraps nostr-tools BunkerSigner
 */
export class Nip46Signer implements Signer {
  private bunkerSigner: BunkerSigner;
  private clientSecretKey: Uint8Array;
  private bunkerPointer: BunkerPointer;

  private constructor(
    bunkerSigner: BunkerSigner,
    clientSecretKey: Uint8Array,
    bunkerPointer: BunkerPointer,
  ) {
    this.bunkerSigner = bunkerSigner;
    this.clientSecretKey = clientSecretKey;
    this.bunkerPointer = bunkerPointer;
  }

  /**
   * Create a NIP-46 signer from a bunker URL or NIP-05 identifier (bunker-initiated flow)
   * @param input - bunker:// URL or user@domain.com NIP-05 identifier
   * @param clientSecretKey - Optional client secret key (will generate one if not provided)
   * @param onauth - Optional callback for auth challenges (e.g., to open a popup)
   */
  static async connect(
    input: string,
    clientSecretKey?: Uint8Array,
    onauth?: (url: string) => void,
  ): Promise<Nip46Signer> {
    // Parse the bunker input (supports bunker:// URLs and NIP-05)
    const bunkerPointer = await parseBunkerInput(input);
    if (!bunkerPointer) {
      throw new Error("Invalid bunker URL or NIP-05 identifier");
    }

    // Generate or use provided client secret key
    const secretKey = clientSecretKey || generateSecretKey();

    // Create BunkerSigner params
    const params: BunkerSignerParams = {};
    if (onauth) {
      params.onauth = onauth;
    }

    // Create the BunkerSigner
    const bunkerSigner = BunkerSigner.fromBunker(
      secretKey,
      bunkerPointer,
      params,
    );

    // Connect to the bunker
    await bunkerSigner.connect();

    return new Nip46Signer(bunkerSigner, secretKey, bunkerPointer);
  }

  /**
   * Generate a nostrconnect:// URI for client-initiated connection (e.g., for QR code scanning)
   * Returns the URI and the client secret key needed to complete the connection
   */
  static generateNostrConnectURI(clientSecretKey?: Uint8Array): {
    uri: string;
    secretKey: Uint8Array;
    secret: string;
  } {
    const secretKey = clientSecretKey || generateSecretKey();
    const clientPubkey = getPublicKey(secretKey);
    const secret = bytesToHex(generateSecretKey()).substring(0, 16); // Random secret for verification

    const uri = createNostrConnectURI({
      clientPubkey,
      relays: DEFAULT_RELAYS.slice(0, 3), // Use first 3 default relays
      secret,
      name: "Mutable",
      url:
        typeof window !== "undefined"
          ? window.location.origin
          : "https://mutable.top",
    });

    return { uri, secretKey, secret };
  }

  /**
   * Connect using the client-initiated nostrconnect:// flow
   * Call this after the remote signer scans the QR code and responds
   * @param uri - The nostrconnect:// URI that was displayed as QR code
   * @param clientSecretKey - The client secret key used to generate the URI
   * @param onauth - Optional callback for auth challenges
   * @param maxWait - Maximum time to wait for connection (ms), default 60000
   */
  static async connectFromURI(
    uri: string,
    clientSecretKey: Uint8Array,
    onauth?: (url: string) => void,
    maxWait: number = 60000,
  ): Promise<Nip46Signer> {
    const params: BunkerSignerParams = {};
    if (onauth) {
      params.onauth = onauth;
    }

    // Use nostr-tools' fromURI which waits for the signer to respond
    const bunkerSigner = await BunkerSigner.fromURI(
      clientSecretKey,
      uri,
      params,
      maxWait,
    );

    // Get the bunker pointer from the signer
    const bunkerPointer = bunkerSigner.bp;

    return new Nip46Signer(bunkerSigner, clientSecretKey, bunkerPointer);
  }

  /**
   * Get the user's public key from the remote signer
   */
  async getPublicKey(): Promise<string> {
    return await this.bunkerSigner.getPublicKey();
  }

  /**
   * Sign an event using the remote signer
   */
  async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    return await this.bunkerSigner.signEvent(event);
  }

  /**
   * Encrypt a message using NIP-04 via the remote signer
   */
  async nip04Encrypt(pubkey: string, plaintext: string): Promise<string> {
    return await this.bunkerSigner.nip04Encrypt(pubkey, plaintext);
  }

  /**
   * Decrypt a message using NIP-04 via the remote signer
   */
  async nip04Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    return await this.bunkerSigner.nip04Decrypt(pubkey, ciphertext);
  }

  /**
   * Close the connection to the bunker
   */
  async close(): Promise<void> {
    await this.bunkerSigner.close();
  }

  /**
   * Get the client secret key (for session restoration)
   */
  getClientSecretKey(): Uint8Array {
    return this.clientSecretKey;
  }

  /**
   * Get the bunker pointer (for session restoration)
   */
  getBunkerPointer(): BunkerPointer {
    return this.bunkerPointer;
  }

  /**
   * Restore a NIP-46 signer from saved session data
   * Does NOT send a new connect request - the remote signer should remember our client keypair
   * and respond to subsequent requests (sign_event, get_public_key, etc.)
   * @param bunkerPointer - The bunker pointer from a previous session
   * @param clientSecretKey - The client secret key from a previous session
   * @param onauth - Optional callback for auth challenges
   */
  static async restore(
    bunkerPointer: BunkerPointer,
    clientSecretKey: Uint8Array,
    onauth?: (url: string) => void,
  ): Promise<Nip46Signer> {
    const params: BunkerSignerParams = {};
    if (onauth) {
      params.onauth = onauth;
    }

    const bunkerSigner = BunkerSigner.fromBunker(
      clientSecretKey,
      bunkerPointer,
      params,
    );

    // Don't call connect() - the remote signer remembers our client keypair
    // and will respond to requests. Sending connect with a new secret would fail
    // for signers like Primal that reject reconnection attempts with new secrets.
    // Just verify connectivity with a ping instead.
    try {
      await bunkerSigner.ping();
    } catch {
      // If ping fails, the connection may still work - some signers don't implement ping
      // We'll find out when we try to sign something
      console.warn(
        "NIP-46 ping failed during restore, connection may still work",
      );
    }

    return new Nip46Signer(bunkerSigner, clientSecretKey, bunkerPointer);
  }
}
