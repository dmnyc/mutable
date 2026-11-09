import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { dmEventToMeta, mergeEnvelopesIntoHeatmap } from "../lib/dmEnvelopes";

const secret = generateSecretKey();
const author = getPublicKey(secret);
const counterparty = getPublicKey(generateSecretKey());

function makeDMEvent(content: string, createdAt: number) {
  return finalizeEvent(
    {
      kind: 4,
      created_at: createdAt,
      tags: [["p", counterparty], ["client", "Mutable"]],
      content,
    },
    secret,
  );
}

describe("dmEventToMeta", () => {
  it("extracts envelope metadata with a raw snapshot", () => {
    const event = makeDMEvent("ciphertext-body", 1700000000);
    const meta = dmEventToMeta(event, "sent");

    expect(meta).toMatchObject({
      eventId: event.id,
      createdAt: 1700000000,
      direction: "sent",
      counterparty,
      contentLength: "ciphertext-body".length,
      client: "Mutable",
    });
    expect(meta.raw).toMatchObject({
      id: event.id,
      pubkey: author,
      created_at: 1700000000,
      content: "ciphertext-body",
    });
    expect(meta.raw?.tags).toContainEqual(["p", counterparty]);
  });

  it("uses the event author as counterparty for received DMs", () => {
    const meta = dmEventToMeta(makeDMEvent("x", 1), "received");
    expect(meta.counterparty).toBe(author);
    expect(meta.direction).toBe("received");
  });
});

describe("mergeEnvelopesIntoHeatmap", () => {
  const day = (date: string) => ({
    date,
    count: 0,
    sentCount: 0,
    receivedCount: 0,
    messages: [],
  });

  it("adds new envelopes to existing days and recomputes counts", () => {
    const heat = [
      { ...day("2026-10-05"), messages: [] as never[] },
    ] as never[];
    const sent = dmEventToMeta(makeDMEvent("hi", 1791240000), "sent");
    const received = dmEventToMeta(makeDMEvent("ho", 1791240100), "received");

    const merged = mergeEnvelopesIntoHeatmap(heat, [sent, received]);
    expect(merged).toHaveLength(1);
    expect(merged[0].count).toBe(2);
    expect(merged[0].sentCount).toBe(1);
    expect(merged[0].receivedCount).toBe(1);
    expect(
      merged[0].messages!.map((m) => m.createdAt),
    ).toEqual([1791240000, 1791240100]);
  });

  it("creates new day buckets for unseen dates", () => {
    const merged = mergeEnvelopesIntoHeatmap([], [
      dmEventToMeta(makeDMEvent("hey", 1791264000), "received"),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].date).toBe(
      new Date(1791264000 * 1000).toISOString().split("T")[0],
    );
    expect(merged[0].count).toBe(1);
  });

  it("does not duplicate events already in the heatmap", () => {
    const event = makeDMEvent("hi", 1793877600);
    const meta = dmEventToMeta(event, "sent");
    const merged = mergeEnvelopesIntoHeatmap(
      mergeEnvelopesIntoHeatmap([], [meta]),
      [meta],
    );
    expect(merged[0].messages!.length).toBe(1);
    expect(merged[0].count).toBe(1);
  });

  it("returns the input untouched when nothing is new", () => {
    const heat = [day("2026-10-05")] as never[];
    expect(mergeEnvelopesIntoHeatmap(heat, [])).toBe(heat);
  });
});
