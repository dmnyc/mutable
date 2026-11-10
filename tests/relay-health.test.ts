import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  recordRelayScanOutcomes,
  filterHealthyRelays,
  RETRY_UNHEALTHY_AFTER_MS,
} from "@/lib/relayHealth";

const BASE = 1_700_000_000_000;

function relay(n: number): string {
  return `wss://relay${n}.example`;
}

function relaySet(count: number): string[] {
  return Array.from({ length: count }, (_, i) => relay(i));
}

function scan(url: string, connected: boolean, events = 0) {
  return { url, connected, events };
}

function memoryLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryLocalStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("filterHealthyRelays", () => {
  it("keeps relays with no history (cold start is neutral)", () => {
    const relays = relaySet(10);
    expect(filterHealthyRelays(relays, BASE)).toEqual(relays);
  });

  it("keeps a relay after a single failure", () => {
    recordRelayScanOutcomes([scan(relay(0), false)], BASE);
    expect(filterHealthyRelays(relaySet(10), BASE + 1000)).toContain(relay(0));
  });

  it("skips a relay after consecutive failures", () => {
    recordRelayScanOutcomes([scan(relay(0), false)], BASE);
    recordRelayScanOutcomes([scan(relay(0), false)], BASE + 5000);
    const filtered = filterHealthyRelays(relaySet(10), BASE + 6000);
    expect(filtered).not.toContain(relay(0));
    expect(filtered).toHaveLength(9);
  });

  it("a success resets the failure streak", () => {
    recordRelayScanOutcomes([scan(relay(0), false)], BASE);
    recordRelayScanOutcomes([scan(relay(0), true, 3)], BASE + 5000);
    recordRelayScanOutcomes([scan(relay(0), false)], BASE + 9000);
    // Only one consecutive failure since the success: still included.
    expect(filterHealthyRelays(relaySet(10), BASE + 10_000)).toContain(relay(0));
  });

  it("re-includes an unhealthy relay once the retry window passes", () => {
    recordRelayScanOutcomes([scan(relay(0), false)], BASE);
    recordRelayScanOutcomes([scan(relay(0), false)], BASE + 5000);
    const later = BASE + 5000 + RETRY_UNHEALTHY_AFTER_MS + 1000;
    expect(filterHealthyRelays(relaySet(10), later)).toContain(relay(0));
  });

  it("ignores event counts — a connected relay with zero events is healthy", () => {
    recordRelayScanOutcomes([scan(relay(0), true, 0)], BASE);
    expect(filterHealthyRelays(relaySet(10), BASE + 1000)).toContain(relay(0));
  });

  it("never filters below the floor, preferring least-bad relays", () => {
    const relays = relaySet(10);
    // relay(9) failed once long ago (has an old success); everyone else
    // failed twice just now.
    recordRelayScanOutcomes(
      relays.map((url) => scan(url, url === relay(9), url === relay(9) ? 5 : 0)),
      BASE,
    );
    recordRelayScanOutcomes(
      relays.filter((url) => url !== relay(9)).map((url) => scan(url, false)),
      BASE + 5000,
    );
    const filtered = filterHealthyRelays(relays, BASE + 6000);
    expect(filtered).toHaveLength(8);
    // relay(9) is the only one with a success; it must survive the floor.
    expect(filtered).toContain(relay(9));
  });

  it("preserves input order", () => {
    const relays = relaySet(10);
    recordRelayScanOutcomes([scan(relay(2), false), scan(relay(5), false)], BASE);
    recordRelayScanOutcomes([scan(relay(2), false), scan(relay(5), false)], BASE + 1000);
    const filtered = filterHealthyRelays(relays, BASE + 2000);
    expect(filtered).toEqual(
      relays.filter((url) => url !== relay(2) && url !== relay(5)),
    );
  });
});

describe("recordRelayScanOutcomes persistence", () => {
  it("persists across calls via localStorage", () => {
    recordRelayScanOutcomes([scan(relay(0), false)], BASE);
    recordRelayScanOutcomes([scan(relay(0), false)], BASE + 1000);
    // A fresh call re-reads the store; the streak continues.
    expect(filterHealthyRelays(relaySet(10), BASE + 2000)).not.toContain(relay(0));
  });

  it("is a no-op without localStorage (SSR)", () => {
    vi.unstubAllGlobals();
    expect(() =>
      recordRelayScanOutcomes([scan(relay(0), false)], BASE),
    ).not.toThrow();
    expect(filterHealthyRelays(relaySet(10), BASE)).toEqual(relaySet(10));
  });
});
