import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event, Filter } from "nostr-tools";

// A relay pool that answers from a fixed set of kind:3 follow lists.
const followLists = new Map<string, string[]>();
const queriedRelays: string[][] = [];

vi.mock("nostr-tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("nostr-tools")>();
  class FakePool {
    async querySync(relays: string[], filter: Filter): Promise<Event[]> {
      queriedRelays.push(relays);
      if (!filter.kinds?.includes(3)) return [];
      return (filter.authors ?? []).flatMap((author) => {
        const follows = followLists.get(author);
        if (!follows) return [];
        return [
          {
            id: author.slice(0, 64),
            pubkey: author,
            kind: 3,
            created_at: 1,
            content: "",
            sig: "",
            tags: follows.map((pk) => ["p", pk]),
          } as Event,
        ];
      });
    }
  }
  return { ...actual, SimplePool: FakePool };
});

const { checkReciprocalFollows, FollowListUnavailableError } =
  await import("@/lib/nostr");

const ME = "a".repeat(64);
const FAN = "b".repeat(64); // follows me back
const STRANGER = "c".repeat(64); // doesn't

describe("checkReciprocalFollows", () => {
  beforeEach(() => {
    followLists.clear();
    queriedRelays.length = 0;
  });

  it("throws when the user's own follow list can't be found", async () => {
    await expect(
      checkReciprocalFollows(ME, ["wss://only.example"]),
    ).rejects.toBeInstanceOf(FollowListUnavailableError);
    // It asked more than the user's own relay, and tried twice.
    expect(queriedRelays.length).toBe(2);
    expect(queriedRelays[0].length).toBeGreaterThan(1);
  }, 10_000);

  it("reports zero follows instead of 'everyone follows back'", async () => {
    followLists.set(ME, []);
    expect(await checkReciprocalFollows(ME, ["wss://only.example"])).toEqual({
      nonReciprocal: [],
      followCount: 0,
    });
  }, 10_000);

  it("returns who doesn't follow back, with the follow count", async () => {
    followLists.set(ME, [FAN, STRANGER, FAN]);
    followLists.set(FAN, [ME]);
    followLists.set(STRANGER, []);
    expect(await checkReciprocalFollows(ME, ["wss://only.example"])).toEqual({
      nonReciprocal: [STRANGER],
      followCount: 2,
    });
  }, 10_000);
});
