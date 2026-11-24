import { describe, expect, it } from "vitest";
import {
  buildZombieShareNote,
  ZOMBIE_CHECK_SHARE_URL,
} from "@/lib/zombieShare";

const base = {
  pubkey: "a".repeat(64),
  npub: "npub1test",
  name: "jack",
  displayName: "Jack",
};

describe("buildZombieShareNote", () => {
  it("mentions the subject as a nostr: npub, not a plain name", () => {
    const { content } = buildZombieShareNote({
      ...base,
      verdictLine: "💀 Ancient Zombie",
      detail: "Gone for 2 years.",
      deletionLine: "✅ No deletion request found.",
    });
    expect(content).toContain(
      "I just ran a zombie check on nostr:npub1test and here's what I found:",
    );
    expect(content).not.toContain("Jack");
  });

  it("falls back to the display name when there is no npub", () => {
    const { content } = buildZombieShareNote({
      ...base,
      npub: "",
      verdictLine: "💚 Alive!",
      detail: "Active — last seen 3 days ago.",
      deletionLine: "✅ No deletion request found.",
    });
    expect(content).toContain("zombie check on Jack");
  });

  it("includes the verdict, detail, deletion line, and CTA", () => {
    const { content } = buildZombieShareNote({
      ...base,
      verdictLine: "⚰️ Fresh Zombie",
      detail: "Gone for 4 months.",
      deletionLine: "✅ No deletion request found.",
    });
    expect(content).toContain("⚰️ Fresh Zombie");
    expect(content).toContain("Gone for 4 months.");
    expect(content).toContain("✅ No deletion request found.");
    expect(content).toContain(
      `🧟 Run your own zombie check: ${ZOMBIE_CHECK_SHARE_URL}`,
    );
  });

  it("appends the image URL on its own line when given", () => {
    const { content } = buildZombieShareNote(
      {
        ...base,
        verdictLine: "💚 Alive!",
        detail: "Active recently.",
        deletionLine: "✅ No deletion request found.",
      },
      { imageUrl: "https://blossom.example/zombie.png" },
    );
    expect(content.endsWith("https://blossom.example/zombie.png")).toBe(true);
  });

  it("tags the subject and the client", () => {
    const { tags } = buildZombieShareNote({
      ...base,
      verdictLine: "🔥 Burned",
      detail: "This account has been marked as deleted.",
      deletionLine: "⚠️ This profile is currently flagged as deleted.",
    });
    expect(tags[0]).toEqual(["p", base.pubkey]);
    expect(tags).toContainEqual(["t", "ZombieCheck"]);
    expect(tags).toContainEqual(["t", "Mutable"]);
    expect(tags).toContainEqual(["client", "Mutable"]);
  });
});
