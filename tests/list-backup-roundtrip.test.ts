import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  Event,
  EventTemplate,
  Filter,
} from "nostr-tools";
import { NsecSigner } from "@/lib/signers/NsecSigner";

/**
 * Byte-for-byte roundtrip test for list backup (bookmarks / pinned notes /
 * interests).
 *
 * Sends a raw NIP-51 event shape (tags + encrypted content blob) through
 * `saveListBackupToRelay` → `fetchListBackupFromRelay` with the real
 * compress + encrypt pipeline. Verifies tags and content survive unchanged.
 */

const secretKey = generateSecretKey();
const userPubkey = getPublicKey(secretKey);
const testSigner = new NsecSigner(secretKey);

const eventsByDTag = new Map<string, Event>();

vi.mock("@/lib/store", () => ({
  useStore: {
    getState: () => ({ session: null }),
  },
}));

vi.mock("@/lib/nostr", () => {
  type Handlers = {
    onevent?: (e: Event) => void;
    oneose?: () => void;
  };
  return {
    getPool: () => ({
      publish: (relays: string[], event: Event) => {
        const dTag = event.tags.find((t) => t[0] === "d")?.[1];
        if (dTag) eventsByDTag.set(dTag, event);
        return relays.map(() => Promise.resolve());
      },
      subscribeMany: (_relays: string[], filter: Filter, handlers: Handlers) => {
        const dTags = (filter["#d"] as string[] | undefined) || [];
        const authors = (filter.authors as string[] | undefined) || [];
        queueMicrotask(() => {
          for (const dTag of dTags) {
            const event = eventsByDTag.get(dTag);
            if (event && (authors.length === 0 || authors.includes(event.pubkey))) {
              handlers.onevent?.(event);
            }
          }
          handlers.oneose?.();
        });
        return { close: () => {} };
      },
    }),
    getExpandedRelayList: (relays: string[]) => relays,
    getSigner: () => testSigner,
    signEvent: async (template: EventTemplate) =>
      finalizeEvent(template, secretKey),
    DEFAULT_RELAYS: ["wss://relay.test"],
  };
});

import {
  saveListBackupToRelay,
  fetchListBackupFromRelay,
} from "@/lib/relayStorage";

const RELAYS = ["wss://relay.test"];

beforeEach(() => {
  eventsByDTag.clear();
});

async function makeEncryptedContent(plaintext: string): Promise<string> {
  // Mirrors what a real NIP-51 private-item list would store: opaque
  // NIP-44 ciphertext that Mutable must never try to decrypt.
  return testSigner.nip44Encrypt!(userPubkey, plaintext);
}

describe("list backup byte-for-byte roundtrip", () => {
  it.each([
    { kind: 10003, label: "bookmarks" },
    { kind: 10001, label: "pinned notes" },
    { kind: 10015, label: "interests" },
  ])(
    "roundtrips tags and ciphertext content for $label (kind $kind)",
    async ({ kind }) => {
      const tags: string[][] = [
        ["e", "a".repeat(64)],
        ["e", "b".repeat(64), "wss://relay.example"],
        ["a", "30023:abcd:post-1"],
        ["t", "nostr"],
        ["r", "https://example.com/article"],
      ];
      // Pretend this is NIP-51 private items encrypted by the source client.
      const content = await makeEncryptedContent(
        JSON.stringify([
          ["e", "c".repeat(64)],
          ["t", "secret-tag"],
        ]),
      );

      const saveResult = await saveListBackupToRelay(
        kind,
        { tags, content },
        userPubkey,
        RELAYS,
        `roundtrip-${kind}`,
        testSigner,
      );
      expect(saveResult.savedChunks).toBe(saveResult.totalChunks);

      const fetched = await fetchListBackupFromRelay(
        kind,
        userPubkey,
        RELAYS,
        1000,
        testSigner,
      );
      expect(fetched.backup).not.toBeNull();
      expect(fetched.backup!.kind).toBe(kind);
      // Byte-for-byte equality: we never touched the ciphertext.
      expect(fetched.backup!.content).toBe(content);
      expect(fetched.backup!.tags).toEqual(tags);
      expect(fetched.backup!.notes).toBe(`roundtrip-${kind}`);
    },
    15000,
  );

  it(
    "rejects unsupported list kinds",
    async () => {
      await expect(
        saveListBackupToRelay(
          99999,
          { tags: [], content: "" },
          userPubkey,
          RELAYS,
          undefined,
          testSigner,
        ),
      ).rejects.toThrow(/Unsupported list backup kind/);

      await expect(
        fetchListBackupFromRelay(99999, userPubkey, RELAYS, 1000, testSigner),
      ).rejects.toThrow(/Unsupported list backup kind/);
    },
    5000,
  );

  it(
    "returns backup=null when no chunk 0 is present on any relay",
    async () => {
      const fetched = await fetchListBackupFromRelay(
        10003,
        userPubkey,
        RELAYS,
        500,
        testSigner,
      );
      expect(fetched.backup).toBeNull();
      expect(fetched.foundOnRelays).toEqual([]);
    },
    5000,
  );
});
