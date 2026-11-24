import { describe, expect, it } from "vitest";
import { nip19 } from "nostr-tools";
import { buildPreviewParts } from "@/lib/notePreview";
import { buildFirstNoteShare } from "@/lib/firstNoteShare";

const note = { id: "b".repeat(64), pubkey: "a".repeat(64), created_at: 1671217920 };

const text = (parts: ReturnType<typeof buildPreviewParts>) =>
  parts.segments.map((s) => s.value).join("");

describe("buildPreviewParts", () => {
  it("leaves no trailing blank lines once the quote reference is lifted out", () => {
    const { content } = buildFirstNoteShare(note);
    const parts = buildPreviewParts(content, { quoted: true });
    expect(text(parts)).toBe(
      "I found #MyFirstNote with #Mutable.\n\n🐣 December 16, 2022, 7:12 PM UTC",
    );
  });

  it("keeps the nevent as text when nothing renders it as a card", () => {
    const { content, nevent } = buildFirstNoteShare(note);
    expect(buildPreviewParts(content).segments.map((s) => s.value).join(""))
      .toContain(`nostr:${nevent}`.slice(0, 20));
  });

  it("lifts image links out and trims what they leave behind", () => {
    const parts = buildPreviewParts(
      "Here's the card\n\nhttps://blossom.example/abc.png",
    );
    expect(parts.inlineImages).toEqual(["https://blossom.example/abc.png"]);
    expect(text(parts)).toBe("Here's the card");
  });

  it("keeps blank lines between paragraphs", () => {
    const parts = buildPreviewParts("one\n\ntwo\n\n", { quoted: true });
    expect(text(parts)).toBe("one\n\ntwo");
  });

  it("handles a note that is only a quote", () => {
    const nevent = nip19.neventEncode({ id: note.id });
    const parts = buildPreviewParts(`nostr:${nevent}`, { quoted: true });
    expect(parts.segments).toEqual([]);
  });
});

describe("first-note caption punctuation", () => {
  it("keeps the trailing period out of the #Mutable hashtag", () => {
    const { content } = buildFirstNoteShare(note);
    const { segments } = buildPreviewParts(content, { quoted: true });
    const tags = segments.filter((s) => s.type === "hashtag").map((s) => s.value);
    expect(tags).toEqual(["#MyFirstNote", "#Mutable"]);
  });
});
