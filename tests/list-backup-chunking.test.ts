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
 * Chunking test for list backup.
 *
 * Stubs out `@/lib/nostr` so `publishAppData` can run its real
 * compress + encrypt + sign pipeline without touching the network.
 * Captures the signed events so the test can assert:
 *   - correct number of chunks
 *   - correct d-tag per chunk
 *   - chunkIndex / totalChunks / kind inside each payload
 *   - content is present only on chunk 0
 *   - tags reassemble in order via fetchListBackupFromRelay
 */

const secretKey = generateSecretKey();
const userPubkey = getPublicKey(secretKey);
const testSigner = new NsecSigner(secretKey);

// Storage shared across mock boundaries
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

// Import under test after mocks are registered
import {
  saveListBackupToRelay,
  fetchListBackupFromRelay,
  APP_DATA_KIND,
  LIST_TAG_CHUNK_SIZE,
} from "@/lib/relayStorage";

const RELAYS = ["wss://relay.test"];

beforeEach(() => {
  eventsByDTag.clear();
});

describe("list backup chunking (kind 10003 bookmarks)", () => {
  it(
    "splits 1300 tags across 3 chunks with content only on chunk 0",
    async () => {
      // 1300 tags = ceil(1300 / 500) = 3 chunks
      const totalTagCount = 1300;
      const tags: string[][] = [];
      for (let i = 0; i < totalTagCount; i++) {
        tags.push(["e", `tag-${i}`.padEnd(64, "0")]);
      }
      // Ciphertext-like blob (opaque; chunk 0 only)
      const content = "ciphertext-blob-" + "x".repeat(2048);

      const result = await saveListBackupToRelay(
        10003,
        { tags, content },
        userPubkey,
        RELAYS,
        "unit test",
        testSigner,
      );

      expect(result.totalChunks).toBe(3);
      expect(result.savedChunks).toBe(3);

      // Verify event metadata (unencrypted) and d-tags.
      const dTags = Array.from(eventsByDTag.keys()).sort();
      expect(dTags).toEqual([
        "mutable:bookmarks-backup:0",
        "mutable:bookmarks-backup:1",
        "mutable:bookmarks-backup:2",
      ]);
      for (const event of eventsByDTag.values()) {
        expect(event.kind).toBe(APP_DATA_KIND);
        expect(event.pubkey).toBe(userPubkey);
        expect(event.tags.find((t) => t[0] === "encrypted")?.[1]).toBe("true");
        expect(event.tags.find((t) => t[0] === "enc")?.[1]).toBe("nip44");
      }

      // Reassemble via fetch — exercises decryption + decompression.
      const fetched = await fetchListBackupFromRelay(
        10003,
        userPubkey,
        RELAYS,
        1000,
        testSigner,
      );
      expect(fetched.backup).not.toBeNull();
      expect(fetched.backup!.totalChunks).toBe(3);
      expect(fetched.backup!.fetchedChunks).toBe(3);
      expect(fetched.backup!.kind).toBe(10003);
      expect(fetched.backup!.content).toBe(content);
      expect(fetched.backup!.tags).toEqual(tags);
    },
    30000,
  );

  it(
    "preserves tag order across chunks (first/last items of each slice)",
    async () => {
      const tags: string[][] = [];
      for (let i = 0; i < LIST_TAG_CHUNK_SIZE * 2 + 10; i++) {
        tags.push(["p", String(i)]);
      }

      await saveListBackupToRelay(
        10003,
        { tags, content: "" },
        userPubkey,
        RELAYS,
        undefined,
        testSigner,
      );

      const fetched = await fetchListBackupFromRelay(
        10003,
        userPubkey,
        RELAYS,
        1000,
        testSigner,
      );
      expect(fetched.backup).not.toBeNull();
      expect(fetched.backup!.tags).toHaveLength(tags.length);
      // Spot-check ordering at chunk boundaries
      expect(fetched.backup!.tags[0]).toEqual(["p", "0"]);
      expect(fetched.backup!.tags[LIST_TAG_CHUNK_SIZE - 1]).toEqual([
        "p",
        String(LIST_TAG_CHUNK_SIZE - 1),
      ]);
      expect(fetched.backup!.tags[LIST_TAG_CHUNK_SIZE]).toEqual([
        "p",
        String(LIST_TAG_CHUNK_SIZE),
      ]);
      expect(fetched.backup!.tags[tags.length - 1]).toEqual([
        "p",
        String(tags.length - 1),
      ]);
    },
    30000,
  );

  it(
    "single-chunk backup uses totalChunks=1",
    async () => {
      const tags = Array.from({ length: 5 }, (_, i) => ["t", `t${i}`]);
      const result = await saveListBackupToRelay(
        10003,
        { tags, content: "small-content" },
        userPubkey,
        RELAYS,
        undefined,
        testSigner,
      );
      expect(result.totalChunks).toBe(1);
      expect(eventsByDTag.size).toBe(1);
      expect(eventsByDTag.has("mutable:bookmarks-backup:0")).toBe(true);
    },
    15000,
  );

  it(
    "empty tag list still produces a single chunk with the content blob",
    async () => {
      const result = await saveListBackupToRelay(
        10003,
        { tags: [], content: "only-content" },
        userPubkey,
        RELAYS,
        undefined,
        testSigner,
      );
      expect(result.totalChunks).toBe(1);

      const fetched = await fetchListBackupFromRelay(
        10003,
        userPubkey,
        RELAYS,
        1000,
        testSigner,
      );
      expect(fetched.backup).not.toBeNull();
      expect(fetched.backup!.tags).toEqual([]);
      expect(fetched.backup!.content).toBe("only-content");
    },
    15000,
  );
});
