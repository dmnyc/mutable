import { describe, expect, it, vi } from "vitest";
import { nip19 } from "nostr-tools";
import {
  isDirectLookup,
  noUserFoundMessage,
  parseLookupInput,
  resolveLookupInput,
  shortenForMessage,
} from "@/lib/lookupInput";

const pubkey = "a".repeat(64);
const eventId = "b".repeat(64);
const npub = nip19.npubEncode(pubkey);

describe("parseLookupInput", () => {
  it("treats blank input as empty", () => {
    expect(parseLookupInput("   ")).toEqual({ kind: "empty" });
  });

  it("decodes npub, nprofile, and hex", () => {
    expect(parseLookupInput(npub)).toEqual({ kind: "pubkey", pubkey });
    expect(
      parseLookupInput(nip19.nprofileEncode({ pubkey, relays: [] })),
    ).toEqual({ kind: "pubkey", pubkey });
    expect(parseLookupInput(pubkey.toUpperCase())).toEqual({
      kind: "pubkey",
      pubkey,
    });
  });

  it("strips nostr:, @, whitespace, and links", () => {
    expect(parseLookupInput(`  nostr:${npub}\n`)).toEqual({
      kind: "pubkey",
      pubkey,
    });
    expect(parseLookupInput(`@${npub}`)).toEqual({ kind: "pubkey", pubkey });
    expect(parseLookupInput(`https://jumble.social/users/${npub}`)).toEqual({
      kind: "pubkey",
      pubkey,
    });
  });

  it("uses the author of an nevent that names one", () => {
    const nevent = nip19.neventEncode({ id: eventId, author: pubkey });
    expect(parseLookupInput(nevent)).toEqual({ kind: "pubkey", pubkey });
  });

  it("asks for the note when an nevent or note has no author", () => {
    const nevent = nip19.neventEncode({ id: eventId, relays: ["wss://r.example"] });
    expect(parseLookupInput(nevent)).toEqual({
      kind: "event",
      id: eventId,
      relays: ["wss://r.example"],
    });
    expect(parseLookupInput(nip19.noteEncode(eventId))).toEqual({
      kind: "event",
      id: eventId,
      relays: [],
    });
  });

  it("reads the author out of an naddr", () => {
    const naddr = nip19.naddrEncode({ identifier: "x", pubkey, kind: 30000 });
    expect(parseLookupInput(naddr)).toEqual({ kind: "pubkey", pubkey });
  });

  it("flags private keys without treating them as a name", () => {
    const nsec = nip19.nsecEncode(new Uint8Array(32).fill(7));
    expect(parseLookupInput(nsec)).toEqual({ kind: "secret" });
    expect(parseLookupInput(`nostr:${nsec}`)).toEqual({ kind: "secret" });
  });

  it("reports a broken npub instead of searching for it", () => {
    const broken = npub.slice(0, -4);
    const parsed = parseLookupInput(broken);
    expect(parsed.kind).toBe("invalid");
    expect(parseLookupInput(`${npub.slice(0, -1)}x`).kind).toBe("invalid");
  });

  it("leaves names and NIP-05 addresses for profile search", () => {
    expect(parseLookupInput("jack")).toEqual({ kind: "name", query: "jack" });
    expect(parseLookupInput("jack@cash.app")).toEqual({
      kind: "name",
      query: "jack@cash.app",
    });
    // Starts like an npub but isn't one.
    expect(parseLookupInput("npubfan").kind).toBe("name");
  });
});

describe("isDirectLookup", () => {
  it("is true for identifiers and false for names", () => {
    expect(isDirectLookup(npub)).toBe(true);
    expect(isDirectLookup(nip19.noteEncode(eventId))).toBe(true);
    expect(isDirectLookup("jack")).toBe(false);
    expect(isDirectLookup("")).toBe(false);
  });
});

describe("messages", () => {
  it("shortens long queries", () => {
    const long = "x".repeat(200);
    expect(shortenForMessage(long).length).toBe(40);
    expect(noUserFoundMessage(long)).not.toContain(long);
  });
});

describe("resolveLookupInput", () => {
  it("resolves an authorless nevent through the fetched event", async () => {
    const fetchEvent = vi.fn().mockResolvedValue({ pubkey });
    const result = await resolveLookupInput(
      nip19.neventEncode({ id: eventId }),
      fetchEvent,
    );
    expect(result).toEqual({ ok: true, pubkey });
    expect(fetchEvent).toHaveBeenCalledWith(eventId, []);
  });

  it("explains when the note can't be found", async () => {
    const result = await resolveLookupInput(
      nip19.noteEncode(eventId),
      async () => null,
    );
    expect(result.ok).toBe(false);
  });

  it("never fetches for a private key", async () => {
    const fetchEvent = vi.fn();
    const result = await resolveLookupInput(
      nip19.nsecEncode(new Uint8Array(32).fill(7)),
      fetchEvent,
    );
    expect(result.ok).toBe(false);
    expect(fetchEvent).not.toHaveBeenCalled();
  });

  it("hands names back to the caller", async () => {
    expect(await resolveLookupInput("jack", async () => null)).toEqual({
      ok: "name",
      query: "jack",
    });
  });
});
