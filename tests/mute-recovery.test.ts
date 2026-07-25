import { describe, it, expect } from "vitest";
import { Event } from "nostr-tools";
import {
  rankMuteListCandidates,
  pickRecommendedMuteRecovery,
  MuteListCandidate,
} from "@/lib/muteRecovery";

function makeCandidate(
  id: string,
  createdAt: number,
  mutedPubkeys: string[],
  options: { hasPrivateContent?: boolean; privateDecrypted?: boolean; privateCount?: number } = {},
): MuteListCandidate {
  const publicCount = mutedPubkeys.length;
  const privateCount = options.privateCount ?? 0;
  return {
    event: {
      id,
      pubkey: "author",
      kind: 10000,
      created_at: createdAt,
      tags: mutedPubkeys.map((p) => ["p", p]),
      content: options.hasPrivateContent ? "ciphertext" : "",
      sig: "sig",
    } as Event,
    eventId: id,
    createdAt,
    publicCount,
    privateCount,
    totalCount: publicCount + privateCount,
    hasPrivateContent: options.hasPrivateContent ?? false,
    privateDecrypted: options.privateDecrypted ?? !options.hasPrivateContent,
    foundOnRelays: [],
    isCurrent: false,
    isRecommended: false,
  };
}

describe("rankMuteListCandidates", () => {
  it("sorts by total count descending", () => {
    const c1 = makeCandidate("a", 1000, ["x", "y"]);
    const c2 = makeCandidate("b", 1000, ["x", "y", "z", "w"]);
    const c3 = makeCandidate("c", 1000, ["x"]);

    const ranked = rankMuteListCandidates([c1, c2, c3]);
    expect(ranked.map((c) => c.eventId)).toEqual(["b", "a", "c"]);
  });

  it("breaks total-count ties with most-recent created_at", () => {
    const older = makeCandidate("older", 1000, ["x", "y", "z"]);
    const newer = makeCandidate("newer", 2000, ["x", "y", "z"]);
    const oldest = makeCandidate("oldest", 500, ["x", "y", "z"]);

    const ranked = rankMuteListCandidates([older, newer, oldest]);
    expect(ranked.map((c) => c.eventId)).toEqual(["newer", "older", "oldest"]);
  });

  it("ranks largest first even when an older version is bigger than a newer wipe", () => {
    const wipe = makeCandidate("wipe", 5000, []);
    const big = makeCandidate("big", 3000, ["a", "b", "c", "d", "e"]);
    const small = makeCandidate("small", 4000, ["a", "b"]);

    const ranked = rankMuteListCandidates([wipe, big, small]);
    expect(ranked[0].eventId).toBe("big");
  });

  it("counts private items toward the total when decrypted", () => {
    const publicOnly = makeCandidate("public", 3000, ["a", "b", "c"]);
    const withPrivate = makeCandidate("private", 2000, ["a"], {
      hasPrivateContent: true,
      privateDecrypted: true,
      privateCount: 5,
    });

    const ranked = rankMuteListCandidates([publicOnly, withPrivate]);
    expect(ranked[0].eventId).toBe("private");
  });
});

describe("pickRecommendedMuteRecovery", () => {
  it("returns null when current is already the largest", () => {
    const current = makeCandidate("c", 5000, ["a", "b", "c", "d"]);
    const older = makeCandidate("o", 3000, ["a", "b"]);
    const recommendation = pickRecommendedMuteRecovery([current, older], current);
    expect(recommendation).toBeNull();
  });

  it("recommends a strictly larger older version when current is a wipe", () => {
    const wipe = makeCandidate("wipe", 5000, []);
    const big = makeCandidate("big", 3000, ["a", "b", "c", "d", "e"]);
    const recommendation = pickRecommendedMuteRecovery([wipe, big], wipe);
    expect(recommendation?.eventId).toBe("big");
  });

  it("does not recommend the current event itself", () => {
    const current = makeCandidate("c", 5000, ["a", "b", "c"]);
    const recommendation = pickRecommendedMuteRecovery([current], current);
    expect(recommendation).toBeNull();
  });

  it("filters tombstones (zero items) out of recommendations", () => {
    const current = makeCandidate("c", 5000, ["a"]);
    const tombstone = makeCandidate("t", 4000, []);
    const recommendation = pickRecommendedMuteRecovery(
      [current, tombstone],
      current,
    );
    expect(recommendation).toBeNull();
  });

  it("recommends the most-recent of multiple tied-largest candidates", () => {
    const wipe = makeCandidate("wipe", 9000, []);
    const olderBig = makeCandidate("older", 3000, ["a", "b", "c"]);
    const newerBig = makeCandidate("newer", 4000, ["x", "y", "z"]);
    const recommendation = pickRecommendedMuteRecovery(
      [wipe, olderBig, newerBig],
      wipe,
    );
    expect(recommendation?.eventId).toBe("newer");
  });

  it("recommends the largest non-empty when no current event exists", () => {
    const a = makeCandidate("a", 3000, ["x"]);
    const b = makeCandidate("b", 4000, ["x", "y", "z"]);
    const recommendation = pickRecommendedMuteRecovery([a, b], null);
    expect(recommendation?.eventId).toBe("b");
  });

  it("factors decrypted private items into the recommendation", () => {
    const current = makeCandidate("c", 5000, ["a", "b"]);
    const olderWithPrivate = makeCandidate("older", 3000, ["a"], {
      hasPrivateContent: true,
      privateDecrypted: true,
      privateCount: 4,
    });
    const recommendation = pickRecommendedMuteRecovery(
      [current, olderWithPrivate],
      current,
    );
    expect(recommendation?.eventId).toBe("older");
  });
});
