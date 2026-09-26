import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  type Event,
} from "nostr-tools";
import {
  buildExportBundle,
  LAZARUS_EXPORT_FORMAT,
  lazarusFileName,
  listArchive,
  parseImportedEvents,
  removeFromArchive,
  saveToArchive,
  type LazarusArchiveEntry,
} from "@/lib/lazarus/archive";
import {
  muteListFromTags,
  profileFromEvent,
  relayListMetadataFromEvent,
} from "@/lib/lazarus/local";

const secretKey = generateSecretKey();
const pubkey = getPublicKey(secretKey);
const otherKey = generateSecretKey();

let clock = 1_700_000_000;
function signed(
  kind: number,
  tags: string[][] = [],
  content = "",
  key: Uint8Array = secretKey,
): Event {
  clock += 1;
  return finalizeEvent({ kind, created_at: clock, tags, content }, key);
}

class MemoryStorage {
  data = new Map<string, string>();
  quota = Infinity;
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.data.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    if (value.length > this.quota) throw new Error("QuotaExceededError");
    this.data.set(key, value);
  }
}

let memory: MemoryStorage;

beforeEach(() => {
  memory = new MemoryStorage();
  (globalThis as { localStorage?: unknown }).localStorage = memory;
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("parseImportedEvents", () => {
  it("accepts an export bundle, an array, or a single event", () => {
    const follows = signed(3, [["p", "a".repeat(64)]]);
    const profile = signed(0, [], '{"name":"me"}');
    const bundle = JSON.stringify(
      buildExportBundle(pubkey, [follows, profile]),
    );
    expect(
      parseImportedEvents(bundle, pubkey)
        .events.map((e) => e.id)
        .sort(),
    ).toEqual([follows.id, profile.id].sort());
    expect(
      parseImportedEvents(JSON.stringify([follows]), pubkey).events,
    ).toHaveLength(1);
    expect(
      parseImportedEvents(JSON.stringify(profile), pubkey).events,
    ).toHaveLength(1);
  });

  it("rejects tampered events, other accounts' events, and kinds it can't restore", () => {
    const valid = signed(10000, [["word", "spam"]]);
    const tampered = { ...signed(3), content: "changed after signing" };
    const foreign = signed(3, [], "", otherKey);
    const note = signed(1, [], "hello");
    const result = parseImportedEvents(
      JSON.stringify([
        valid,
        tampered,
        foreign,
        note,
        valid,
        { not: "an event" },
      ]),
      pubkey,
    );
    expect(result.events.map((e) => e.id)).toEqual([valid.id]);
    expect(result.invalid).toBe(2);
    expect(result.foreign).toBe(1);
    expect(result.unsupported).toBe(1);
  });

  it("strips extra fields a file may carry", () => {
    const follows = signed(3);
    const [event] = parseImportedEvents(
      JSON.stringify({ ...follows, seenOn: ["wss://a"] }),
      pubkey,
    ).events;
    expect(Object.keys(event).sort()).toEqual([
      "content",
      "created_at",
      "id",
      "kind",
      "pubkey",
      "sig",
      "tags",
    ]);
  });

  it("explains a file that isn't JSON", () => {
    expect(() => parseImportedEvents("not json", pubkey)).toThrow(/valid JSON/);
  });
});

describe("buildExportBundle", () => {
  it("labels the bundle and orders events by kind, newest first", () => {
    const older = signed(3);
    const newer = signed(3);
    const profile = signed(0);
    const bundle = buildExportBundle(pubkey, [older, profile, newer]);
    expect(bundle.format).toBe(LAZARUS_EXPORT_FORMAT);
    expect(bundle.version).toBe(1);
    expect(bundle.pubkey).toBe(pubkey);
    expect(bundle.events.map((e) => e.id)).toEqual([
      profile.id,
      newer.id,
      older.id,
    ]);
  });
});

describe("archive", () => {
  const entry = (event: Event, savedAt: number): LazarusArchiveEntry => ({
    event,
    source: "import",
    label: "backup.json",
    savedAt,
  });

  it("saves, lists by account and kind, and removes versions", () => {
    const follows = signed(3);
    const mutes = signed(10000);
    const foreign = signed(3, [], "", otherKey);
    expect(
      saveToArchive([entry(follows, 1), entry(mutes, 2), entry(foreign, 3)]),
    ).toBe(3);
    expect(listArchive(pubkey).map((e) => e.event.id)).toEqual([
      mutes.id,
      follows.id,
    ]);
    expect(listArchive(pubkey, 3).map((e) => e.event.id)).toEqual([follows.id]);
    removeFromArchive(follows.id);
    expect(listArchive(pubkey).map((e) => e.event.id)).toEqual([mutes.id]);
  });

  it("keeps one copy of each event", () => {
    const follows = signed(3);
    saveToArchive([entry(follows, 1)]);
    expect(saveToArchive([{ ...entry(follows, 2), label: "again.json" }])).toBe(
      0,
    );
    expect(listArchive(pubkey)).toHaveLength(1);
    expect(listArchive(pubkey)[0].label).toBe("backup.json");
  });

  it("keeps at most 20 versions per kind, dropping the oldest", () => {
    const versions = Array.from({ length: 25 }, (_, i) => entry(signed(3), i));
    saveToArchive(versions);
    const kept = listArchive(pubkey, 3);
    expect(kept).toHaveLength(20);
    expect(kept[kept.length - 1].savedAt).toBe(5);
  });

  it("drops the oldest versions when storage is full", () => {
    saveToArchive([entry(signed(3), 1)]);
    memory.quota = memory.getItem("mutable-lazarus-archive")!.length + 400;
    saveToArchive([entry(signed(10000), 2)]);
    const kept = listArchive(pubkey);
    expect(kept).toHaveLength(1);
    expect(kept[0].savedAt).toBe(2);
  });

  it("works without storage", () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(listArchive(pubkey)).toEqual([]);
    expect(() => saveToArchive([entry(signed(3), 1)])).not.toThrow();
  });
});

describe("lazarusFileName", () => {
  it("builds a readable, filesystem-safe name", () => {
    expect(
      lazarusFileName(
        "Mute list / all versions",
        "abcdef0123456789",
        new Date("2026-09-26T12:34:56Z"),
      ),
    ).toBe("mutable-mute-list-all-versions-abcdef01-2026-09-26-12-34.json");
  });
});

describe("local copies", () => {
  it("rebuilds a mute list from public and private tags", () => {
    const pk = "b".repeat(64);
    const noteId = "c".repeat(64);
    const list = muteListFromTags(
      [
        ["p", pk, "wss://hint", "spam"],
        ["t", "nsfw"],
      ],
      [
        ["word", "scam"],
        ["e", noteId],
        ["p", ""],
      ],
    );
    expect(list.pubkeys).toEqual([
      {
        type: "pubkey",
        value: pk,
        reason: "spam",
        eventRef: undefined,
        private: false,
      },
    ]);
    expect(list.tags[0]).toMatchObject({ value: "nsfw", private: false });
    expect(list.words[0]).toMatchObject({ value: "scam", private: true });
    expect(list.threads[0]).toMatchObject({ value: noteId, private: true });
  });

  it("reads a profile, tolerating broken content", () => {
    expect(
      profileFromEvent(signed(0, [], '{"name":"me","about":5}')),
    ).toMatchObject({
      pubkey,
      name: "me",
      about: undefined,
    });
    expect(profileFromEvent(signed(0, [], "{broken")).name).toBeUndefined();
  });

  it("splits a relay list into read, write, and both", () => {
    const event = signed(10002, [
      ["r", "wss://both/"],
      ["r", "wss://reader", "read"],
      ["r", "wss://writer", "write"],
    ]);
    expect(relayListMetadataFromEvent(event)).toEqual({
      read: ["wss://reader"],
      write: ["wss://writer"],
      both: ["wss://both"],
      timestamp: event.created_at,
    });
  });
});
