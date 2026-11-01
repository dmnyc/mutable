import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getAddedAtMap,
  recordAddedAt,
  removeAddedAt,
  renameAddedAt,
  orderMuteItems,
} from "@/lib/muteAddedAt";

// Minimal localStorage shim so the ledger module works under the node
// vitest environment.
function installLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
}

let storage: ReturnType<typeof installLocalStorage>;

beforeEach(() => {
  storage = installLocalStorage();
  (globalThis as any).window = { localStorage: storage };
});

afterEach(() => {
  delete (globalThis as any).window;
});

describe("added-at ledger", () => {
  it("records, reads back, and removes entries per category and value", () => {
    recordAddedAt("pk1", "pubkeys", "aaa");
    const map = getAddedAtMap("pk1");
    expect(map["pubkeys:aaa"]).toBeTypeOf("number");

    // Same value in another category is tracked separately
    recordAddedAt("pk1", "words", "aaa");
    expect(Object.keys(getAddedAtMap("pk1")).sort()).toEqual([
      "pubkeys:aaa",
      "words:aaa",
    ]);

    removeAddedAt("pk1", "words", "aaa");
    expect(getAddedAtMap("pk1")["words:aaa"]).toBeUndefined();
    expect(getAddedAtMap("pk1")["pubkeys:aaa"]).toBeTypeOf("number");
  });

  it("keeps ledgers separate per user", () => {
    recordAddedAt("pk1", "pubkeys", "aaa");
    recordAddedAt("pk2", "pubkeys", "bbb");
    expect(getAddedAtMap("pk1")["pubkeys:bbb"]).toBeUndefined();
    expect(getAddedAtMap("pk2")["pubkeys:aaa"]).toBeUndefined();
  });

  it("moves an entry when a word or tag value is edited", () => {
    recordAddedAt("pk1", "words", "spam");
    renameAddedAt("pk1", "words", "spam", "scam");
    const map = getAddedAtMap("pk1");
    expect(map["words:spam"]).toBeUndefined();
    expect(map["words:scam"]).toBeTypeOf("number");
  });

  it("re-recording after removal gives a fresh timestamp", async () => {
    recordAddedAt("pk1", "pubkeys", "aaa");
    const first = getAddedAtMap("pk1")["pubkeys:aaa"];
    removeAddedAt("pk1", "pubkeys", "aaa");
    await new Promise((r) => setTimeout(r, 2));
    recordAddedAt("pk1", "pubkeys", "aaa");
    expect(getAddedAtMap("pk1")["pubkeys:aaa"]).toBeGreaterThan(first!);
  });
});

describe("orderMuteItems", () => {
  const items = [
    { value: "old-legacy" }, // added before tracking, sits early in the list
    { value: "b" },
    { value: "a" },
    { value: "legacy-import" }, // unrecorded, appended late
  ];

  beforeEach(() => {
    recordAddedAt("pk1", "pubkeys", "b");
    renameAddedAt("pk1", "pubkeys", "b", "b"); // no-op guard
    // Give "a" the newest timestamp
    const map = getAddedAtMap("pk1");
    storage.setItem(
      "mutable_mute_added_at_pk1",
      JSON.stringify({
        ...map,
        "pubkeys:a": map["pubkeys:b"] + 1000,
      }),
    );
  });

  it("returns list order unchanged when requested", () => {
    expect(orderMuteItems(items, "pubkeys", "pk1", "list")).toEqual(items);
  });

  it("puts newest additions first, unrecorded items last by list position", () => {
    expect(
      orderMuteItems(items, "pubkeys", "pk1", "recent").map((i) => i.value),
    ).toEqual(["a", "b", "legacy-import", "old-legacy"]);
  });

  it("puts unrecorded items first in list order, then oldest recorded", () => {
    expect(
      orderMuteItems(items, "pubkeys", "pk1", "oldest").map((i) => i.value),
    ).toEqual(["old-legacy", "legacy-import", "b", "a"]);
  });
});
