import { describe, expect, it } from "vitest";
import { nip19 } from "nostr-tools";
import {
  DRAFTABLE_KIND,
  classifyLink,
  cleanRelayHints,
  ABANDONED_AFTER_DAYS,
  UNTITLED_PACK,
  generatePackId,
  isFullPubkey,
  matchPacks,
  matchesAuthor,
  packIdError,
  packPath,
  packsForLink,
  parseAuthorParam,
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
    ).toBe(
      `/draftable/d/my%20pack?p=${AUTHOR.slice(0, 16)}&r=wss%3A%2F%2Frelay.example`,
    );
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

describe("short pack links", () => {
  it("carries a 16-character author prefix", () => {
    const path = packPath({ author: AUTHOR, dTag: "snkwe5ebjvn9" });
    expect(path).toBe(`/draftable/d/snkwe5ebjvn9?p=${AUTHOR.slice(0, 16)}`);
    expect(`https://mutable.top${path}`.length).toBeLessThan(70);
  });

  it("reads a full key, an npub, or a prefix of 8+ hex characters", () => {
    expect(parseAuthorParam(AUTHOR)).toBe(AUTHOR);
    expect(parseAuthorParam(nip19.npubEncode(AUTHOR))).toBe(AUTHOR);
    expect(parseAuthorParam("EE6EA13A")).toBe("ee6ea13a"); // links made before
    expect(parseAuthorParam("ee6ea13ab9fe5c4a")).toBe("ee6ea13ab9fe5c4a");
    expect(parseAuthorParam("ee6ea1")).toBeNull();
    expect(parseAuthorParam("not-hex!")).toBeNull();
    expect(parseAuthorParam(null)).toBeNull();
  });

  it("matches a prefix or a full key, and knows which can go in a filter", () => {
    expect(matchesAuthor(AUTHOR, AUTHOR.slice(0, 8))).toBe(true);
    expect(matchesAuthor(AUTHOR, AUTHOR)).toBe(true);
    expect(matchesAuthor(OTHER, AUTHOR.slice(0, 8))).toBe(false);
    expect(isFullPubkey(AUTHOR)).toBe(true);
    expect(isFullPubkey(AUTHOR.slice(0, 8))).toBe(false);
  });

  it("opens links made before the prefix grew, and long and following.space ones", () => {
    const old = `https://mutable.top/draftable/d/snkwe5ebjvn9?p=${AUTHOR.slice(0, 8)}`;
    expect(parsePackReference(old)).toEqual({
      dTag: "snkwe5ebjvn9",
      author: AUTHOR.slice(0, 8),
    });
    expect(
      parsePackReference(`https://following.space/d/snkwe5ebjvn9?p=${AUTHOR}`),
    ).toEqual({ dTag: "snkwe5ebjvn9", author: AUTHOR });
    expect(referencePath({ dTag: "snkwe5ebjvn9", author: AUTHOR })).toBe(
      `/draftable/d/snkwe5ebjvn9?p=${AUTHOR.slice(0, 16)}`,
    );
  });
});

describe("packsForLink / classifyLink", () => {
  const A1 = "ab".repeat(32);
  // Starts the same way as A1 for 12 characters, then differs.
  const A2 = A1.slice(0, 12) + "0".repeat(52);
  const A3 = "cd".repeat(32);
  const make = (
    author: string,
    dTag: string,
    createdAt: number,
  ): FollowPack => ({
    dTag,
    eventId: `${author.slice(0, 8)}${createdAt}`.padEnd(64, "0"),
    author,
    name: "Pack",
    description: "",
    image: "",
    members: [{ pubkey: A3 }],
    createdAt,
  });
  const packs = [
    make(A1, "id", 100),
    make(A1, "id", 200), // newer version by the same author
    make(A2, "id", 300),
    make(A3, "id", 150),
    make(A1, "other", 400),
  ];

  it("keeps the newest version per author, for this ID only, newest first", () => {
    expect(
      packsForLink(packs, "id").map((p) => [p.author.slice(0, 2), p.createdAt]),
    ).toEqual([
      ["ab", 300],
      ["ab", 200],
      ["cd", 150],
    ]);
  });

  it("narrows by a full key or a prefix", () => {
    expect(packsForLink(packs, "id", A1).map((p) => p.createdAt)).toEqual([
      200,
    ]);
    expect(
      packsForLink(packs, "id", A1.slice(0, 16)).map((p) => p.createdAt),
    ).toEqual([200]);
    // An 8-character (older) prefix matches both authors that start alike.
    expect(
      packsForLink(packs, "id", A1.slice(0, 8)).map((p) => p.createdAt),
    ).toEqual([300, 200]);
  });

  it("asks instead of taking the newest when several authors match", () => {
    expect(classifyLink([])).toEqual({ status: "missing" });
    const one = packsForLink(packs, "id", A3);
    expect(classifyLink(one)).toEqual({ status: "found", pack: one[0] });
    const many = packsForLink(packs, "id", A1.slice(0, 8));
    expect(classifyLink(many)).toEqual({ status: "ambiguous", packs: many });
    // With no author in the link, everyone who used the ID matches.
    expect(classifyLink(packsForLink(packs, "id")).status).toBe("ambiguous");
  });
});
