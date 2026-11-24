/**
 * Brainstorm (NosFabrica) search relay.
 *
 * A NIP-50 aggregator relay with a large archive, used where general relays
 * serve poorly: bulk profile metadata, global profile search, note counts and
 * oldest-event lookups. It replaced the nostrarchives.com API.
 *
 * Reads without NIP-42 auth are refused unless the filter carries a search
 * token: `include:spam` asks for the whole corpus unranked, `observer:<hex
 * pubkey>` ranks results through that pubkey's web of trust. Plain NIP-01
 * filters (authors, kinds, since/until, limit) work alongside either token,
 * as does NIP-45 COUNT.
 *
 * Every function degrades to an empty result rather than throwing: this is an
 * accelerator, never a hard dependency, and callers fall back to relays.
 */

import { SimplePool, type Event, type Filter } from "nostr-tools";

export const BRAINSTORM_SEARCH_RELAY = "wss://search.brainstorm.world";

/** Search token for unranked, unauthenticated reads of the full corpus. */
export const BRAINSTORM_UNRANKED = "include:spam";

const HEX64 = /^[0-9a-f]{64}$/i;

/** Pubkeys per kind:0 filter. The relay allows 20,000 results per filter. */
const METADATA_CHUNK = 500;
const METADATA_WAIT_MS = 8000;
const SEARCH_WAIT_MS = 5000;
const COUNT_TIMEOUT_MS = 8000;

export interface BrainstormProfile {
  pubkey: string;
  name?: string;
  display_name?: string;
  picture?: string;
  nip05?: string;
  about?: string;
  lud16?: string;
}

/** Adds the search token to a filter, keeping any search terms it has. */
export function withSearchToken(
  filter: Filter,
  token: string = BRAINSTORM_UNRANKED,
): Filter {
  const terms = filter.search?.trim();
  return { ...filter, search: terms ? `${terms} ${token}` : token };
}

/** A kind:0 event's metadata, or null when it isn't a usable profile. */
export function profileFromEvent(event: Event): BrainstormProfile | null {
  if (event.kind !== 0 || !HEX64.test(event.pubkey)) return null;
  let meta: Record<string, unknown>;
  try {
    const parsed = JSON.parse(event.content);
    if (!parsed || typeof parsed !== "object") return null;
    meta = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const str = (v: unknown) =>
    typeof v === "string" && v.trim() ? v : undefined;
  return {
    pubkey: event.pubkey.toLowerCase(),
    name: str(meta.name) ?? str(meta.username),
    display_name: str(meta.display_name) ?? str(meta.displayName),
    picture: str(meta.picture),
    nip05: str(meta.nip05),
    about: str(meta.about),
    lud16: str(meta.lud16),
  };
}

/** The newest kind:0 per pubkey, as profiles. Replaceable events can repeat. */
export function latestProfiles(events: Event[]): BrainstormProfile[] {
  const newest = new Map<string, Event>();
  for (const event of events) {
    if (event.kind !== 0) continue;
    const key = event.pubkey.toLowerCase();
    const seen = newest.get(key);
    if (!seen || event.created_at > seen.created_at) newest.set(key, event);
  }
  const out: BrainstormProfile[] = [];
  for (const event of newest.values()) {
    const profile = profileFromEvent(event);
    if (profile) out.push(profile);
  }
  return out;
}

let pool: SimplePool | null = null;
function getBrainstormPool(): SimplePool {
  if (!pool) pool = new SimplePool();
  return pool;
}

/** One query against the search relay, with the token added. [] on failure. */
export async function brainstormQuery(
  filter: Filter,
  maxWait: number = SEARCH_WAIT_MS,
  token?: string,
): Promise<Event[]> {
  try {
    return await getBrainstormPool().querySync(
      [BRAINSTORM_SEARCH_RELAY],
      withSearchToken(filter, token),
      { maxWait },
    );
  } catch {
    return [];
  }
}

/** Bulk profile lookup, chunked. Missing pubkeys are simply absent. */
export async function brainstormMetadata(
  pubkeys: string[],
): Promise<BrainstormProfile[]> {
  const unique = [
    ...new Set(
      pubkeys.map((p) => p.toLowerCase()).filter((p) => HEX64.test(p)),
    ),
  ];
  if (unique.length === 0) return [];

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += METADATA_CHUNK) {
    chunks.push(unique.slice(i, i + METADATA_CHUNK));
  }
  const results = await Promise.all(
    chunks.map((authors) =>
      brainstormQuery(
        { kinds: [0], authors, limit: authors.length * 2 },
        METADATA_WAIT_MS,
      ),
    ),
  );
  const wanted = new Set(unique);
  return latestProfiles(results.flat()).filter((p) => wanted.has(p.pubkey));
}

/**
 * Full-text profile search. Pass an observer pubkey to rank results through
 * that person's web of trust; without one, results come back unranked.
 */
export async function brainstormSearchProfiles(
  query: string,
  limit: number = 20,
  observer?: string,
): Promise<BrainstormProfile[]> {
  const terms = query.trim();
  if (terms.length < 2) return [];
  const token =
    observer && HEX64.test(observer)
      ? `observer:${observer.toLowerCase()}`
      : BRAINSTORM_UNRANKED;
  const events = await brainstormQuery(
    { kinds: [0], search: terms, limit },
    SEARCH_WAIT_MS,
    token,
  );
  // Keep the relay's ranking order, one entry per pubkey.
  const profiles = latestProfiles(events);
  const byPubkey = new Map(profiles.map((p) => [p.pubkey, p]));
  const ordered: BrainstormProfile[] = [];
  for (const event of events) {
    const profile = byPubkey.get(event.pubkey.toLowerCase());
    if (profile && !ordered.includes(profile)) ordered.push(profile);
  }
  return ordered;
}

/** NIP-45 COUNT of a pubkey's events of a kind. Null when it can't answer. */
export async function brainstormCountEvents(
  pubkey: string,
  kind: number,
): Promise<number | null> {
  if (!HEX64.test(pubkey)) return null;
  try {
    const relay = await getBrainstormPool().ensureRelay(
      BRAINSTORM_SEARCH_RELAY,
      { connectionTimeout: COUNT_TIMEOUT_MS },
    );
    const count = await Promise.race([
      relay.count(
        [
          withSearchToken({
            kinds: [kind],
            authors: [pubkey.toLowerCase()],
          }),
        ],
        {},
      ),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), COUNT_TIMEOUT_MS),
      ),
    ]);
    return typeof count === "number" && count >= 0 ? count : null;
  } catch {
    return null;
  }
}
