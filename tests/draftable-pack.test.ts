import { describe, expect, it } from "vitest";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  type Event,
} from "nostr-tools";
import {
  BLOCKED_PACK_AUTHORS,
  DRAFTABLE_KIND,
  UNTITLED_PACK,
  addFollowTags,
  buildPackTags,
  conscriptCount,
  generatePackId,
  isDrafted,
  latestPacks,
  packAddress,
  packNaddr,
  packPath,
  parsePackEvent,
  parsePackReference,
  relativeTime,
  removeFollowTags,
  resolvePubkey,
  segmentContent,
} from "@/lib/draftable/pack";

const authorKey = generateSecretKey();
const AUTHOR = getPublicKey(authorKey);
const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

function packEvent(
  tags: string[][],
  overrides: Partial<Event> = {},
): Event {
  return {
    ...finalizeEvent(
      {
        kind: DRAFTABLE_KIND,
        tags,
        content: "",
        created_at: 1_700_000_000,
      },
      authorKey,
    ),
    ...overrides,
  };
}

describe("parsePackEvent", () => {
  it("reads following.space's event layout", () => {
    const pack = parsePackEvent(
      packEvent([
        ["title", "Nostr Devs"],
        ["d", "abc123def456"],
        ["image", "https://example.com/cover.png"],
        ["p", A, "wss://relay.example"],
        ["p", B],
        ["description", "People who ship"],
      ]),
    );
    expect(pack).toMatchObject({
      dTag: "abc123def456",
      author: AUTHOR,
      name: "Nostr Devs",
      description: "People who ship",
      image: "https://example.com/cover.png",
      members: [{ pubkey: A, relay: "wss://relay.example" }, { pubkey: B }],
      createdAt: 1_700_000_000,
    });
  });

  it("keeps following.space's back-compat for the n tag and JSON content", () => {
    const pack = parsePackEvent(
      packEvent([["d", "old"], ["n", "Legacy name"], ["p", A]], {
        content: JSON.stringify({ description: "from content" }),
      }),
    );
    expect(pack?.name).toBe("Legacy name");
    expect(pack?.description).toBe("from content");
  });

  it("falls back to an untitled name and the event id", () => {
    const event = packEvent([["p", A]]);
    const pack = parsePackEvent(event);
    expect(pack?.name).toBe(UNTITLED_PACK);
    expect(pack?.dTag).toBe(event.id);
  });

  it("drops malformed and duplicate members", () => {
    const pack = parsePackEvent(
      packEvent([
        ["d", "x"],
        ["p", A],
        ["p", A.toUpperCase()],
        ["p", "npub-not-hex"],
        ["p", "abc"],
        ["p"],
        ["p", B],
      ]),
    );
    expect(pack?.members.map((m) => m.pubkey)).toEqual([A, B]);
  });

  it("rejects other kinds", () => {
    expect(parsePackEvent(packEvent([["d", "x"]], { kind: 30000 }))).toBeNull();
  });
});

describe("buildPackTags", () => {
  it("round-trips through parsePackEvent", () => {
    const tags = buildPackTags({
      dTag: "pack1",
      name: "  Bitcoin builders  ",
      description: "Hand-picked",
      image: "https://example.com/c.jpg",
      members: [{ pubkey: A }, { pubkey: B, relay: "wss://r.example" }],
    });
    const pack = parsePackEvent(packEvent(tags));
    expect(pack).toMatchObject({
      dTag: "pack1",
      name: "Bitcoin builders",
      description: "Hand-picked",
      image: "https://example.com/c.jpg",
      members: [{ pubkey: A }, { pubkey: B, relay: "wss://r.example" }],
    });
  });

  it("omits empty optional tags, de-duplicates members, adds an alt tag", () => {
    const tags = buildPackTags({
      dTag: "pack2",
      name: "Pack",
      description: "   ",
      image: "",
      members: [{ pubkey: A }, { pubkey: A.toUpperCase() }, { pubkey: "bad" }],
    });
    expect(tags.find((t) => t[0] === "image")).toBeUndefined();
    expect(tags.find((t) => t[0] === "description")).toBeUndefined();
    expect(tags.filter((t) => t[0] === "p")).toEqual([["p", A]]);
    expect(tags).toContainEqual(["alt", "Follow pack: Pack"]);
  });
});

describe("pack identity", () => {
  it("generates following.space-shaped ids", () => {
    const id = generatePackId();
    expect(id).toMatch(/^[a-z0-9]{12}$/);
    expect(generatePackId()).not.toBe(id);
  });

  it("builds addresses, naddrs and paths", () => {
    const pack = { author: AUTHOR, dTag: "my pack" };
    expect(packAddress(pack)).toBe(`${DRAFTABLE_KIND}:${AUTHOR}:my pack`);
    const decoded = nip19.decode(packNaddr(pack));
    expect(decoded.type).toBe("naddr");
    expect(decoded.data).toMatchObject({
      kind: DRAFTABLE_KIND,
      pubkey: AUTHOR,
      identifier: "my pack",
    });
    expect(packPath(pack)).toBe(`/draftable/d/my%20pack?p=${AUTHOR}`);
  });
});

describe("resolvePubkey", () => {
  it("accepts hex, npub, nprofile, and nostr: prefixes", () => {
    expect(resolvePubkey(A.toUpperCase())).toBe(A);
    expect(resolvePubkey(nip19.npubEncode(B))).toBe(B);
    expect(resolvePubkey(`nostr:${nip19.npubEncode(B)}`)).toBe(B);
    expect(resolvePubkey(nip19.nprofileEncode({ pubkey: C }))).toBe(C);
  });

  it("rejects everything else", () => {
    expect(resolvePubkey("")).toBeNull();
    expect(resolvePubkey(null)).toBeNull();
    expect(resolvePubkey("alice")).toBeNull();
    expect(resolvePubkey(nip19.noteEncode(A))).toBeNull();
  });
});

describe("parsePackReference", () => {
  it("reads following.space links, with or without a scheme", () => {
    expect(
      parsePackReference(`https://following.space/d/abc123def456?p=${AUTHOR}`),
    ).toEqual({ dTag: "abc123def456", author: AUTHOR });
    expect(parsePackReference("following.space/d/abc123def456")).toEqual({
      dTag: "abc123def456",
    });
  });

  it("reads Draftable links with an npub author", () => {
    const npub = nip19.npubEncode(AUTHOR);
    expect(
      parsePackReference(`https://mutable.top/draftable/d/my%20pack?p=${npub}`),
    ).toEqual({ dTag: "my pack", author: AUTHOR });
  });

  it("reads naddrs for follow packs only", () => {
    const naddr = packNaddr({ author: AUTHOR, dTag: "pack" });
    expect(parsePackReference(`nostr:${naddr}`)).toEqual({
      dTag: "pack",
      author: AUTHOR,
    });
    const muteList = nip19.naddrEncode({
      kind: 30001,
      pubkey: AUTHOR,
      identifier: "pack",
    });
    expect(parsePackReference(muteList)).toBeNull();
  });

  it("rejects unrelated input", () => {
    expect(parsePackReference("")).toBeNull();
    expect(parsePackReference("hello world")).toBeNull();
    expect(parsePackReference("https://example.com/users/x")).toBeNull();
  });
});

describe("latestPacks", () => {
  it("keeps the newest version of each pack and sorts newest first", () => {
    const older = packEvent([["d", "one"], ["title", "Old"]], {
      created_at: 100,
    });
    const newer = packEvent([["d", "one"], ["title", "New"]], {
      created_at: 200,
    });
    const other = packEvent([["d", "two"], ["title", "Other"]], {
      created_at: 150,
    });
    const packs = latestPacks([older, other, newer]);
    expect(packs.map((p) => p.name)).toEqual(["New", "Other"]);
  });

  it("drops packs from blocked authors", () => {
    const [blocked] = Array.from(BLOCKED_PACK_AUTHORS);
    const spam = packEvent([["d", "spam"]], { pubkey: blocked });
    expect(latestPacks([spam])).toEqual([]);
  });
});

describe("isDrafted", () => {
  it("matches members case-insensitively and ignores no viewer", () => {
    const pack = { members: [{ pubkey: A }] };
    expect(isDrafted(pack, A.toUpperCase())).toBe(true);
    expect(isDrafted(pack, B)).toBe(false);
    expect(isDrafted(pack, null)).toBe(false);
  });
});

describe("follow tag edits", () => {
  const existing = [
    ["p", A, "wss://relay.example", "alice"],
    ["t", "nostr"],
  ];

  it("appends new follows and keeps every existing tag", () => {
    const { tags, added } = addFollowTags(existing, [A, B, B, "bad", C]);
    expect(added).toEqual([B, C]);
    expect(tags).toEqual([...existing, ["p", B], ["p", C]]);
  });

  it("does not mutate the input", () => {
    const copy = JSON.parse(JSON.stringify(existing));
    addFollowTags(existing, [B]);
    removeFollowTags(existing, [A]);
    expect(existing).toEqual(copy);
  });

  it("removes only the requested follows", () => {
    const { tags, removed } = removeFollowTags(existing, [A, B]);
    expect(removed).toEqual([A]);
    expect(tags).toEqual([["t", "nostr"]]);
  });
});

describe("segmentContent", () => {
  it("splits text, links and images", () => {
    expect(
      segmentContent(
        "Look https://example.com/a.png and https://example.com/page, ok",
      ),
    ).toEqual([
      { type: "text", value: "Look " },
      { type: "image", url: "https://example.com/a.png" },
      { type: "text", value: " and " },
      { type: "link", url: "https://example.com/page" },
      { type: "text", value: ", ok" },
    ]);
  });

  it("never turns non-http schemes or markup into links", () => {
    const segments = segmentContent(
      'javascript:alert(1) <img src=x onerror="alert(1)">',
    );
    expect(segments).toEqual([
      {
        type: "text",
        value: 'javascript:alert(1) <img src=x onerror="alert(1)">',
      },
    ]);
  });

  it("does not let a URL swallow following markup", () => {
    const segments = segmentContent('https://example.com/"onmouseover=x');
    expect(segments[0]).toEqual({ type: "link", url: "https://example.com/" });
  });
});

describe("labels", () => {
  it("formats relative time like following.space", () => {
    const now = 1_700_000_000_000;
    const t = now / 1000;
    expect(relativeTime(t, now)).toBe("just now");
    expect(relativeTime(t - 60, now)).toBe("1 minute ago");
    expect(relativeTime(t - 3 * 3600, now)).toBe("3 hours ago");
    expect(relativeTime(t - 2 * 86400, now)).toBe("2 days ago");
    expect(relativeTime(t - 90 * 86400, now)).toBe("3 months ago");
  });

  it("counts conscripts", () => {
    expect(conscriptCount(1)).toBe("1 conscript");
    expect(conscriptCount(12)).toBe("12 conscripts");
  });
});
