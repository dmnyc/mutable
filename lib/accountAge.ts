/**
 * Finding the oldest event a key ever published.
 *
 * Relays return newest-first and NIP-01 has no "oldest first" option, so
 * paging back through someone's whole history to find the minimum can take
 * thousands of events. Instead we search the time axis: ask "is there
 * anything between `lo` and `cut`?" with limit 1 at a few cut points at once,
 * keep the narrowest window that still holds an event, and repeat until the
 * window is small enough to fetch outright.
 *
 * The probe is injected so this file stays free of network code and can be
 * tested against a fake corpus.
 */

/** 2020-11-01 UTC. Nostr's first events date from late 2020; anything earlier is backdated. */
export const NOSTR_EPOCH = 1604188800;

export interface AgeEvent {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  content: string;
}

/**
 * Returns events by the subject with `since <= created_at <= until`, newest
 * first, up to `limit` per source. Extra or out-of-window events are fine:
 * the search filters them itself.
 */
export type WindowProbe = (
  since: number,
  until: number,
  limit: number,
) => Promise<AgeEvent[]>;

export interface EarliestSearchOptions {
  /** Lower bound (inclusive). Defaults to NOSTR_EPOCH. */
  lo?: number;
  /** Upper bound (inclusive). Defaults to now. */
  hi?: number;
  /** Parallel cut points per round. */
  fanout?: number;
  /** Stop narrowing once the window is this many seconds wide. */
  resolution?: number;
  /** Limit for the final fetch of the narrowed window. */
  finalLimit?: number;
}

export async function findEarliestEvent(
  probe: WindowProbe,
  options: EarliestSearchOptions = {},
): Promise<AgeEvent | null> {
  const {
    fanout = 4,
    resolution = 3600,
    finalLimit = 500,
  } = options;
  let lo = Math.max(options.lo ?? NOSTR_EPOCH, NOSTR_EPOCH);
  let hi = options.hi ?? Math.floor(Date.now() / 1000);
  if (hi < lo) return null;

  let best: AgeEvent | null = null;
  // Only trust events inside the window we asked for: a relay that ignores
  // since/until would otherwise drag the bounds around.
  const hitsIn = (events: AgeEvent[], since: number, until: number) =>
    events.filter((e) => e.created_at >= since && e.created_at <= until);
  const consider = (events: AgeEvent[]) => {
    for (const e of events) {
      if (
        !best ||
        e.created_at < best.created_at ||
        (e.created_at === best.created_at && e.id < best.id)
      ) {
        best = e;
      }
    }
  };

  consider(hitsIn(await probe(lo, hi, 1), lo, hi));
  if (!best) return null;
  hi = (best as AgeEvent).created_at;

  while (hi - lo > resolution) {
    const step = (hi - lo) / (fanout + 1);
    const cuts = Array.from({ length: fanout }, (_, i) =>
      Math.floor(lo + step * (i + 1)),
    );
    const windowLo = lo;
    const results = await Promise.all(
      cuts.map(async (cut) => hitsIn(await probe(windowLo, cut, 1), windowLo, cut)),
    );

    // [lo, cut] windows nest, so everything below the first non-empty cut is
    // known to be empty.
    let newLo = lo;
    for (let i = 0; i < cuts.length; i++) {
      if (results[i].length > 0) break;
      newLo = cuts[i];
    }
    for (const hits of results) consider(hits);
    hi = (best as AgeEvent).created_at;
    lo = Math.min(newLo, hi);
  }

  consider(hitsIn(await probe(lo, hi, finalLimit), lo, hi));
  return best;
}

export interface AccountAgeSpan {
  years: number;
  months: number;
  days: number;
}

/** Calendar difference between two unix times, for "3 yrs 2 mo" labels. */
export function accountAgeSpan(from: number, to: number): AccountAgeSpan {
  const a = new Date(from * 1000);
  const b = new Date(to * 1000);
  let months =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  months = Math.max(0, months);
  const anchor = Date.UTC(
    a.getUTCFullYear(),
    a.getUTCMonth() + months,
    a.getUTCDate(),
    a.getUTCHours(),
    a.getUTCMinutes(),
    a.getUTCSeconds(),
  );
  const days = Math.max(0, Math.floor((b.getTime() - anchor) / 86400000));
  return { years: Math.floor(months / 12), months: months % 12, days };
}

export function formatAccountAge(span: AccountAgeSpan): string {
  const parts: string[] = [];
  if (span.years > 0) parts.push(`${span.years} ${span.years === 1 ? "yr" : "yrs"}`);
  if (span.months > 0) parts.push(`${span.months} mo`);
  if (parts.length === 0) {
    return `${span.days} ${span.days === 1 ? "day" : "days"}`;
  }
  return parts.join(" ");
}
