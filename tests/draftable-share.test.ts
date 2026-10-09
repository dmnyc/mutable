import { describe, expect, it } from "vitest";
import { nip19 } from "nostr-tools";
import type { FollowPack } from "@/lib/draftable/pack";
import {
  draftedShareMessage,
  profileRefs,
  noteSegments,
  noteTags,
  packShareMessage,
  packShareUrl,
  releaseRequestMessage,
  shareContent,
  shareMentions,
} from "@/lib/draftable/share";

const AUTHOR = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

function pack(memberCount: number): FollowPack {
  return {
    dTag: "abc123",
    eventId: "e".repeat(64),
    author: AUTHOR,
    name: "Plebs",
    description: "",
    image: "",
    members: [B, C, "d".repeat(64)]
      .slice(0, memberCount)
      .map((pubkey) => ({ pubkey })),
    createdAt: 1_700_000_000,
  };
}

describe("shareContent / shareMentions", () => {
  it("turns mentions into nostr:npub references and dedupes p tags", () => {
    const parts = [
      "Hey ",
      { pubkey: B, name: "Bob" },
      " and ",
      { pubkey: B, name: "Bob" },
    ];
    const npub = nip19.npubEncode(B);
    expect(shareContent(parts)).toBe(`Hey nostr:${npub} and nostr:${npub}`);
    expect(shareMentions(parts)).toEqual([B]);
  });
});

describe("packShareMessage", () => {
  it("links to the production pack page", () => {
    expect(packShareUrl(pack(2))).toBe(
      `https://mutable.top/draftable/d/abc123?p=${AUTHOR.slice(0, 8)}`,
    );
  });

  it("speaks as the author without mentioning anyone", () => {
    const parts = packShareMessage(pack(3), "author", "Alice");
    expect(shareMentions(parts)).toEqual([]);
    const text = shareContent(parts);
    expect(text).toContain("I drafted 3 people into my follow pack “Plebs”");
    expect(text).toContain("none of them can leave. Unless they ask me. 🎖️");
    expect(text).toContain(packShareUrl(pack(3)));
  });

  it("uses singular wording for a one-person pack", () => {
    const text = shareContent(packShareMessage(pack(1), "author", "Alice"));
    expect(text).toContain("I drafted 1 person");
    expect(text).toContain("Follow them in one click");
    expect(text).toContain("they can't leave. Unless they ask me.");
  });

  it("mentions the author when a conscript shares", () => {
    const parts = packShareMessage(pack(3), "drafted", "Alice");
    expect(shareMentions(parts)).toEqual([AUTHOR]);
    const text = shareContent(parts);
    expect(text).toContain(
      `a follow pack by nostr:${nip19.npubEncode(AUTHOR)}`,
    );
    expect(text).toContain("along with 2 others");
    expect(text).toContain("See who else got drafted");
  });

  it("drops the 'others' clause when the conscript is alone", () => {
    const text = shareContent(packShareMessage(pack(1), "drafted", "Alice"));
    expect(text).not.toContain("along with");
    expect(text).toContain("See the pack on Draftable");
  });

  it("mentions the author when a bystander shares", () => {
    const parts = packShareMessage(pack(2), "bystander", "Alice");
    expect(shareMentions(parts)).toEqual([AUTHOR]);
    expect(shareContent(parts)).toContain(
      "“Plebs” is a follow pack of 2 people drafted by nostr:",
    );
  });
});

describe("draftedShareMessage", () => {
  const lookup = `https://mutable.top/draftable?npub=${nip19.npubEncode(B)}&view=drafted`;

  it("speaks for yourself and links to your own lookup", () => {
    const parts = draftedShareMessage({
      pubkey: B,
      name: "",
      self: true,
      count: 20,
      more: true,
    });
    expect(shareMentions(parts)).toEqual([]);
    const text = shareContent(parts);
    expect(text).toContain("drafted into 20+ follow packs");
    expect(text).toContain("can't leave any of them");
    expect(text).toContain(lookup);
  });

  it("mentions someone you looked up", () => {
    const parts = draftedShareMessage({
      pubkey: B,
      name: "Bob",
      self: false,
      count: 3,
      more: false,
    });
    expect(shareMentions(parts)).toEqual([B]);
    expect(shareContent(parts)).toMatch(
      /^Hey nostr:npub1\w+, you've been drafted into 3 follow packs/,
    );
  });

  it("uses singular wording for exactly one pack", () => {
    const text = shareContent(
      draftedShareMessage({
        pubkey: B,
        name: "Bob",
        self: false,
        count: 1,
        more: false,
      }),
    );
    expect(text).toContain("1 follow pack on Nostr, and you can't leave it");
    expect(text).toContain("See it on Draftable");
  });
});

describe("releaseRequestMessage", () => {
  it("mentions the author, names the pack, and links to it", () => {
    const parts = releaseRequestMessage(pack(3), "Alice");
    expect(shareMentions(parts)).toEqual([AUTHOR]);
    const text = shareContent(parts);
    expect(text).toMatch(/^Hi nostr:npub1\w+, you drafted me into/);
    expect(text).toContain("“Plebs”");
    expect(text).toContain("I never asked to be in it");
    expect(text).toContain("Draftable by #Mutable");
    expect(text).toContain(packShareUrl(pack(3)));
  });
});

describe("noteSegments / noteTags", () => {
  const npub = nip19.npubEncode(AUTHOR);
  const text = `Hi nostr:${npub}, see https://mutable.top/draftable/d/x?p=1. #Mutable rocks`;

  it("splits mentions, links, and hashtags the way clients render them", () => {
    expect(noteSegments(text)).toEqual([
      { type: "text", value: "Hi " },
      { type: "mention", value: `nostr:${npub}`, pubkey: AUTHOR },
      { type: "text", value: ", see " },
      { type: "url", value: "https://mutable.top/draftable/d/x?p=1" },
      { type: "text", value: ". " },
      { type: "hashtag", value: "#Mutable" },
      { type: "text", value: " rocks" },
    ]);
  });

  it("leaves a malformed nostr: reference as text", () => {
    expect(noteSegments("nostr:npub1notreal")).toEqual([
      { type: "text", value: "nostr:npub1notreal" },
    ]);
  });

  it("builds p, t, and client tags from the edited text", () => {
    expect(noteTags(text)).toEqual([
      ["p", AUTHOR],
      ["t", "Draftable"],
      ["t", "Mutable"],
      ["client", "Mutable"],
    ]);
    // Deleting the mention drops the p tag.
    expect(noteTags("just #Draftable")).toEqual([
      ["t", "Draftable"],
      ["client", "Mutable"],
    ]);
  });
});

describe("profileRefs", () => {
  it("finds pasted npubs with or without nostr:", () => {
    const npub = nip19.npubEncode(AUTHOR);
    expect(profileRefs(`hey ${npub} and nostr:${npub}`)).toEqual([
      { ref: npub, pubkey: AUTHOR },
      { ref: `nostr:${npub}`, pubkey: AUTHOR },
    ]);
  });
});

describe("profileRefs inside links", () => {
  it("leaves an npub in a URL alone", () => {
    const npub = nip19.npubEncode(AUTHOR);
    expect(
      profileRefs(
        `See mine: https://mutable.top/draftable?npub=${npub}&view=drafted`,
      ),
    ).toEqual([]);
    expect(profileRefs(`cc (${npub})`)).toEqual([
      { ref: npub, pubkey: AUTHOR },
    ]);
  });

  it("keeps the drafted-into share link intact end to end", () => {
    const parts = draftedShareMessage({
      pubkey: AUTHOR,
      name: "",
      self: true,
      count: 16,
      more: false,
    });
    expect(profileRefs(shareContent(parts))).toEqual([]);
  });
});
