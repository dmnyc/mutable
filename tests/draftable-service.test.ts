import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event, EventTemplate } from "nostr-tools";

const nostr = vi.hoisted(() => ({
  fetchFollowList: vi.fn(),
  signEvent: vi.fn(),
  publishToRelays: vi.fn(),
  querySync: vi.fn(),
}));
const backups = vi.hoisted(() => ({
  saveBackup: vi.fn(),
  createFollowListBackup: vi.fn(
    (pubkey: string, follows: string[], notes?: string, eventId?: string) => ({
      pubkey,
      follows,
      notes,
      eventId,
    }),
  ),
}));

vi.mock("@/lib/nostr", () => ({
  fetchFollowList: nostr.fetchFollowList,
  signEvent: nostr.signEvent,
  publishToRelays: nostr.publishToRelays,
  getPool: () => ({ querySync: nostr.querySync }),
  getExpandedRelayList: (relays: string[]) => relays,
  normalizeRelayList: (relays: string[]) => relays,
}));
vi.mock("@/lib/backupService", () => ({ backupService: backups }));

import {
  MissingFollowListError,
  deletePack,
  fetchPack,
  fetchPacks,
  fetchPackPosts,
  followPubkeys,
  lookupPack,
  lookupPackWithHints,
  publishPack,
  unfollowPubkeys,
} from "@/lib/draftable/service";
import { DRAFTABLE_KIND } from "@/lib/draftable/pack";

const VIEWER = "f".repeat(64);
const A = "a".repeat(64);
const B = "b".repeat(64);
const RELAYS = ["wss://relay.example"];

function followEvent(tags: string[][], content = '{"wss://r":{}}'): Event {
  return {
    id: "1".repeat(64),
    pubkey: VIEWER,
    kind: 3,
    tags,
    content,
    created_at: 100,
    sig: "",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  nostr.signEvent.mockImplementation(async (template: EventTemplate) => ({
    ...template,
    id: "2".repeat(64),
    pubkey: VIEWER,
    sig: "",
  }));
  nostr.publishToRelays.mockResolvedValue(undefined);
});

describe("followPubkeys", () => {
  it("re-reads the follow list, backs it up, and appends", async () => {
    nostr.fetchFollowList.mockResolvedValue(
      followEvent([["p", A, "", "alice"], ["t", "nostr"]]),
    );

    const result = await followPubkeys(VIEWER, [A, B], RELAYS, {
      note: "test",
    });

    expect(result.changed).toEqual([B]);
    expect(Array.from(result.following)).toEqual([A, B]);
    expect(backups.createFollowListBackup).toHaveBeenCalledWith(
      VIEWER,
      [A],
      "test",
      "1".repeat(64),
    );
    expect(backups.saveBackup).toHaveBeenCalledTimes(1);

    const published = nostr.signEvent.mock.calls[0][0] as EventTemplate;
    expect(published.kind).toBe(3);
    expect(published.content).toBe('{"wss://r":{}}');
    expect(published.tags).toEqual([
      ["p", A, "", "alice"],
      ["t", "nostr"],
      ["p", B],
    ]);
    expect(nostr.publishToRelays).toHaveBeenCalledTimes(1);
  });

  it("refuses to publish over a follow list it couldn't find", async () => {
    nostr.fetchFollowList.mockResolvedValue(null);
    await expect(followPubkeys(VIEWER, [A], RELAYS)).rejects.toBeInstanceOf(
      MissingFollowListError,
    );
    expect(nostr.signEvent).not.toHaveBeenCalled();
  });

  it("starts a new list only when explicitly allowed", async () => {
    nostr.fetchFollowList.mockResolvedValue(null);
    const result = await followPubkeys(VIEWER, [A], RELAYS, {
      allowNewList: true,
    });
    expect(result.changed).toEqual([A]);
    expect(backups.saveBackup).not.toHaveBeenCalled();
    const published = nostr.signEvent.mock.calls[0][0] as EventTemplate;
    expect(published.tags).toEqual([["p", A]]);
    expect(published.content).toBe("");
  });

  it("publishes nothing when everyone is already followed", async () => {
    nostr.fetchFollowList.mockResolvedValue(followEvent([["p", A]]));
    const result = await followPubkeys(VIEWER, [A], RELAYS);
    expect(result.changed).toEqual([]);
    expect(nostr.signEvent).not.toHaveBeenCalled();
    expect(backups.saveBackup).not.toHaveBeenCalled();
  });
});

describe("unfollowPubkeys", () => {
  it("removes only the target and keeps the rest", async () => {
    nostr.fetchFollowList.mockResolvedValue(
      followEvent([["p", A], ["p", B], ["t", "nostr"]]),
    );
    const result = await unfollowPubkeys(VIEWER, [A], RELAYS);
    expect(result.changed).toEqual([A]);
    expect(backups.saveBackup).toHaveBeenCalledTimes(1);
    const published = nostr.signEvent.mock.calls[0][0] as EventTemplate;
    expect(published.tags).toEqual([["p", B], ["t", "nostr"]]);
  });

  it("never publishes when the follow list is missing", async () => {
    nostr.fetchFollowList.mockResolvedValue(null);
    await expect(unfollowPubkeys(VIEWER, [A], RELAYS)).rejects.toBeInstanceOf(
      MissingFollowListError,
    );
    expect(nostr.signEvent).not.toHaveBeenCalled();
  });
});

describe("packs", () => {
  it("publishes a kind:39089 pack and serves it back before relays catch up", async () => {
    const pack = await publishPack(
      { dTag: "fresh", name: "Fresh", members: [{ pubkey: A }] },
      RELAYS,
    );
    expect(pack).toMatchObject({ dTag: "fresh", author: VIEWER, name: "Fresh" });
    const published = nostr.signEvent.mock.calls[0][0] as EventTemplate;
    expect(published.kind).toBe(DRAFTABLE_KIND);

    nostr.querySync.mockResolvedValue([]);
    expect(await fetchPack("fresh", VIEWER, RELAYS)).toMatchObject({
      name: "Fresh",
    });
  });

  it("sends a NIP-09 deletion with e, a and k tags", async () => {
    const pack = await publishPack(
      { dTag: "doomed", name: "Doomed", members: [{ pubkey: A }] },
      RELAYS,
    );
    nostr.signEvent.mockClear();
    await deletePack(pack, RELAYS);
    const deletion = nostr.signEvent.mock.calls[0][0] as EventTemplate;
    expect(deletion.kind).toBe(5);
    expect(deletion.tags).toEqual([
      ["e", pack.eventId],
      ["a", `${DRAFTABLE_KIND}:${VIEWER}:doomed`],
      ["k", String(DRAFTABLE_KIND)],
    ]);
    nostr.querySync.mockResolvedValue([]);
    expect(await fetchPack("doomed", VIEWER, RELAYS)).toBeNull();
  });

  it("splits long author lists across queries", async () => {
    nostr.querySync.mockResolvedValue([]);
    const authors = Array.from({ length: 600 }, (_, i) =>
      i.toString(16).padStart(64, "0"),
    );
    await fetchPacks({ authors }, RELAYS);
    expect(nostr.querySync).toHaveBeenCalledTimes(3);
    for (const [, filter] of nostr.querySync.mock.calls) {
      expect(filter.authors.length).toBeLessThanOrEqual(250);
      expect(filter.kinds).toEqual([DRAFTABLE_KIND]);
    }
  });

  it("queries packs someone was drafted into by #p", async () => {
    nostr.querySync.mockResolvedValue([]);
    await fetchPacks({ drafted: A, until: 500 }, RELAYS);
    expect(nostr.querySync.mock.calls[0][1]).toMatchObject({
      kinds: [DRAFTABLE_KIND],
      "#p": [A],
      until: 500,
    });
  });
});

// A relay that answers like a real one: filter, newest first, honor `until`
// (inclusive) and `limit`. Keyed by relay URL so tests can split who has what.
function emulateRelays(byRelay: Record<string, Event[]>) {
  nostr.querySync.mockImplementation(
    async (
      relays: string[],
      filter: {
        kinds?: number[];
        "#d"?: string[];
        authors?: string[];
        until?: number;
        limit?: number;
      },
    ) => {
      const seen = new Map<string, Event>();
      for (const relay of relays) {
        for (const event of byRelay[relay] ?? []) seen.set(event.id, event);
      }
      return [...seen.values()]
        .filter(
          (e) =>
            (!filter.kinds || filter.kinds.includes(e.kind)) &&
            (!filter["#d"] ||
              filter["#d"].includes(
                e.tags.find((t) => t[0] === "d")?.[1] ?? "",
              )) &&
            (!filter.authors || filter.authors.includes(e.pubkey)) &&
            (filter.until === undefined || e.created_at <= filter.until),
        )
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, filter.limit ?? Infinity);
    },
  );
}

function packEventFor(author: string, dTag: string, createdAt: number): Event {
  return {
    id: `${author.slice(0, 8)}${dTag}${createdAt}`
      .replace(/[^0-9a-f]/g, "0")
      .padEnd(64, "0")
      .slice(0, 64),
    pubkey: author,
    kind: DRAFTABLE_KIND,
    created_at: createdAt,
    content: "",
    sig: "",
    tags: [
      ["d", dTag],
      ["title", `Pack by ${author.slice(0, 4)}`],
      ["p", A],
    ],
  };
}

describe("lookupPack: what a link points to", () => {
  const REAL = "ee6ea13ab9fe5c4a" + "0".repeat(48);
  // Shares REAL's first 8 characters (an old link's whole prefix), not 16.
  const LOOKALIKE = "ee6ea13a" + "f".repeat(56);

  it("finds the pack from a full key, a 16-character prefix, or an old 8-character one", async () => {
    emulateRelays({ r: [packEventFor(REAL, "pack", 100)] });
    for (const author of [REAL, REAL.slice(0, 16), REAL.slice(0, 8)]) {
      const result = await lookupPack("pack", author, ["r"]);
      expect(result.status).toBe("found");
    }
    expect((await lookupPack("pack", "dead".repeat(2), ["r"])).status).toBe(
      "missing",
    );
  });

  it("asks instead of picking when an old prefix matches two authors", async () => {
    emulateRelays({
      r: [
        packEventFor(REAL, "pack", 100),
        packEventFor(LOOKALIKE, "pack", 900),
      ],
    });
    const old = await lookupPack("pack", REAL.slice(0, 8), ["r"]);
    expect(old.status).toBe("ambiguous");
    if (old.status === "ambiguous") {
      // The newer, look-alike pack is listed first but is not chosen for you.
      expect(old.packs.map((p) => p.author)).toEqual([LOOKALIKE, REAL]);
    }
    // The longer prefix and the full key still land on the real pack.
    for (const author of [REAL.slice(0, 16), REAL]) {
      const result = await lookupPack("pack", author, ["r"]);
      expect(result.status === "found" && result.pack.author).toBe(REAL);
    }
  });

  it("is ambiguous with no author when several authors use the ID", async () => {
    emulateRelays({
      r: [
        packEventFor(REAL, "pack", 100),
        packEventFor(LOOKALIKE, "pack", 900),
      ],
    });
    expect((await lookupPack("pack", undefined, ["r"])).status).toBe(
      "ambiguous",
    );
  });

  it("finds the real pack under a flood of newer packs with the same ID", async () => {
    const flood = Array.from({ length: 600 }, (_, i) =>
      packEventFor(i.toString(16).padStart(64, "1"), "popular", 1_000 + i),
    );
    emulateRelays({ r: [packEventFor(REAL, "popular", 10), ...flood] });
    const result = await lookupPack("popular", REAL.slice(0, 16), ["r"]);
    expect(result.status === "found" && result.pack.author).toBe(REAL);
    expect(nostr.querySync.mock.calls.length).toBeGreaterThan(1); // it paged
  });
});

describe("lookupPackWithHints: hints are a fallback", () => {
  const AUTH = "aa".repeat(32);
  const usual = ["wss://usual.example"];
  const hint = ["wss://hint.example"];

  it("never asks the hinted relays when the usual ones have the pack", async () => {
    emulateRelays({
      [usual[0]]: [packEventFor(AUTH, "here", 5)],
      [hint[0]]: [],
    });
    const result = await lookupPackWithHints("here", AUTH, usual, hint);
    expect(result.status).toBe("found");
    const asked = nostr.querySync.mock.calls.flatMap(
      (call) => call[0] as string[],
    );
    expect(asked).not.toContain(hint[0]);
  });

  it("tries only the hinted relays when the usual ones come up empty", async () => {
    emulateRelays({
      [usual[0]]: [],
      [hint[0]]: [packEventFor(AUTH, "away", 5)],
    });
    const result = await lookupPackWithHints("away", AUTH, usual, hint);
    expect(result.status).toBe("found");
    expect(nostr.querySync.mock.calls.at(-1)?.[0]).toEqual(hint);
  });

  it("makes one pass when there are no hints", async () => {
    emulateRelays({ [usual[0]]: [] });
    expect((await lookupPackWithHints("none", AUTH, usual, [])).status).toBe(
      "missing",
    );
    expect(nostr.querySync).toHaveBeenCalledTimes(1);
  });
});

describe("fetchPackPosts", () => {
  const note = (id: string, createdAt: number, tags: string[][]): Event => ({
    id: id.repeat(64).slice(0, 64),
    pubkey: A,
    kind: 1,
    created_at: createdAt,
    content: `note ${id}`,
    sig: "",
    tags,
  });

  it("drops replies and keeps top-level notes, even ones that mention another note", async () => {
    const target = "9".repeat(64);
    emulateRelays({
      r: [
        note("1", 100, []),
        note("2", 200, [["e", target, "", "reply"]]),
        note("3", 300, [["e", target]]), // unmarked: an older-style reply
        note("4", 400, [["e", target, "", "mention"]]), // cites a note
        note("5", 500, [["q", target]]),
      ],
    });
    const posts = await fetchPackPosts([A], ["r"]);
    expect(posts.map((p) => p.content)).toEqual(["note 5", "note 4", "note 1"]);
  });
});
