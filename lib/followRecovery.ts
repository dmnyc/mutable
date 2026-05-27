/**
 * Follow List Recovery
 *
 * Opt-in tool that scans a user's relays (plus a broad archival set) for
 * historical kind:3 follow list events and lets the user republish a
 * previously-overwritten version. The "largest most-recent non-empty" version
 * is highlighted as the recommended pick, since cross-client kind:3
 * overwrites are the most common way a follow graph gets clobbered.
 *
 * Core logic is intentionally kept free of React / Zustand imports so it
 * can be ported to other clients (e.g. Plebs vs Zombies, Vue).
 */

import { SimplePool, Event, EventTemplate, VerifiedEvent } from "nostr-tools";
import { FOLLOW_LIST_KIND } from "@/types";
import {
  DEFAULT_RELAYS,
  KNOWN_RELAYS,
  getPool,
  normalizeRelayList,
  signEvent,
} from "@/lib/nostr";

export interface FollowListCandidate {
  /** The raw kind:3 event */
  event: Event;
  /** Hex event id (mirror of event.id, exposed for convenience) */
  eventId: string;
  /** Unix seconds when this version was published */
  createdAt: number;
  /** Number of pubkeys followed (count of `p` tags) */
  followCount: number;
  /** Pubkeys followed, in original tag order */
  followPubkeys: string[];
  /** Relays where this exact event id was observed */
  foundOnRelays: string[];
  /** True if this is the most-recent event seen during the scan */
  isCurrent: boolean;
  /** True if this is the recommended recovery pick */
  isRecommended: boolean;
}

export interface FollowRecoveryScanResult {
  /** The candidate considered "current" (most recent by created_at) */
  current: FollowListCandidate | null;
  /** All distinct kind:3 events observed, sorted by created_at DESC */
  candidates: FollowListCandidate[];
  /** The recommended recovery candidate, if any improves on current */
  recommended: FollowListCandidate | null;
  /** Relays that were queried */
  queriedRelays: string[];
  /** Relays that returned at least one kind:3 event */
  respondingRelays: string[];
}

export interface ScanOptions {
  /** Per-relay query timeout in ms (default 6000) */
  timeoutMs?: number;
  /** Additional relays to include beyond the user's relays + defaults */
  extraRelays?: string[];
  /** Optional progress reporter (called with a human-readable status string) */
  onProgress?: (message: string) => void;
}

/** Extract the pubkeys followed in original tag order. */
function extractFollowPubkeys(event: Event): string[] {
  return event.tags
    .filter((tag) => tag[0] === "p" && typeof tag[1] === "string" && tag[1])
    .map((tag) => tag[1]);
}

/** Query a single relay for a user's kind:3 events with a timeout. */
async function queryRelayForFollowEvents(
  pool: SimplePool,
  relay: string,
  pubkey: string,
  timeoutMs: number,
): Promise<Event[]> {
  try {
    const events = await Promise.race([
      pool.querySync([relay], {
        kinds: [FOLLOW_LIST_KIND],
        authors: [pubkey],
        limit: 10,
      }),
      new Promise<Event[]>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Relay query timeout: ${relay}`)),
          timeoutMs,
        ),
      ),
    ]);
    return events;
  } catch {
    return [];
  }
}

/**
 * Rank candidates so the "most-recent largest" non-empty version sorts first.
 *
 * Sort order:
 *   1. followCount DESC (largest first)
 *   2. createdAt DESC  (newer wins ties)
 *
 * Tombstones (zero follows) are kept in the result but never recommended.
 */
export function rankFollowListCandidates(
  candidates: FollowListCandidate[],
): FollowListCandidate[] {
  return [...candidates].sort((a, b) => {
    if (b.followCount !== a.followCount) return b.followCount - a.followCount;
    return b.createdAt - a.createdAt;
  });
}

/**
 * Pick a recovery candidate.
 *
 * Recommends the highest-ranked non-empty candidate that is *strictly
 * larger* than the current effective list. If the current list is already
 * the largest, returns null (recovery isn't useful). If no current event
 * exists at all, recommends the largest non-empty candidate.
 */
export function pickRecommendedRecovery(
  candidates: FollowListCandidate[],
  current: FollowListCandidate | null,
): FollowListCandidate | null {
  const ranked = rankFollowListCandidates(candidates).filter(
    (c) => c.followCount > 0,
  );
  if (ranked.length === 0) return null;

  const currentCount = current?.followCount ?? 0;
  const currentId = current?.eventId ?? null;

  for (const candidate of ranked) {
    if (candidate.eventId === currentId) continue;
    if (candidate.followCount > currentCount) return candidate;
  }

  return null;
}

/**
 * Scan the user's relays plus a broad set of archival relays for historical
 * kind:3 events. Returns every distinct version observed and highlights the
 * best recovery candidate.
 */
export async function scanFollowListHistory(
  pubkey: string,
  userRelays: string[] = DEFAULT_RELAYS,
  options: ScanOptions = {},
): Promise<FollowRecoveryScanResult> {
  const { timeoutMs = 6000, extraRelays = [], onProgress } = options;
  const pool = getPool();

  const relays = normalizeRelayList([
    ...userRelays,
    ...DEFAULT_RELAYS,
    ...KNOWN_RELAYS,
    ...extraRelays,
  ]);

  onProgress?.(`Querying ${relays.length} relays for follow list history…`);

  // Per-relay parallel queries so we know which relays returned which event ids.
  // pool.querySync over many relays would dedup but lose that attribution.
  const respondingRelays: string[] = [];
  const candidatesById = new Map<string, FollowListCandidate>();

  await Promise.all(
    relays.map(async (relay) => {
      const events = await queryRelayForFollowEvents(
        pool,
        relay,
        pubkey,
        timeoutMs,
      );
      if (events.length > 0) respondingRelays.push(relay);

      for (const event of events) {
        const followPubkeys = extractFollowPubkeys(event);
        let entry = candidatesById.get(event.id);
        if (!entry) {
          entry = {
            event,
            eventId: event.id,
            createdAt: event.created_at,
            followCount: followPubkeys.length,
            followPubkeys,
            foundOnRelays: [],
            isCurrent: false,
            isRecommended: false,
          };
          candidatesById.set(event.id, entry);
        }
        if (!entry.foundOnRelays.includes(relay)) {
          entry.foundOnRelays.push(relay);
        }
      }
    }),
  );

  const allCandidates = Array.from(candidatesById.values()).sort(
    (a, b) => b.createdAt - a.createdAt,
  );

  const current = allCandidates[0] ?? null;
  if (current) current.isCurrent = true;

  const recommended = pickRecommendedRecovery(allCandidates, current);
  if (recommended) recommended.isRecommended = true;

  onProgress?.(
    `Found ${allCandidates.length} distinct version${allCandidates.length === 1 ? "" : "s"} across ${respondingRelays.length}/${relays.length} relays.`,
  );

  return {
    current,
    candidates: allCandidates,
    recommended,
    queriedRelays: relays,
    respondingRelays,
  };
}

/**
 * Republish a candidate kind:3 event as the user's current follow list.
 *
 * Preserves the original `p` tag ordering (and any per-tag metadata like
 * relay hints / petnames). Strips any non-`p` tags for safety; we only want
 * to restore the follow set, not unrelated tags that may be in old events.
 * `content` (legacy relay metadata JSON) is preserved verbatim.
 *
 * The user MUST be signed in — the active signer is read from the store
 * via `signEvent`.
 */
export async function recoverFollowList(
  candidate: FollowListCandidate,
  relays: string[] = DEFAULT_RELAYS,
  publishTimeoutMs: number = 15000,
): Promise<VerifiedEvent> {
  const preservedTags = candidate.event.tags.filter(
    (tag) => tag[0] === "p" && typeof tag[1] === "string" && tag[1],
  );

  const template: EventTemplate = {
    kind: FOLLOW_LIST_KIND,
    tags: preservedTags,
    content: candidate.event.content ?? "",
    created_at: Math.floor(Date.now() / 1000),
  };

  const signed = await signEvent(template);
  const pool = getPool();

  const publishPromise = Promise.any(pool.publish(relays, signed));
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("Publish timeout: no relay responded in time")),
      publishTimeoutMs,
    ),
  );
  await Promise.race([publishPromise, timeoutPromise]);

  return signed;
}
