import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  naSuggest,
  naMetadata,
  naEvents,
  naCountEvents,
  isNostrArchivesAvailable,
  resetNostrArchivesCooldown,
} from "@/lib/nostrArchives";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return {
    ok: (init?.status ?? 200) < 400,
    status: init?.status ?? 200,
    headers: { get: (k: string) => init?.headers?.[k] ?? null },
    json: async () => body,
  } as unknown as Response;
}

describe("nostrArchives client", () => {
  beforeEach(() => {
    resetNostrArchivesCooldown();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetNostrArchivesCooldown();
  });

  describe("naSuggest", () => {
    it("ignores queries shorter than two characters without calling the API", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      expect(await naSuggest("a")).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("normalizes suggestions and drops malformed entries", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          jsonResponse({
            suggestions: [
              { pubkey: HEX_A.toUpperCase(), name: "alice", follower_count: 12 },
              { pubkey: "not-a-pubkey", name: "bogus" },
              { name: "missing pubkey" },
            ],
          }),
        ),
      );

      const out = await naSuggest("alice");
      expect(out).toHaveLength(1);
      expect(out[0].pubkey).toBe(HEX_A); // lowercased
      expect(out[0].follower_count).toBe(12);
    });

    it("returns empty on a non-ok response rather than throwing", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, { status: 500 })));
      await expect(naSuggest("alice")).resolves.toEqual([]);
    });

    it("returns empty when fetch rejects", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => {
        throw new Error("network down");
      }));
      await expect(naSuggest("alice")).resolves.toEqual([]);
    });
  });

  describe("rate limiting", () => {
    it("enters a cooldown on 429 and short-circuits later calls", async () => {
      const fetchMock = vi.fn(async () =>
        jsonResponse({}, { status: 429, headers: { "Retry-After": "120" } }),
      );
      vi.stubGlobal("fetch", fetchMock);

      expect(isNostrArchivesAvailable()).toBe(true);
      await naSuggest("alice");
      expect(isNostrArchivesAvailable()).toBe(false);

      // A second call must not hit the network while cooling down.
      await naSuggest("bob");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("applies a default cooldown when Retry-After is absent", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, { status: 429 })));
      await naSuggest("alice");
      expect(isNostrArchivesAvailable()).toBe(false);
    });
  });

  describe("naMetadata", () => {
    it("skips the request entirely for an empty list", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      expect(await naMetadata([])).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("deduplicates and filters invalid pubkeys before sending", async () => {
      const fetchMock = vi.fn(async (..._args: unknown[]) =>
        jsonResponse({ profiles: [] }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await naMetadata([HEX_A, HEX_A.toUpperCase(), "nope", HEX_B]);

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body.pubkeys).toEqual([HEX_A, HEX_B]);
    });
  });

  describe("naEvents", () => {
    it("sends the singular `pubkey` param, not `authors`", async () => {
      // The API silently ignores `authors` and returns unrelated events, so
      // this guards against regressing to NIP-01 naming.
      const fetchMock = vi.fn(async (..._args: unknown[]) =>
        jsonResponse({ events: [] }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await naEvents({ pubkey: HEX_A, kind: 1, limit: 10 });

      const url = String(fetchMock.mock.calls[0][0]);
      expect(url).toContain(`pubkey=${HEX_A}`);
      expect(url).not.toContain("authors=");
      expect(url).toContain("kind=1");
    });

    it("rejects a malformed pubkey without calling the API", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      expect(await naEvents({ pubkey: "bad" })).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("reads tags from the nested raw event when absent at top level", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          jsonResponse({
            events: [
              {
                id: HEX_A,
                pubkey: HEX_B,
                kind: 1,
                created_at: 1700000000,
                content: "hi",
                raw: { tags: [["client", "Mutable"]] },
              },
            ],
          }),
        ),
      );

      const out = await naEvents({ pubkey: HEX_B });
      expect(out).toHaveLength(1);
      expect(out[0].tags).toEqual([["client", "Mutable"]]);
    });
  });

  describe("naCountEvents", () => {
    it("returns null when the archive has nothing, so callers fall back", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ events: [] })));
      expect(await naCountEvents(HEX_A, 1)).toBeNull();
    });

    it("counts unique event ids and flags when the cap is reached", async () => {
      const events = [
        { id: HEX_A, pubkey: HEX_B, kind: 1, created_at: 1, content: "", tags: [] },
        { id: HEX_A, pubkey: HEX_B, kind: 1, created_at: 2, content: "", tags: [] }, // dupe
        { id: HEX_B, pubkey: HEX_B, kind: 1, created_at: 3, content: "", tags: [] },
      ];
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ events })));

      const uncapped = await naCountEvents(HEX_B, 1, 10);
      expect(uncapped).toEqual({ count: 2, isCapped: false });

      const capped = await naCountEvents(HEX_B, 1, 2);
      expect(capped).toEqual({ count: 2, isCapped: true });
    });
  });
});
