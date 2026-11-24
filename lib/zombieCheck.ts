import { nip19 } from "nostr-tools";
import type { Event as NostrEvent, Filter } from "nostr-tools";
import {
  getPool,
  DEFAULT_RELAYS,
  KNOWN_RELAYS,
  normalizeRelayList,
  fetchRelayListFromNostr,
} from "@/lib/nostr";

// Ported from Plebs vs. Zombies' Zombie Check (plebsvszombies.cc/zombiecheck).
// A single-account, read-only liveness lookup: any event the subject signed
// proves their key is still in use, so activity queries deliberately omit
// `kinds` and match everything. Narrowing to a handful of "social" kinds was
// the main source of false positives in the original — quiet reactors and
// mute-list editors looked dead when they weren't.
const LIVENESS_KINDS = [
  0, 1, 3, 4, 5, 6, 7, 8, 16, 20, 40, 41, 42, 1063, 1068, 1111, 1311, 1617,
  1621, 1984, 1985, 9734, 9802, 10000, 10001, 10002, 10003, 10015, 10030,
  30000, 30001, 30002, 30003, 30008, 30009, 30017, 30018, 30023, 30024, 30078,
  30311, 30315, 30402, 30617, 30618, 31922, 31923, 31924, 31925, 31989, 31990,
  34235, 34550,
];

// Below this many days the verdict is already "Alive" and no further relay
// can improve it, so the deep scan stops early.
const ALIVE_DAYS = 60;

// Days after which an account counts as a zombie (Plebs vs. Zombies defaults).
const FRESH_DAYS = 90;
const ROTTING_DAYS = 180;
const ANCIENT_DAYS = 365;

// Display-only: the classifier lumps everyone under 120 days into "active";
// anyone quiet for 2+ months gets the softer "possible infection" warning.
const INFECTION_DAYS = 60;

// High-retention public relays, scanned only when the verdict is still
// unsettled. They keep events long after the defaults have pruned them, so
// an account that looks years-dead on the defaults sometimes has recent
// activity here.
const DEEP_SCAN_RELAYS = [
  "wss://soloco.nl",
  "wss://atlas.nostr.land",
  "wss://relay.ditto.pub",
];

export type ZombieCategory =
  | "burned"
  | "ancient"
  | "rotting"
  | "fresh"
  | "infected"
  | "active";

export type DeletionState = "current" | "past" | "none";

export interface ZombieCheckResult {
  pubkey: string;
  npub: string;
  name: string | null;
  displayName: string | null;
  picture: string | null;
  nip05: string | null;
  category: ZombieCategory;
  daysSinceActivity: number | null;
  lastActivity: number | null;
  deletion: { state: DeletionState; markedAt: number | null };
  relaysQueried: number;
}

interface ProfileMeta {
  name: string | null;
  displayName: string | null;
  picture: string | null;
  nip05: string | null;
  deleted: boolean;
  /** When the currently-standing deletion flag was first marked, if any. */
  markedDeletedAt: number | null;
  /** Whether any profile event in the fetched history ever set deleted=true. */
  everMarkedDeleted: boolean;
  firstMarkedDeletedAt: number | null;
}

interface LivenessEvent {
  id: string;
  created_at: number;
  kind: number;
}

export type ZombieCheckProgress = (stage: string) => void;

const daysSince = (ts: number) =>
  Math.floor((Date.now() / 1000 - ts) / 86400);

const describeNewest = (events: LivenessEvent[]) => {
  if (!events.length) return "nothing yet";
  const days = daysSince(
    Math.max(...events.map((e) => e.created_at)),
  );
  if (days < 1) return "newest today";
  if (days < 30) return `newest ${days} day${days === 1 ? "" : "s"} ago`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `newest ${months} month${months === 1 ? "" : "s"} ago`;
  }
  const years = Math.floor(days / 365);
  return `newest ${years} year${years === 1 ? "" : "s"} ago`;
};

/**
 * Most recent events authored by `pubkey`, any kind. Subscribes rather than
 * querySync so progress can report while slow relays are still answering,
 * and finishes bounded by `maxWaitMs` (used as each relay's EOSE timeout).
 */
function fetchLivenessEvents(
  pubkey: string,
  relays: string[],
  maxWaitMs: number,
  onProgress?: (found: number, newest: string) => void,
): Promise<{ events: LivenessEvent[]; answered: boolean }> {
  const run = (filter: Filter) =>
    new Promise<{ events: LivenessEvent[]; answered: boolean }>((resolve) => {
      const collected = new Map<string, LivenessEvent>();
      // subscribeManyEose closes itself once every relay has answered (or
      // hit the maxWait EOSE timeout), and onclose then carries one reason
      // per relay — "closed automatically on eose" means the relay actually
      // answered; anything else (connect failure, auth error) counts as
      // silence for the reachable check.
      getPool().subscribeManyEose(relays, filter, {
        maxWait: maxWaitMs,
        onevent(event) {
          if (collected.has(event.id)) return;
          collected.set(event.id, {
            id: event.id,
            created_at: event.created_at,
            kind: event.kind,
          });
          onProgress?.(collected.size, describeNewest([...collected.values()]));
        },
        onclose(reasons) {
          resolve({
            events: [...collected.values()].sort(
              (a, b) => b.created_at - a.created_at,
            ),
            answered: reasons.some((r) => /eose/i.test(r)),
          });
        },
      });
    });

  return run({ authors: [pubkey], limit: 10 }).then((first) => {
    if (first.events.length > 0) return first;
    // Fallback: explicit kinds for relays that mishandle kind-less filters —
    // an empty result here is exactly what produces a false zombie.
    return run({ authors: [pubkey], limit: 10, kinds: LIVENESS_KINDS });
  });
}

/**
 * Deep single-user activity lookup. Resolves the subject's own NIP-65 relay
 * list and queries it alongside the defaults, so someone who only publishes
 * to a niche relay isn't reported as a zombie just because the default
 * relays never saw them. Escalates only while the verdict could still
 * change — activity already inside the "alive" band can't be improved on.
 *
 * Read-only by design: no signer is ever touched, so the check works the
 * same signed out as signed in.
 */
async function getProfileActivityDeep(
  pubkey: string,
  onProgress: ZombieCheckProgress,
): Promise<{ events: LivenessEvent[]; relaysQueried: number; reachable: boolean }> {
  const newestDays = (events: LivenessEvent[]) =>
    events.length === 0
      ? null
      : daysSince(Math.max(...events.map((e) => e.created_at)));

  onProgress(
    `Searching ${DEFAULT_RELAYS.length} default relays…`,
  );
  const [pass1, relayList] = await Promise.all([
    fetchLivenessEvents(pubkey, DEFAULT_RELAYS, 10000, (found, newest) => {
      onProgress(
        `Searching default relays — ${found} event${found === 1 ? "" : "s"}, ${newest}`,
      );
    }).catch(() => ({ events: [] as LivenessEvent[], answered: false })),
    fetchRelayListFromNostr(pubkey).catch(() => ({
      writeRelays: [] as string[],
      metadata: null,
    })),
  ]);

  let results = pass1.events;
  let reachable = pass1.answered;
  const queriedCount = DEFAULT_RELAYS.length;

  const extraRelays = normalizeRelayList([
    ...(relayList.metadata?.read ?? []),
    ...(relayList.metadata?.write ?? []),
    ...relayList.writeRelays,
  ]).filter((url) => !DEFAULT_RELAYS.includes(url));

  const days = newestDays(results);
  if (days !== null && days < ALIVE_DAYS) {
    onProgress(`Active ${days} day${days === 1 ? "" : "s"} ago — done.`);
    return { events: results, relaysQueried: queriedCount, reachable: true };
  }

  const scanExtra = async (
    relays: string[],
    label: string,
  ): Promise<LivenessEvent[]> => {
    if (relays.length === 0) return [];
    onProgress(`Checking ${relays.length} ${label}…`);
    const res = await fetchLivenessEvents(pubkey, relays, 6000, (found, newest) => {
      onProgress(`Checking ${label} — ${found} event${found === 1 ? "" : "s"}, ${newest}`);
    }).catch(() => ({ events: [] as LivenessEvent[], answered: false }));
    reachable = reachable || res.answered;
    // Disconnect the sockets this pass opened so they don't linger.
    getPool().close(relays);
    return res.events;
  };

  if (extraRelays.length > 0) {
    const events = await scanExtra(
      extraRelays,
      "relays from their relay list",
    );
    results = [...results, ...events];
  }

  const daysNow = newestDays(results);
  if (daysNow === null || daysNow >= ALIVE_DAYS) {
    const deepRelays = DEEP_SCAN_RELAYS.filter(
      (url) => !DEFAULT_RELAYS.includes(url) && !extraRelays.includes(url),
    );
    const events = await scanExtra(deepRelays, "high-retention relays");
    results = [...results, ...events];
  }

  const byId = new Map<string, LivenessEvent>();
  for (const event of results) byId.set(event.id, event);
  const merged = [...byId.values()]
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 10);

  return {
    events: merged,
    relaysQueried: queriedCount + extraRelays.length,
    reachable: reachable || merged.length > 0,
  };
}

const safeParse = (content: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

/**
 * Fetch every kind:0 event we can find for the subject and read the
 * deletion history out of it: whether the profile is currently flagged
 * deleted, and whether a past deletion request was later reversed (e.g. by
 * a profile restore) — relays prune events from inactive accounts, which is
 * exactly the population this check inspects, so the archival relay tail is
 * tried when the defaults come up empty.
 */
async function fetchProfileMeta(pubkey: string): Promise<ProfileMeta> {
  const empty: ProfileMeta = {
    name: null,
    displayName: null,
    picture: null,
    nip05: null,
    deleted: false,
    markedDeletedAt: null,
    everMarkedDeleted: false,
    firstMarkedDeletedAt: null,
  };

  const fetchProfiles = (relays: string[]) =>
    new Promise<NostrEvent[]>((resolve) => {
      const collected = new Map<string, NostrEvent>();
      getPool().subscribeManyEose(relays, { kinds: [0], authors: [pubkey], limit: 100 }, {
        maxWait: 8000,
        onevent(event) {
          collected.set(event.id, event);
        },
        onclose() {
          resolve([...collected.values()]);
        },
      });
    });

  let events = await fetchProfiles(DEFAULT_RELAYS).catch(() => []);
  if (events.length === 0) {
    const archive = KNOWN_RELAYS.filter((r) => !DEFAULT_RELAYS.includes(r));
    events = await fetchProfiles(archive).catch(() => []);
    getPool().close(archive);
  }
  if (events.length === 0) return empty;

  events.sort((a, b) => b.created_at - a.created_at);

  const profiles = events
    .map((e) => ({ ts: e.created_at, parsed: safeParse(e.content) }))
    .filter((p): p is { ts: number; parsed: Record<string, unknown> } =>
      Boolean(p.parsed),
    );
  if (profiles.length === 0) return empty;

  const latest = profiles[0].parsed;
  const deleted =
    latest.deleted === true || latest.deleted === "true";

  let markedDeletedAt: number | null = null;
  if (deleted) {
    for (let i = profiles.length - 1; i >= 0; i--) {
      if (profiles[i].parsed.deleted === true || profiles[i].parsed.deleted === "true") {
        markedDeletedAt = profiles[i].ts;
        break;
      }
    }
  }

  let everMarkedDeleted = deleted;
  let firstMarkedDeletedAt = markedDeletedAt;
  if (!deleted) {
    for (const p of profiles) {
      if (p.parsed.deleted === true || p.parsed.deleted === "true") {
        everMarkedDeleted = true;
        if (firstMarkedDeletedAt === null || p.ts < firstMarkedDeletedAt) {
          firstMarkedDeletedAt = p.ts;
        }
      }
    }
  }

  return {
    name: typeof latest.name === "string" ? latest.name : null,
    displayName:
      typeof latest.display_name === "string"
        ? latest.display_name
        : typeof latest.displayName === "string"
          ? latest.displayName
          : null,
    picture: typeof latest.picture === "string" ? latest.picture : null,
    nip05: typeof latest.nip05 === "string" ? latest.nip05 : null,
    deleted,
    markedDeletedAt,
    everMarkedDeleted,
    firstMarkedDeletedAt,
  };
}

function classify(
  events: LivenessEvent[],
  meta: ProfileMeta,
): { category: ZombieCategory; days: number | null } {
  // Cross-validate: an account active within the last week after marking
  // itself deleted was almost certainly not really deleted — fall through to
  // the activity-based verdict instead of reporting Burned.
  if (meta.deleted) {
    const last = events[0]?.created_at;
    const activeAfterDeletion =
      last != null &&
      (meta.markedDeletedAt == null || last > meta.markedDeletedAt);
    if (!activeAfterDeletion || daysSince(last) >= 7) {
      return { category: "burned", days: last != null ? daysSince(last) : null };
    }
  }

  if (events.length === 0) {
    return { category: "ancient", days: null };
  }

  const days = daysSince(events[0].created_at);
  // Ultra conservative: any activity within 120 days is "active" so no false
  // positives slip into the hunt.
  if (days < 120) {
    // Display-only refinement: anyone quiet for 2+ months gets the softer
    // "possible infection" warning rather than a clean bill of health.
    return { category: days >= INFECTION_DAYS ? "infected" : "active", days };
  }
  if (days >= ANCIENT_DAYS) return { category: "ancient", days };
  if (days >= ROTTING_DAYS) return { category: "rotting", days };
  if (days >= FRESH_DAYS) return { category: "fresh", days };
  return { category: "active", days };
}

/** "1 year, 2 months" style duration for the verdict detail line. */
export function formatGone(days: number | null): string | null {
  if (days == null) return null;
  if (days < 1) return "less than a day";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  const years = Math.floor(days / 365);
  const remMonths = Math.floor((days % 365) / 30);
  const yearStr = `${years} year${years === 1 ? "" : "s"}`;
  return remMonths > 0
    ? `${yearStr}, ${remMonths} month${remMonths === 1 ? "" : "s"}`
    : yearStr;
}

/**
 * Check whether any Nostr user is a zombie and see how long they've been
 * gone. Accepts an npub, nprofile or hex pubkey; read-only, so it works
 * identically for signed-in and signed-out visitors.
 */
export async function checkZombie(
  identifier: string,
  onProgress: ZombieCheckProgress = () => {},
): Promise<ZombieCheckResult> {
  const query = identifier.trim();

  let pubkey: string;
  if (/^[0-9a-f]{64}$/i.test(query)) {
    pubkey = query.toLowerCase();
  } else {
    const decoded = nip19.decode(query);
    if (decoded.type === "npub") pubkey = decoded.data as string;
    else if (decoded.type === "nprofile")
      pubkey = (decoded.data as { pubkey: string }).pubkey;
    else throw new Error("Not a valid npub or pubkey.");
  }

  onProgress("Resolving profile…");
  const [activity, meta] = await Promise.all([
    getProfileActivityDeep(pubkey, onProgress),
    fetchProfileMeta(pubkey),
  ]);

  // No relay answered — that's a network failure, not a dead account.
  // Reporting a zombie here would be a false positive.
  if (!activity.reachable) {
    throw new Error(
      "Could not reach any relay to check this user. Check your connection and try again.",
    );
  }

  const { category, days } = classify(activity.events, meta);

  let npub: string;
  try {
    npub = nip19.npubEncode(pubkey);
  } catch {
    npub = "";
  }

  return {
    pubkey,
    npub,
    name: meta.name,
    displayName: meta.displayName,
    picture: meta.picture,
    nip05: meta.nip05,
    category,
    daysSinceActivity: days,
    lastActivity: activity.events[0]?.created_at ?? null,
    deletion: {
      state: meta.deleted ? "current" : meta.everMarkedDeleted ? "past" : "none",
      markedAt: meta.deleted
        ? meta.markedDeletedAt
        : meta.firstMarkedDeletedAt,
    },
    relaysQueried: activity.relaysQueried,
  };
}
