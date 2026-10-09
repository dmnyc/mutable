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
  followPubkeys,
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
