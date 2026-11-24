import { describe, expect, it } from "vitest";
import { nip19 } from "nostr-tools";
import {
  buildFirstNoteShare,
  formatFirstNoteTimestamp,
  FIRST_NOTE_CAPTION,
} from "@/lib/firstNoteShare";

const note = {
  id: "b".repeat(64),
  pubkey: "a".repeat(64),
  // 2021-03-03T16:12:00Z
  created_at: 1614787920,
};

describe("formatFirstNoteTimestamp", () => {
  it("formats in UTC with a 12-hour clock", () => {
    expect(formatFirstNoteTimestamp(note.created_at)).toBe(
      "March 3, 2021, 4:12 PM UTC",
    );
  });

  it("handles midnight and noon", () => {
    expect(formatFirstNoteTimestamp(1614729600)).toBe(
      "March 3, 2021, 12:00 AM UTC",
    );
    expect(formatFirstNoteTimestamp(1614772800)).toBe(
      "March 3, 2021, 12:00 PM UTC",
    );
  });
});

describe("buildFirstNoteShare", () => {
  it("leads with the caption and includes the timestamp and quote", () => {
    const { content, nevent } = buildFirstNoteShare(note, {
      relays: ["wss://relay.example"],
    });
    expect(content.startsWith(`${FIRST_NOTE_CAPTION}\n`)).toBe(true);
    expect(FIRST_NOTE_CAPTION).toBe("I found #MyFirstNote with #Mutable.");
    expect(content).toContain("🐣 March 3, 2021, 4:12 PM UTC");
    expect(content).toContain(`nostr:${nevent}`);
  });

  it("encodes the note id, author, and relay hints in the nevent", () => {
    const { nevent } = buildFirstNoteShare(note, {
      relays: ["wss://relay.example"],
    });
    const decoded = nip19.decode(nevent);
    expect(decoded.type).toBe("nevent");
    if (decoded.type === "nevent") {
      expect(decoded.data.id).toBe(note.id);
      expect(decoded.data.author).toBe(note.pubkey);
      expect(decoded.data.relays).toEqual(["wss://relay.example"]);
    }
  });

  it("tags the quote, author, hashtags, and client", () => {
    const { tags } = buildFirstNoteShare(note, {
      relays: ["wss://relay.example"],
    });
    expect(tags).toContainEqual([
      "q",
      note.id,
      "wss://relay.example",
      note.pubkey,
    ]);
    expect(tags).toContainEqual(["p", note.pubkey]);
    expect(tags).toContainEqual(["t", "MyFirstNote"]);
    expect(tags).toContainEqual(["t", "Mutable"]);
    expect(tags).toContainEqual(["client", "Mutable"]);
  });

  it("works without relay hints", () => {
    const { tags } = buildFirstNoteShare(note);
    expect(tags).toContainEqual(["q", note.id, "", note.pubkey]);
  });
});
