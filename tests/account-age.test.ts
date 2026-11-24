import { describe, it, expect } from "vitest";
import {
  findEarliestEvent,
  accountAgeSpan,
  formatAccountAge,
  NOSTR_EPOCH,
  type AgeEvent,
  type WindowProbe,
} from "@/lib/accountAge";

const NOW = 1795000000;

function ev(created_at: number, kind = 1, id?: string): AgeEvent {
  return {
    id: id ?? created_at.toString(16).padStart(64, "0"),
    pubkey: "a".repeat(64),
    kind,
    created_at,
    content: `note at ${created_at}`,
  };
}

/** A relay that honors since/until/limit, newest first. */
function corpusProbe(events: AgeEvent[], calls?: { n: number }): WindowProbe {
  const sorted = [...events].sort((a, b) => b.created_at - a.created_at);
  return async (since, until, limit) => {
    if (calls) calls.n += 1;
    return sorted
      .filter((e) => e.created_at >= since && e.created_at <= until)
      .slice(0, limit);
  };
}

describe("findEarliestEvent", () => {
  it("returns null for a key with no events", async () => {
    expect(await findEarliestEvent(corpusProbe([]), { hi: NOW })).toBeNull();
  });

  it("finds the oldest of a long history without fetching it all", async () => {
    const events = Array.from({ length: 5000 }, (_, i) =>
      ev(1650000000 + i * 25000),
    );
    const calls = { n: 0 };
    const found = await findEarliestEvent(corpusProbe(events, calls), {
      hi: NOW,
    });
    expect(found?.created_at).toBe(1650000000);
    expect(calls.n).toBeLessThan(60);
  });

  it("finds a lone early event far from the rest", async () => {
    const events = [ev(1612345678), ...Array.from({ length: 50 }, (_, i) => ev(1780000000 + i))];
    const found = await findEarliestEvent(corpusProbe(events), { hi: NOW });
    expect(found?.created_at).toBe(1612345678);
  });

  it("resolves a burst of events inside the final window exactly", async () => {
    const events = Array.from({ length: 40 }, (_, i) => ev(1700000000 + i * 10));
    const found = await findEarliestEvent(corpusProbe(events), { hi: NOW });
    expect(found?.created_at).toBe(1700000000);
  });

  it("ignores events backdated before Nostr existed", async () => {
    const events = [ev(NOSTR_EPOCH - 86400 * 365), ev(1700000000)];
    const found = await findEarliestEvent(corpusProbe(events), { hi: NOW });
    expect(found?.created_at).toBe(1700000000);
  });

  it("ignores events dated in the future", async () => {
    const events = [ev(NOW + 86400 * 30), ev(1700000000)];
    const found = await findEarliestEvent(corpusProbe(events), { hi: NOW });
    expect(found?.created_at).toBe(1700000000);
  });

  it("is not thrown off by a source that ignores since/until", async () => {
    const honest = corpusProbe([ev(1640000000), ev(1760000000)]);
    const sloppy: WindowProbe = async (since, until, limit) => [
      ev(1790000000), // always the newest, whatever was asked
      ...(await honest(since, until, limit)),
    ];
    const found = await findEarliestEvent(sloppy, { hi: NOW });
    expect(found?.created_at).toBe(1640000000);
  });

  it("respects a lower bound", async () => {
    const events = [ev(1640000000), ev(1700000000), ev(1750000000)];
    const found = await findEarliestEvent(corpusProbe(events), {
      lo: 1690000000,
      hi: NOW,
    });
    expect(found?.created_at).toBe(1700000000);
  });
});

describe("accountAgeSpan / formatAccountAge", () => {
  const at = (iso: string) => Date.parse(iso) / 1000;

  it("counts whole years and months", () => {
    const span = accountAgeSpan(at("2022-12-14T02:17:57Z"), at("2026-11-24T12:00:00Z"));
    expect(span.years).toBe(3);
    expect(span.months).toBe(11);
    expect(formatAccountAge(span)).toBe("3 yrs 11 mo");
  });

  it("does not count a month until its day is reached", () => {
    const span = accountAgeSpan(at("2025-01-20T00:00:00Z"), at("2025-03-10T00:00:00Z"));
    expect(span.years).toBe(0);
    expect(span.months).toBe(1);
  });

  it("falls back to days for brand-new keys", () => {
    expect(
      formatAccountAge(accountAgeSpan(at("2026-11-20T00:00:00Z"), at("2026-11-24T00:00:00Z"))),
    ).toBe("4 days");
    expect(
      formatAccountAge(accountAgeSpan(at("2026-11-23T00:00:00Z"), at("2026-11-24T00:00:00Z"))),
    ).toBe("1 day");
  });

  it("uses singular year", () => {
    expect(
      formatAccountAge(accountAgeSpan(at("2025-11-01T00:00:00Z"), at("2026-11-24T00:00:00Z"))),
    ).toBe("1 yr");
  });
});
