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
// Relays carried in the nostrconnect:// URI, which the remote signer must reach
// to answer us. Free to write to for an unknown (fresh) client key, and
// including Primal's own relay. Not the first of DEFAULT_RELAYS: those include
// payment-gated relays that refuse writes from a key they've never seen.
export const NOSTRCONNECT_RELAYS = [
  "wss://relay.primal.net",
  "wss://relay.damus.io",
  "wss://nos.lol",
];

// How long to wait for the signer to approve. Switching apps to approve can
// take a while, so this is generous.
export const NOSTRCONNECT_WAIT_MS = 120000;

/** A message to show for a failed nostrconnect wait, with the likely fix. */
export function describeNostrConnectError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out/i.test(message)) {
    return "No signer responded in time. On an iPhone, switching apps to approve can pause this page, so the reply never arrives. Scan the QR code from another device, or use Paste Bunker URL instead.";
  }
  if (/subscription closed/i.test(message)) {
    return "The connection to the relay dropped before your signer responded. If you switched apps to approve, the browser may have paused this page. Scan the QR code from another device, or use Paste Bunker URL instead.";
  }
  return message || "Failed to connect to remote signer";
}

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
      relays: NOSTRCONNECT_RELAYS,
      secret,
      name: "Mutable",
      url:
        typeof window !== "undefined"
          ? window.location.origin
          : "https://mutable.top",
      // Signers show this on the approval screen. A localhost origin isn't
      // reachable from the signer's device, so use the production logo there.
      image:
        typeof window !== "undefined" &&
        !/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
          ? `${window.location.origin}/mutable_logo_transparent.png`
          : "https://mutable.top/mutable_logo_transparent.png",
    });

    return { uri, secretKey, secret };
  }

  /**
   * Connect using the client-initiated nostrconnect:// flow
   * Call this after the remote signer scans the QR code and responds
   * @param uri - The nostrconnect:// URI that was displayed as QR code
   * @param clientSecretKey - The client secret key used to generate the URI
   * @param onauth - Optional callback for auth challenges
   * @param maxWait - Maximum time to wait for connection (ms), default 120000
   */
  static async connectFromURI(
    uri: string,
    clientSecretKey: Uint8Array,
    onauth?: (url: string) => void,
    maxWait: number = NOSTRCONNECT_WAIT_MS,
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
   * Encrypt a message using NIP-44 via the remote signer
   */
  async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    return await this.bunkerSigner.nip44Encrypt(pubkey, plaintext);
  }

  /**
   * Decrypt a message using NIP-44 via the remote signer
   */
  async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    return await this.bunkerSigner.nip44Decrypt(pubkey, ciphertext);
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
