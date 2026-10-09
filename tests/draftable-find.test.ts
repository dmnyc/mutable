import { describe, expect, it } from "vitest";
import { nip19 } from "nostr-tools";
import {
  DRAFTABLE_KIND,
  cleanRelayHints,
  ABANDONED_AFTER_DAYS,
  UNTITLED_PACK,
  generatePackId,
  matchPacks,
  packIdError,
  parsePackReference,
  referencePath,
  testPackReason,
  type FollowPack,
} from "@/lib/draftable/pack";

const AUTHOR = "a".repeat(64);
const OTHER = "b".repeat(64);

describe("parsePackReference relay hints", () => {
  it("keeps an naddr's wss hints, from any link that carries one", () => {
    const naddr = nip19.naddrEncode({
      kind: DRAFTABLE_KIND,
      pubkey: AUTHOR,
      identifier: "pack",
      relays: ["wss://relay.example/", "ws://insecure.example", "nonsense"],
    });
    const expected = {
      dTag: "pack",
      author: AUTHOR,
      relays: ["wss://relay.example"],
    };
    expect(parsePackReference(naddr)).toEqual(expected);
    expect(parsePackReference(`https://following.space/${naddr}`)).toEqual(
      expected,
    );
    expect(
      parsePackReference(`https://mutable.top/draftable/d/${naddr}`),
    ).toEqual(expected);
  });

  it("doesn't mistake a search term for a link", () => {
    expect(parsePackReference("bitcoin")).toBeNull();
    expect(parsePackReference("nostr devs")).toBeNull();
  });
});

describe("cleanRelayHints", () => {
  it("keeps up to three distinct wss URLs", () => {
    expect(
      cleanRelayHints([
        "wss://a.example",
        "wss://a.example/",
        "https://b.example",
        42,
        "wss://c.example",
        "wss://d.example",
        "wss://e.example",
      ]),
    ).toEqual(["wss://a.example", "wss://c.example", "wss://d.example"]);
  });
});

describe("referencePath", () => {
  it("builds the pack page URL with author and relay hints", () => {
    expect(
      referencePath({
        dTag: "my pack",
        author: AUTHOR,
        relays: ["wss://relay.example"],
      }),
    ).toBe(`/draftable/d/my%20pack?p=${AUTHOR}&r=wss%3A%2F%2Frelay.example`);
    expect(referencePath({ dTag: "abc" })).toBe("/draftable/d/abc");
  });
});

describe("packIdError", () => {
  it("accepts short lowercase slugs", () => {
    expect(packIdError("nostr-devs")).toBeNull();
    expect(packIdError("abc")).toBeNull();
    expect(packIdError(generatePackId())).toBeNull();
  });

  it("rejects bad lengths, characters, and edge hyphens", () => {
    expect(packIdError("ab")).toMatch(/3 to 64/);
    expect(packIdError("a".repeat(65))).toMatch(/3 to 64/);
    expect(packIdError("Nostr Devs")).toMatch(/lowercase/);
    expect(packIdError("devs/2")).toMatch(/lowercase/);
    expect(packIdError("-devs")).toMatch(/hyphen/);
    expect(packIdError("devs-")).toMatch(/hyphen/);
  });
});

describe("matchPacks", () => {
  function pack(
    name: string,
    createdAt: number,
    extra: Partial<FollowPack> = {},
  ): FollowPack {
    return {
      dTag: name,
      eventId: "e".repeat(64),
      author: AUTHOR,
      name,
      description: "",
      image: "",
      members: [],
      createdAt,
      ...extra,
    };
  }

  const packs = [
    pack("Bitcoin Devs", 5),
    pack("Devs", 1),
    pack("Nostr devs worth following", 4),
    pack("Webdevs", 3),
    pack("Artists", 6, { description: "Painters and devs who draw" }),
    pack("Café Owners", 2),
    pack("Plebs", 7, { author: OTHER }),
  ];

  it("ranks exact, prefix, word, substring, then description matches", () => {
    expect(matchPacks(packs, "devs").map((p) => p.name)).toEqual([
      "Devs",
      "Bitcoin Devs",
      "Nostr devs worth following",
      "Webdevs",
      "Artists",
    ]);
  });

  it("ignores case and accents", () => {
    expect(matchPacks(packs, "CAFE").map((p) => p.name)).toEqual([
      "Café Owners",
    ]);
  });

  it("treats an npub as 'packs by this author'", () => {
    expect(
      matchPacks(packs, nip19.npubEncode(OTHER)).map((p) => p.name),
    ).toEqual(["Plebs"]);
  });

  it("returns nothing for a blank term", () => {
    expect(matchPacks(packs, "  ")).toEqual([]);
  });
});

describe("testPackReason", () => {
  const NOW = 1_800_000_000;
  const DAY = 86_400;
  const pack = (extra: Partial<FollowPack> = {}): FollowPack => ({
    dTag: "x",
    eventId: "e".repeat(64),
    author: AUTHOR,
    name: "Bitcoin Builders",
    description: "",
    image: "",
    members: [{ pubkey: OTHER }, { pubkey: "c".repeat(64) }],
    createdAt: NOW - DAY,
    ...extra,
  });
  const reason = (extra: Partial<FollowPack> = {}) =>
    testPackReason(pack(extra), OTHER, NOW);

  it("keeps an ordinary pack", () => {
    expect(reason()).toBeNull();
  });

  it("never flags the viewer's own packs", () => {
    expect(testPackReason(pack({ members: [] }), AUTHOR, NOW)).toBeNull();
  });

  it("flags packs with one person or nobody", () => {
    expect(reason({ members: [{ pubkey: OTHER }] })).toBe("single-user");
    expect(reason({ members: [] })).toBe("single-user");
  });

  it("flags untitled packs", () => {
    expect(reason({ name: UNTITLED_PACK })).toBe("untitled");
    expect(reason({ name: "  " })).toBe("untitled");
  });

  it("flags test-style names", () => {
    for (const name of [
      "Test List",
      "jim test",
      "IT32 Pack 1790722839012",
      "DBG21 1790722611885",
      "Dbg Pack",
      "asdf",
      "my pack",
      "xxx",
      "🫡🫡",
    ]) {
      expect(reason({ name })).toBe("test name");
    }
  });

  it("doesn't mistake real names that contain test-like letters", () => {
    for (const name of ["Contest Winners", "Testnet Devs", "Beta Testers"]) {
      expect(reason({ name })).toBeNull();
    }
  });

  it("flags small packs nobody has touched in six months", () => {
    const old = NOW - (ABANDONED_AFTER_DAYS + 1) * DAY;
    expect(reason({ createdAt: old })).toBe("abandoned");
    const four = ["c", "d", "e", "f"].map((c) => ({ pubkey: c.repeat(64) }));
    expect(reason({ createdAt: old, members: four })).toBeNull();
    expect(
      reason({ createdAt: NOW - (ABANDONED_AFTER_DAYS - 1) * DAY }),
    ).toBeNull();
  });
});
