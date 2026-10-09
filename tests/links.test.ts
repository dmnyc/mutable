import { describe, expect, it } from "vitest";
import { nip19 } from "nostr-tools";
import {
  getEventLink,
  getPostedNoteLink,
  getProfileLink,
} from "@/lib/utils/links";

const PUBKEY =
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const EVENT =
  "7fbdb29d4a282077096095e1479c71938224452f4b0682c6b0e5abffc11116f2";

describe("getProfileLink", () => {
  it("links to Nostr Archives by hex pubkey, from hex, npub, or nprofile", () => {
    const want = `https://nostrarchives.com/profiles/${PUBKEY}`;
    expect(getProfileLink(PUBKEY)).toBe(want);
    expect(getProfileLink(PUBKEY.toUpperCase())).toBe(want);
    expect(getProfileLink(nip19.npubEncode(PUBKEY))).toBe(want);
    expect(getProfileLink(nip19.nprofileEncode({ pubkey: PUBKEY }))).toBe(want);
  });

  it("returns # for anything else", () => {
    expect(getProfileLink("not a key")).toBe("#");
  });
});

describe("getEventLink", () => {
  it("links to Nostr Archives by hex id, from hex, note1, or nevent1", () => {
    const want = `https://nostrarchives.com/notes/${EVENT}`;
    expect(getEventLink(EVENT)).toBe(want);
    expect(getEventLink(nip19.noteEncode(EVENT))).toBe(want);
    expect(
      getEventLink(
        nip19.neventEncode({ id: EVENT, relays: ["wss://nos.lol"] }),
      ),
    ).toBe(want);
  });

  it("returns # for anything else", () => {
    expect(getEventLink("nope")).toBe("#");
  });
});

describe("getPostedNoteLink", () => {
  it("links a just-posted note on Jumble as an nevent with relay hints", () => {
    const link = getPostedNoteLink(EVENT, {
      relays: [
        "wss://a.example",
        "wss://b.example",
        "wss://c.example",
        "wss://d.example",
      ],
      author: PUBKEY,
    });
    expect(link.startsWith("https://jumble.social/notes/nevent1")).toBe(true);
    const decoded = nip19.decode(link.split("/notes/")[1]);
    expect(decoded.type).toBe("nevent");
    if (decoded.type === "nevent") {
      expect(decoded.data.id).toBe(EVENT);
      expect(decoded.data.author).toBe(PUBKEY);
      expect(decoded.data.relays).toHaveLength(3);
    }
  });
});
