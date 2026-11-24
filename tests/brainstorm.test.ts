import { describe, it, expect } from "vitest";
import type { Event } from "nostr-tools";
import {
  BRAINSTORM_UNRANKED,
  latestProfiles,
  profileFromEvent,
  withSearchToken,
} from "@/lib/brainstorm";

const A = "a".repeat(64);
const B = "b".repeat(64);

function kind0(
  pubkey: string,
  content: unknown,
  created_at = 1700000000,
  kind = 0,
): Event {
  return {
    id: `${pubkey.slice(0, 8)}${created_at}`.padEnd(64, "0"),
    pubkey,
    kind,
    created_at,
    content: typeof content === "string" ? content : JSON.stringify(content),
    tags: [],
    sig: "",
  };
}

describe("withSearchToken", () => {
  it("adds the unranked token by default", () => {
    expect(withSearchToken({ kinds: [0] }).search).toBe(BRAINSTORM_UNRANKED);
  });

  it("keeps existing search terms ahead of the token", () => {
    const f = withSearchToken({ search: " jack " }, `observer:${A}`);
    expect(f.search).toBe(`jack observer:${A}`);
  });

  it("does not mutate the filter it was given", () => {
    const filter = { kinds: [1] };
    withSearchToken(filter);
    expect(filter).toEqual({ kinds: [1] });
  });
});

describe("profileFromEvent", () => {
  it("reads the usual kind:0 fields", () => {
    const p = profileFromEvent(
      kind0(A.toUpperCase(), {
        name: "alice",
        display_name: "Alice",
        picture: "https://example.com/a.png",
        nip05: "alice@example.com",
        about: "hi",
        lud16: "alice@example.com",
      }),
    );
    expect(p).toEqual({
      pubkey: A,
      name: "alice",
      display_name: "Alice",
      picture: "https://example.com/a.png",
      nip05: "alice@example.com",
      about: "hi",
      lud16: "alice@example.com",
    });
  });

  it("falls back to the legacy username and displayName keys", () => {
    const p = profileFromEvent(kind0(A, { username: "al", displayName: "Al" }));
    expect(p?.name).toBe("al");
    expect(p?.display_name).toBe("Al");
  });

  it("drops non-string and blank fields", () => {
    const p = profileFromEvent(kind0(A, { name: 42, picture: "  ", about: null }));
    expect(p).toEqual({ pubkey: A });
  });

  it("rejects malformed content, other kinds, and bad pubkeys", () => {
    expect(profileFromEvent(kind0(A, "not json"))).toBeNull();
    expect(profileFromEvent(kind0(A, "null"))).toBeNull();
    expect(profileFromEvent(kind0(A, { name: "x" }, 1, 1))).toBeNull();
    expect(profileFromEvent(kind0("xyz", { name: "x" }))).toBeNull();
  });
});

describe("latestProfiles", () => {
  it("keeps only the newest kind:0 per pubkey", () => {
    const profiles = latestProfiles([
      kind0(A, { name: "old" }, 100),
      kind0(A, { name: "new" }, 200),
      kind0(B, { name: "bob" }, 150),
      kind0(A, { name: "older" }, 50),
    ]);
    const byKey = new Map(profiles.map((p) => [p.pubkey, p.name]));
    expect(byKey.get(A)).toBe("new");
    expect(byKey.get(B)).toBe("bob");
    expect(profiles).toHaveLength(2);
  });

  it("ignores other kinds and unparseable newest versions", () => {
    const profiles = latestProfiles([
      kind0(A, { name: "a" }, 100),
      kind0(A, { name: "note" }, 300, 1),
      kind0(B, "broken", 100),
    ]);
    expect(profiles.map((p) => p.name)).toEqual(["a"]);
  });
});
