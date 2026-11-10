/**
 * Per-relay health tracking for network-wide scans.
 *
 * Static relay lists rot: relays go dark, get throttled, or start rejecting
 * connections, and every scan pays for the dead sockets. While measuring
 * relay coverage for kind:10000 "#p" queries, four of the highest-yield
 * relays dropped to zero after repeated scans from one IP — the kind of
 * failure no curated list can predict. So scans observe connectivity per
 * relay and skip the ones that keep failing, while retrying them often
 * enough that a relay coming back is picked up again.
 *
 * Scores live in localStorage and decay: entries untouched for a week are
 * forgotten, and an unhealthy relay is retried after ten minutes rather
 * than being excluded forever. Yield (event counts) is deliberately NOT
 * part of the score — a healthy small relay legitimately returns nothing
 * for most pubkeys, so only connectivity judges a relay.
 */

const STORAGE_KEY = "mutable:relayHealth:v1";

/** Skip a relay only after this many consecutive scan failures. */
export const SKIP_AFTER_CONSECUTIVE_FAILURES = 2;

/** Re-include an unhealthy relay after this long, so it can recover. */
export const RETRY_UNHEALTHY_AFTER_MS = 10 * 60 * 1000;

/** Observations older than this are forgotten — stale scores say nothing. */
export const ENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Never filter a scan set below this many relays. */
export const MIN_SCAN_RELAYS = 8;

/** What a scan saw of one relay. Structurally compatible with RelayScanStat. */
export interface RelayScanOutcome {
  url: string;
  connected: boolean;
  events?: number;
}

interface RelayHealthEntry {
  successes: number;
  failures: number;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
}

type HealthStore = Record<string, RelayHealthEntry>;

function loadStore(now: number): HealthStore {
  if (typeof localStorage === "undefined") return {};
  let parsed: HealthStore;
  try {
    parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  // Prune entries past their TTL so the store stays small and stale
  // grudges fade.
  const fresh: HealthStore = {};
  for (const [url, entry] of Object.entries(parsed)) {
    const lastSeen = Math.max(entry.lastSuccessAt ?? 0, entry.lastFailureAt ?? 0);
    if (now - lastSeen < ENTRY_TTL_MS) fresh[url] = entry;
  }
  return fresh;
}

function saveStore(store: HealthStore): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota errors or private mode: health tracking is best-effort.
  }
}

/** Fold one scan's per-relay outcomes into the persistent scores. */
export function recordRelayScanOutcomes(
  outcomes: RelayScanOutcome[],
  now: number = Date.now(),
): void {
  if (outcomes.length === 0) return;
  const store = loadStore(now);
  for (const outcome of outcomes) {
    const entry = store[outcome.url] ?? {
      successes: 0,
      failures: 0,
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
    };
    if (outcome.connected) {
      entry.successes += 1;
      entry.consecutiveFailures = 0;
      entry.lastSuccessAt = now;
    } else {
      entry.failures += 1;
      entry.consecutiveFailures += 1;
      entry.lastFailureAt = now;
    }
    store[outcome.url] = entry;
  }
  saveStore(store);
}

/**
 * Prune a scan's relay list of the ones currently failing. Relays with no
 * observations (cold start) are always kept — the score must be earned by
 * actual failures, not assumed. Order of the input is preserved.
 */
export function filterHealthyRelays(
  relays: string[],
  now: number = Date.now(),
  minRelays: number = MIN_SCAN_RELAYS,
): string[] {
  if (relays.length <= minRelays) return relays;
  const store = loadStore(now);

  const unhealthy = new Set<string>();
  for (const relay of relays) {
    const entry = store[relay];
    if (!entry) continue;
    const recentlyFailed =
      entry.lastFailureAt !== null && now - entry.lastFailureAt < RETRY_UNHEALTHY_AFTER_MS;
    if (entry.consecutiveFailures >= SKIP_AFTER_CONSECUTIVE_FAILURES && recentlyFailed) {
      unhealthy.add(relay);
    }
  }

  const kept = relays.filter((relay) => !unhealthy.has(relay));

  // Never shrink below the floor: if nearly everything looks bad, keep the
  // least-bad relays (most recent success first) rather than scanning a
  // uselessly small set.
  const floor = Math.min(minRelays, relays.length);
  if (kept.length < floor) {
    const byLeastBad = relays
      .filter((relay) => unhealthy.has(relay))
      .sort((a, b) => {
        const ea = store[a];
        const eb = store[b];
        return (eb?.lastSuccessAt ?? 0) - (ea?.lastSuccessAt ?? 0);
      });
    for (const relay of byLeastBad) {
      if (kept.length >= floor) break;
      kept.push(relay);
    }
    // Restore the original scan order.
    kept.sort((a, b) => relays.indexOf(a) - relays.indexOf(b));
  }

  return kept;
}
