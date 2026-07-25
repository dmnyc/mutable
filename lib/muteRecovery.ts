/**
 * Mute List Recovery
 *
 * Opt-in tool that scans a user's relays (plus a broad archival set) for
 * historical kind:10000 mute list events and lets the user republish a
 * previously-overwritten version. The "largest most-recent non-empty"
 * version is highlighted as the recommended pick, mirroring Follow List
 * Recovery — cross-client kind:10000 overwrites are just as common a way
 * for a mute list to get clobbered.
 *
 * Mute lists can carry private (encrypted) items in `content` in addition
 * to public items in `tags`. Ranking uses the fully-decrypted item count
 * when the active signer can decrypt the candidate's content; otherwise it
 * falls back to the public-tag count and flags the candidate as
 * partially-counted so the UI can warn the user.
 *
 * Core logic is intentionally kept free of React / Zustand imports so it
 * can be ported to other clients. It does rely on `parseMuteListEvent` from
 * `@/lib/nostr`, which reads the active signer from the store to decrypt
 * private mutes — this mirrors how `signEvent` is already used the same way
 * by Follow List Recovery.
 */

import { SimplePool, Event, EventTemplate } from "nostr-tools";
import { MUTE_LIST_KIND } from "@/types";
import {
  DEFAULT_RELAYS,
  KNOWN_RELAYS,
  getPool,
  normalizeRelayList,
  signEvent,
  parseMuteListEvent,
} from "@/lib/nostr";

/** NIP-51 mute list tag types we preserve verbatim when republishing. */
const MUTE_TAG_TYPES = new Set(["p", "word", "t", "e"]);

export interface MuteListCandidate {
  /** The raw kind:10000 event */
  event: Event;
  /** Hex event id (mirror of event.id, exposed for convenience) */
  eventId: string;
  /** Unix seconds when this version was published */
  createdAt: number;
  /** Count of public mute items (from tags) */
  publicCount: number;
  /** Count of private mute items (decrypted from content), if decryptable */
  privateCount: number;
  /** publicCount + privateCount (or just publicCount if content couldn't be decrypted) */
  totalCount: number;
  /** True if the event has a non-empty content field (private mutes present) */
  hasPrivateContent: boolean;
  /** True if hasPrivateContent is false, or content was successfully decrypted */
  privateDecrypted: boolean;
  /** Relays where this exact event id was observed */
  foundOnRelays: string[];
  /** True if this is the most-recent event seen during the scan */
  isCurrent: boolean;
  /** True if this is the recommended recovery pick */
  isRecommended: boolean;
}

export interface MuteRecoveryScanResult {
  /** The candidate considered "current" (most recent by created_at) */
  current: MuteListCandidate | null;
  /** All distinct kind:10000 events observed, sorted by created_at DESC */
  candidates: MuteListCandidate[];
  /** The recommended recovery candidate, if any improves on current */
  recommended: MuteListCandidate | null;
  /** Relays that were queried */
  queriedRelays: string[];
  /** Relays that returned at least one kind:10000 event */
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

/** Count public mute items directly from an event's tags (no decryption needed). */
function countPublicMuteTags(event: Event): number {
  return event.tags.filter(
    (tag) => MUTE_TAG_TYPES.has(tag[0]) && typeof tag[1] === "string" && tag[1],
  ).length;
}

/** Query a single relay for a user's kind:10000 events with a timeout. */
async function queryRelayForMuteEvents(
  pool: SimplePool,
  relay: string,
  pubkey: string,
  timeoutMs: number,
): Promise<Event[]> {
  try {
    const events = await Promise.race([
      pool.querySync([relay], {
        kinds: [MUTE_LIST_KIND],
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

/** Build a candidate from a raw event, decrypting private items when possible. */
async function buildMuteListCandidate(event: Event): Promise<MuteListCandidate> {
  const publicCount = countPublicMuteTags(event);
  const hasPrivateContent = !!event.content && event.content.trim() !== "";

  let privateCount = 0;
  let privateDecrypted = !hasPrivateContent;

  if (hasPrivateContent) {
    try {
      const parsed = await parseMuteListEvent(event);
      // parseMuteListEvent returns combined public + private counts; subtract
      // the public count (from tags) we already know to isolate private items.
      const combinedCount =
        parsed.pubkeys.length +
        parsed.words.length +
        parsed.tags.length +
        parsed.threads.length;
      privateCount = Math.max(0, combinedCount - publicCount);
      privateDecrypted = true;
    } catch {
      privateDecrypted = false;
    }
  }

  return {
    event,
    eventId: event.id,
    createdAt: event.created_at,
    publicCount,
    privateCount,
    totalCount: publicCount + privateCount,
    hasPrivateContent,
    privateDecrypted,
    foundOnRelays: [],
    isCurrent: false,
    isRecommended: false,
  };
}

/**
 * Rank candidates so the "most-recent largest" non-empty version sorts first.
 *
 * Sort order:
 *   1. totalCount DESC (largest first)
 *   2. createdAt DESC  (newer wins ties)
 *
 * Tombstones (zero items) are kept in the result but never recommended.
 */
export function rankMuteListCandidates(
  candidates: MuteListCandidate[],
): MuteListCandidate[] {
  return [...candidates].sort((a, b) => {
    if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
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
export function pickRecommendedMuteRecovery(
  candidates: MuteListCandidate[],
  current: MuteListCandidate | null,
): MuteListCandidate | null {
  const ranked = rankMuteListCandidates(candidates).filter(
    (c) => c.totalCount > 0,
  );
  if (ranked.length === 0) return null;

  const currentCount = current?.totalCount ?? 0;
  const currentId = current?.eventId ?? null;

  for (const candidate of ranked) {
    if (candidate.eventId === currentId) continue;
    if (candidate.totalCount > currentCount) return candidate;
  }

  return null;
}

/**
 * Scan the user's relays plus a broad set of archival relays for historical
 * kind:10000 events. Returns every distinct version observed and highlights
 * the best recovery candidate.
 */
export async function scanMuteListHistory(
  pubkey: string,
  userRelays: string[] = DEFAULT_RELAYS,
  options: ScanOptions = {},
): Promise<MuteRecoveryScanResult> {
  const { timeoutMs = 6000, extraRelays = [], onProgress } = options;
  const pool = getPool();

  const relays = normalizeRelayList([
    ...userRelays,
    ...DEFAULT_RELAYS,
    ...KNOWN_RELAYS,
    ...extraRelays,
  ]);

  onProgress?.(`Querying ${relays.length} relays for mute list history…`);

  // Per-relay parallel queries so we know which relays returned which event ids.
  const respondingRelays: string[] = [];
  const eventsById = new Map<string, Event>();
  const relaysByEventId = new Map<string, string[]>();

  await Promise.all(
    relays.map(async (relay) => {
      const events = await queryRelayForMuteEvents(
        pool,
        relay,
        pubkey,
        timeoutMs,
      );
      if (events.length > 0) respondingRelays.push(relay);

      for (const event of events) {
        if (!eventsById.has(event.id)) eventsById.set(event.id, event);
        const foundOn = relaysByEventId.get(event.id) ?? [];
        if (!foundOn.includes(relay)) foundOn.push(relay);
        relaysByEventId.set(event.id, foundOn);
      }
    }),
  );

  onProgress?.(
    `Decrypting ${eventsById.size} distinct version${eventsById.size === 1 ? "" : "s"}…`,
  );

  const allCandidates = await Promise.all(
    Array.from(eventsById.values()).map(async (event) => {
      const candidate = await buildMuteListCandidate(event);
      candidate.foundOnRelays = relaysByEventId.get(event.id) ?? [];
      return candidate;
    }),
  );

  allCandidates.sort((a, b) => b.createdAt - a.createdAt);

  const current = allCandidates[0] ?? null;
  if (current) current.isCurrent = true;

  const recommended = pickRecommendedMuteRecovery(allCandidates, current);
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
 * Result of a recovery publish — per-relay attribution so the UI can show
 * exactly which relays accepted the restore.
 */
export interface RecoverMuteListResult {
  /** Hex id of the published event */
  eventId: string;
  /** Total relays the publish was attempted against */
  total: number;
  /** Relays that accepted the event */
  accepted: string[];
  /** Relays that rejected (or timed out), with reason */
  rejected: { relay: string; reason: string }[];
  /** Convenience alias for accepted.length */
  successful: number;
  /** Convenience alias for rejected.length */
  failed: number;
}

/**
 * Republish a candidate kind:10000 event as the user's current mute list.
 *
 * Preserves the original public tags (p/word/t/e) verbatim, and republishes
 * `content` (the NIP-04/NIP-44 ciphertext) as-is — it's already encrypted to
 * the user's own pubkey, so no decrypt/re-encrypt round-trip is needed or
 * wanted. Strips any non-mute tags for safety, mirroring how follow-list
 * recovery only preserves `p` tags.
 *
 * Publishes to the user's relays plus the broad archival set so the restore
 * propagates widely. Returns per-relay attribution so the UI can surface
 * which relays accepted — `Promise.any` would only report the first OK and
 * lose the rest.
 *
 * The user MUST be signed in — the active signer is read from the store
 * via `signEvent`.
 */
export async function recoverMuteList(
  candidate: MuteListCandidate,
  relays: string[] = DEFAULT_RELAYS,
  publishTimeoutMs: number = 15000,
): Promise<RecoverMuteListResult> {
  const preservedTags = candidate.event.tags.filter(
    (tag) => MUTE_TAG_TYPES.has(tag[0]) && typeof tag[1] === "string" && tag[1],
  );

  const template: EventTemplate = {
    kind: MUTE_LIST_KIND,
    tags: preservedTags,
    content: candidate.event.content ?? "",
    created_at: Math.floor(Date.now() / 1000),
  };

  const signed = await signEvent(template);
  const pool = getPool();

  // Widen propagation to known archival relays — at restore time we want the
  // recovered list to reach as many readers as possible.
  const publishRelays = normalizeRelayList([
    ...(relays.length ? relays : DEFAULT_RELAYS),
    ...KNOWN_RELAYS,
  ]);

  // Per-relay race against timeout so we get attribution for each relay.
  const publishPromises = pool.publish(publishRelays, signed);
  const results = await Promise.all(
    publishPromises.map(
      (p, i): Promise<{ ok: true; relay: string } | { ok: false; relay: string; reason: string }> =>
        Promise.race([
          p.then(
            () => ({ ok: true as const, relay: publishRelays[i] }),
            (err: unknown) => ({
              ok: false as const,
              relay: publishRelays[i],
              reason: String((err as { message?: string })?.message || err || "unknown"),
            }),
          ),
          new Promise<{ ok: false; relay: string; reason: string }>((resolve) =>
            setTimeout(
              () => resolve({ ok: false, relay: publishRelays[i], reason: "timeout" }),
              publishTimeoutMs,
            ),
          ),
        ]),
    ),
  );

  const accepted: string[] = [];
  const rejected: { relay: string; reason: string }[] = [];
  for (const r of results) {
    if (r.ok) accepted.push(r.relay);
    else rejected.push({ relay: r.relay, reason: r.reason });
  }

  if (accepted.length === 0) {
    const sample = rejected
      .slice(0, 3)
      .map((r) => `${r.relay}: ${r.reason}`)
      .join(" | ");
    throw new Error(
      `No relay accepted the recovered mute list. Sample errors: ${sample}`,
    );
  }

  return {
    eventId: signed.id,
    total: publishRelays.length,
    accepted,
    rejected,
    successful: accepted.length,
    failed: rejected.length,
  };
}
