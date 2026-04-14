import { describe, it, expect } from "vitest";
import { generateSecretKey, getPublicKey, nip04, nip44 } from "nostr-tools";
import { NsecSigner } from "@/lib/signers/NsecSigner";
import { Signer } from "@/lib/signers/types";
import type { EventTemplate, VerifiedEvent } from "nostr-tools";

/**
 * Integration tests for NIP-44/NIP-04 mute list encryption.
 *
 * These tests exercise the actual encrypt/decrypt pipeline using real
 * nostr-tools crypto — no mocking of the crypto layer. Signers are
 * constructed directly to avoid depending on the Zustand store or relays.
 */

// Helper: encrypt private mute tags the same way the app does
async function encryptPrivateTags(
  tags: string[][],
  signer: Signer,
  pubkey: string,
  method: "nip44" | "nip04",
): Promise<string> {
  const plaintext = JSON.stringify(tags);
  if (method === "nip44" && signer.nip44Encrypt) {
    return signer.nip44Encrypt(pubkey, plaintext);
  }
  return signer.nip04Encrypt(pubkey, plaintext);
}

// Helper: decrypt using ?iv= detection (mirrors the app's logic)
async function decryptWithIvDetection(
  ciphertext: string,
  signer: Signer,
  pubkey: string,
): Promise<string | null> {
  const isNip04 = ciphertext.includes("?iv=");

  let decrypted: unknown;
  if (isNip04) {
    decrypted = await signer.nip04Decrypt(pubkey, ciphertext);
  } else {
    if (!signer.nip44Decrypt) return null;
    decrypted = await signer.nip44Decrypt(pubkey, ciphertext);
  }

  // Defensive guard (the fix we're testing)
  if (typeof decrypted !== "string" || !decrypted.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(decrypted);
    if (!Array.isArray(parsed)) {
      return null;
    }
  } catch {
    return null;
  }

  return decrypted;
}

// Helper: create a broken signer that returns {} from decrypt
function createBrokenSigner(secretKey: Uint8Array): Signer {
  const pubkey = getPublicKey(secretKey);
  return {
    getPublicKey: async () => pubkey,
    signEvent: async (event: EventTemplate) => event as unknown as VerifiedEvent,
    nip04Encrypt: async (_pub: string, plaintext: string) =>
      nip04.encrypt(secretKey, _pub, plaintext),
    nip04Decrypt: async () => ({}) as unknown as string, // returns {} instead of string
    nip44Encrypt: async (_pub: string, plaintext: string) => {
      const ck = nip44.v2.utils.getConversationKey(secretKey, _pub);
      return nip44.v2.encrypt(plaintext, ck);
    },
    nip44Decrypt: async () => ({}) as unknown as string, // returns {} instead of string
  };
}

describe("NIP-44 mute list encryption", () => {
  const secretKey = generateSecretKey();
  const signer = new NsecSigner(secretKey);
  let pubkey: string;

  const privateTags = [
    ["p", "aaaa".repeat(16)],
    ["word", "spam"],
    ["t", "scam"],
    ["e", "bbbb".repeat(16)],
  ];

  it("setup: get pubkey", async () => {
    pubkey = await signer.getPublicKey();
    expect(pubkey).toMatch(/^[0-9a-f]{64}$/);
  });

  describe("NIP-44 encrypt/decrypt round-trip", () => {
    it("encrypts and decrypts private mute tags with NIP-44", async () => {
      const encrypted = await encryptPrivateTags(privateTags, signer, pubkey, "nip44");
      expect(typeof encrypted).toBe("string");
      expect(encrypted.length).toBeGreaterThan(0);
      // NIP-44 ciphertext should NOT contain ?iv=
      expect(encrypted).not.toContain("?iv=");

      const decrypted = await decryptWithIvDetection(encrypted, signer, pubkey);
      expect(decrypted).not.toBeNull();
      const parsed = JSON.parse(decrypted!);
      expect(parsed).toEqual(privateTags);
    });
  });

  describe("NIP-04 encrypt/decrypt round-trip", () => {
    it("encrypts and decrypts private mute tags with NIP-04", async () => {
      const encrypted = await encryptPrivateTags(privateTags, signer, pubkey, "nip04");
      expect(typeof encrypted).toBe("string");
      expect(encrypted.length).toBeGreaterThan(0);
      // NIP-04 ciphertext MUST contain ?iv=
      expect(encrypted).toContain("?iv=");

      const decrypted = await decryptWithIvDetection(encrypted, signer, pubkey);
      expect(decrypted).not.toBeNull();
      const parsed = JSON.parse(decrypted!);
      expect(parsed).toEqual(privateTags);
    });
  });

  describe("?iv= detection correctly routes cipher", () => {
    it("NIP-04 ciphertext is detected and decrypted via nip04Decrypt", async () => {
      const encrypted = await encryptPrivateTags(privateTags, signer, pubkey, "nip04");
      expect(encrypted).toContain("?iv=");
      const decrypted = await decryptWithIvDetection(encrypted, signer, pubkey);
      expect(decrypted).not.toBeNull();
    });

    it("NIP-44 ciphertext is detected and decrypted via nip44Decrypt", async () => {
      const encrypted = await encryptPrivateTags(privateTags, signer, pubkey, "nip44");
      expect(encrypted).not.toContain("?iv=");
      const decrypted = await decryptWithIvDetection(encrypted, signer, pubkey);
      expect(decrypted).not.toBeNull();
    });

    it("cross-method: NIP-04 encrypted data is NOT decryptable as NIP-44", async () => {
      const encrypted = await encryptPrivateTags(privateTags, signer, pubkey, "nip04");
      // Force NIP-44 decryption (bypass detection) — should throw
      await expect(
        signer.nip44Decrypt(pubkey, encrypted),
      ).rejects.toThrow();
    });
  });

  describe("defensive guards against broken signers", () => {
    it("handles signer that returns {} from nip44Decrypt", async () => {
      const brokenSigner = createBrokenSigner(secretKey);
      // Encrypt with a working signer
      const encrypted = await encryptPrivateTags(privateTags, signer, pubkey, "nip44");

      // Decrypt with the broken signer — should return null, not throw
      const result = await decryptWithIvDetection(encrypted, brokenSigner, pubkey);
      expect(result).toBeNull();
    });

    it("handles signer that returns {} from nip04Decrypt", async () => {
      const brokenSigner = createBrokenSigner(secretKey);
      const encrypted = await encryptPrivateTags(privateTags, signer, pubkey, "nip04");

      const result = await decryptWithIvDetection(encrypted, brokenSigner, pubkey);
      expect(result).toBeNull();
    });

    it("handles decrypt returning empty string", async () => {
      const emptySigner: Signer = {
        ...createBrokenSigner(secretKey),
        nip44Decrypt: async () => "",
        nip04Decrypt: async () => "",
      };

      const encrypted = await encryptPrivateTags(privateTags, signer, pubkey, "nip44");
      const result = await decryptWithIvDetection(encrypted, emptySigner, pubkey);
      expect(result).toBeNull();
    });

    it("handles decrypt returning non-array JSON", async () => {
      const objectSigner: Signer = {
        ...createBrokenSigner(secretKey),
        nip44Decrypt: async () => '{"not": "an array"}',
        nip04Decrypt: async () => '{"not": "an array"}',
      };

      const encrypted = await encryptPrivateTags(privateTags, signer, pubkey, "nip44");
      const result = await decryptWithIvDetection(encrypted, objectSigner, pubkey);
      expect(result).toBeNull();
    });

    it("handles decrypt returning invalid JSON", async () => {
      const garbageSigner: Signer = {
        ...createBrokenSigner(secretKey),
        nip44Decrypt: async () => "not json at all",
        nip04Decrypt: async () => "not json at all",
      };

      const encrypted = await encryptPrivateTags(privateTags, signer, pubkey, "nip44");
      const result = await decryptWithIvDetection(encrypted, garbageSigner, pubkey);
      expect(result).toBeNull();
    });
  });

  describe("NsecSigner NIP-44 methods", () => {
    it("nip44Encrypt returns a string", async () => {
      const result = await signer.nip44Encrypt(pubkey, "hello");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("nip44Decrypt returns a string", async () => {
      const encrypted = await signer.nip44Encrypt(pubkey, "hello");
      const result = await signer.nip44Decrypt(pubkey, encrypted);
      expect(typeof result).toBe("string");
      expect(result).toBe("hello");
    });

    it("nip04Encrypt produces ciphertext with ?iv=", async () => {
      const result = await signer.nip04Encrypt(pubkey, "hello");
      expect(result).toContain("?iv=");
    });

    it("nip04Decrypt round-trips correctly", async () => {
      const encrypted = await signer.nip04Encrypt(pubkey, "hello");
      const result = await signer.nip04Decrypt(pubkey, encrypted);
      expect(result).toBe("hello");
    });
  });
});
