import { describe, it, expect } from "vitest";
import { Event } from "nostr-tools";
import {
  MAX_E_TAGS_PER_DELETION,
  buildDeletionTemplates,
  chunkEventIds,
  createNip04Decryptor,
  createNip44Decryptor,
  groupNip04ByCounterparty,
  revealNip04Messages,
  unwrapGiftWraps,
} from "@/lib/burnAfterReading";
import { Signer } from "@/lib/signers";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);

function dmEvent(
  id: string,
  created_at: number,
  tags: string[][] = [["p", HEX_B]],
): Event {
  return {
    id,
    pubkey: HEX_A,
    kind: 4,
    created_at,
    tags,
    content: "",
    sig: "",
  } as unknown as Event;
}

describe("chunkEventIds", () => {
  it("returns an empty array for no ids", () => {
    expect(chunkEventIds([])).toEqual([]);
  });

  it("keeps a single batch under the limit", () => {
    const ids = [HEX_A, HEX_B, HEX_C];
    expect(chunkEventIds(ids)).toEqual([ids]);
  });

  it("splits at the default batch size", () => {
    const ids = Array.from({ length: MAX_E_TAGS_PER_DELETION + 1 }, (_, i) =>
      i.toString(16).padStart(64, "0"),
    );
    const chunks = chunkEventIds(ids);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(MAX_E_TAGS_PER_DELETION);
    expect(chunks[1]).toHaveLength(1);
    expect(chunks.flat()).toEqual(ids);
  });

  it("honors a custom batch size", () => {
    const chunks = chunkEventIds(["1", "2", "3", "4", "5"], 2);
    expect(chunks).toEqual([["1", "2"], ["3", "4"], ["5"]]);
  });
});

describe("groupNip04ByCounterparty", () => {
  it("groups events by the p tag", () => {
    const events = [
      dmEvent("1", 100, [["p", HEX_B]]),
      dmEvent("2", 200, [["p", HEX_C]]),
      dmEvent("3", 300, [["p", HEX_B]]),
    ];
    const groups = groupNip04ByCounterparty(events);
    expect(groups).toHaveLength(2);
    const b = groups.find((g) => g.counterparty === HEX_B)!;
    expect(b.events.map((e) => e.id)).toEqual(["1", "3"]);
    const c = groups.find((g) => g.counterparty === HEX_C)!;
    expect(c.events.map((e) => e.id)).toEqual(["2"]);
  });

  it("collects events without a p tag under the empty counterparty", () => {
    const events = [dmEvent("1", 100, [])];
    const groups = groupNip04ByCounterparty(events);
    expect(groups).toHaveLength(1);
    expect(groups[0].counterparty).toBe("");
  });

  it("sorts events within a conversation oldest-first", () => {
    const events = [
      dmEvent("late", 300),
      dmEvent("early", 100),
      dmEvent("mid", 200),
    ];
    const groups = groupNip04ByCounterparty(events);
    expect(groups[0].events.map((e) => e.id)).toEqual([
      "early",
      "mid",
      "late",
    ]);
  });

  it("orders conversations by most recent activity, newest first", () => {
    const events = [
      dmEvent("1", 100, [["p", HEX_B]]), // B's latest = 400
      dmEvent("2", 400, [["p", HEX_B]]),
      dmEvent("3", 500, [["p", HEX_C]]), // C's latest = 500
    ];
    const groups = groupNip04ByCounterparty(events);
    expect(groups.map((g) => g.counterparty)).toEqual([HEX_C, HEX_B]);
  });
});

describe("buildDeletionTemplates", () => {
  it("builds one kind:5 template per chunk with e tags and the client tag", () => {
    const ids = ["1", "2", "3"];
    const templates = buildDeletionTemplates(ids, "cleanup", 1700000000);
    expect(templates).toHaveLength(1);
    expect(templates[0].kind).toBe(5);
    expect(templates[0].created_at).toBe(1700000000);
    expect(templates[0].content).toBe("cleanup");
    expect(templates[0].tags).toEqual([
      ["e", "1"],
      ["e", "2"],
      ["e", "3"],
      ["client", "Burn After Reading by Mutable"],
    ]);
  });

  it("trims the reason and chunks large selections", () => {
    const ids = Array.from({ length: MAX_E_TAGS_PER_DELETION + 2 }, (_, i) =>
      i.toString(),
    );
    const templates = buildDeletionTemplates(ids, "  dm purge  ", 1700000000);
    expect(templates).toHaveLength(2);
    expect(templates[0].content).toBe("dm purge");
    expect(templates[1].tags.filter((t) => t[0] === "e")).toHaveLength(2);
  });
});

describe("reveal and unwrap", () => {
  const fakeSigner = (nip04?: Signer["nip04Decrypt"], nip44?: Signer["nip44Decrypt"]) =>
    ({
      getPublicKey: async () => HEX_A,
      signEvent: async () => {
        throw new Error("not used");
      },
      nip04Encrypt: async () => "",
      nip04Decrypt:
        nip04 ||
        (async () => {
          throw new Error("no nip04");
        }),
      nip44Decrypt: nip44,
    }) as unknown as Signer;

  it("decrypts sent NIP-04 DMs via the signer", async () => {
    const signer = fakeSigner(async (peer) => `to ${peer}: hello`);
    const decryptor = createNip04Decryptor(signer);
    const events = [dmEvent("1", 100), dmEvent("2", 200)];
    const messages = await revealNip04Messages(events, HEX_B, decryptor);
    expect(messages.map((m) => m.content)).toEqual([
      `to ${HEX_B}: hello`,
      `to ${HEX_B}: hello`,
    ]);
    expect(messages.every((m) => m.counterparty === HEX_B)).toBe(true);
    expect(messages.every((m) => !m.error)).toBe(true);
  });

  it("records a per-message error instead of throwing when decryption fails", async () => {
    const signer = fakeSigner(async () => {
      throw new Error("denied");
    });
    const decryptor = createNip04Decryptor(signer);
    const messages = await revealNip04Messages([dmEvent("1", 100)], HEX_B, decryptor);
    expect(messages[0].error).toBe("denied");
    expect(messages[0].content).toBe("");
  });

  it("falls back to window.nostr when no session signer exists", async () => {
    (globalThis as any).window = {
      nostr: {
        nip04: { decrypt: async () => "from window" },
      },
    };
    try {
      const decryptor = createNip04Decryptor(null);
      expect(await decryptor(HEX_B, "ct")).toBe("from window");
    } finally {
      delete (globalThis as any).window;
    }
  });

  it("unwraps gift wraps through the seal layer to the rumor", async () => {
    const rumor = {
      kind: 14,
      pubkey: HEX_C,
      content: "burn this one",
      created_at: 1700000500,
    };
    const seal = { pubkey: HEX_C, content: "seal-ciphertext" };
    // Wrap layer decrypts against the ephemeral wrap pubkey; seal layer
    // against the sender's real pubkey.
    const layers: Record<string, string> = {
      [HEX_B]: JSON.stringify(seal),
      [HEX_C]: JSON.stringify(rumor),
    };
    const signer = fakeSigner(
      undefined,
      async (peer) => layers[peer] ?? (() => { throw new Error("bad layer"); })(),
    );
    const wrap: Event = {
      id: "wrap1",
      pubkey: HEX_B, // ephemeral key
      kind: 1059,
      created_at: 1700000400,
      tags: [["p", HEX_A]],
      content: "wrap-ciphertext",
      sig: "",
    } as unknown as Event;

    const results = await unwrapGiftWraps([wrap], createNip44Decryptor(signer));
    expect(results).toHaveLength(1);
    expect(results[0].error).toBeUndefined();
    expect(results[0].counterparty).toBe(HEX_C);
    expect(results[0].content).toBe("burn this one");
    expect(results[0].createdAt).toBe(1700000500);
  });

  it("reports unreadable wraps instead of failing the batch", async () => {
    const signer = fakeSigner(
      undefined,
      async () => {
        throw new Error("bad ciphertext");
      },
    );
    const wrap: Event = {
      id: "wrap1",
      pubkey: HEX_B,
      kind: 1059,
      created_at: 1700000400,
      tags: [["p", HEX_A]],
      content: "garbage",
      sig: "",
    } as unknown as Event;
    const results = await unwrapGiftWraps([wrap], createNip44Decryptor(signer));
    expect(results[0].error).toBeTruthy();
    expect(results[0].counterparty).toBe("");
    expect(results[0].createdAt).toBe(1700000400);
  });
});
