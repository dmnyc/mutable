/**
 * nostrarchives.com API client.
 *
 * A hosted index of Nostr profiles and events. Used to supplement relay
 * queries in the places relays serve poorly: global username search, bulk
 * profile metadata, and broad historical event lookups that would otherwise
 * require fanning out across many relays and still return partial results.
 *
 * Three endpoints, no auth:
 *   GET  /v1/search/suggest?q=&limit=        -> { suggestions: [NaProfile] }
 *   POST /v1/profiles/metadata {pubkeys:[]}  -> { profiles:    [NaProfile] }  (max 500/req)
 *   GET  /v1/events?pubkey=&kind=&q=&limit=  -> { count, events: [NaEvent] }
 *
 * Rate limiting: a 429 sets a global cooldown from the Retry-After header,
 * clamped to [30s, 3600s]. While cooling down every call short-circuits to an
 * empty result so callers transparently fall back to relays.
 *
 * Every function degrades to an empty result rather than throwing — this is
 * an optional accelerator, never a hard dependency.
 */

const NA_BASE = "https://api.nostrarchives.com";
const HEX64 = /^[0-9a-f]{64}$/i;

const SUGGEST_TIMEOUT_MS = 5000;
const METADATA_TIMEOUT_MS = 8000;
const EVENTS_TIMEOUT_MS = 10000;
const METADATA_CHUNK = 500;

export interface NaProfile {
  pubkey: string;
  display_name?: string;
  preferred_name?: string;
  name?: string;
  picture?: string;
  nip05?: string;
  about?: string;
  follower_count?: number;
  last_active_at?: number;
}

export interface NaEvent {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
  created_at: number;
  sig?: string;
  tags: string[][];
  relay_url?: string;
}

let naCooldownUntil = 0;

function naAvailable(): boolean {
  return Date.now() >= naCooldownUntil;
}

/** Exposed for tests / debugging. */
export function isNostrArchivesAvailable(): boolean {
  return naAvailable();
}

/** Exposed for tests: clear any active cooldown. */
export function resetNostrArchivesCooldown(): void {
  naCooldownUntil = 0;
}

/** Clamp the cooldown window to [30s, 3600s]; default 60s on parse failure. */
function naBackoff(retryAfterSeconds: number | null | undefined): number {
  const s =
    typeof retryAfterSeconds === "number" && retryAfterSeconds > 0
      ? retryAfterSeconds
      : 60;
  return Math.min(3600, Math.max(30, s));
}

function applyRateLimit(res: Response) {
  const retryAfter = Number(res.headers.get("Retry-After"));
  naCooldownUntil =
    Date.now() +
    naBackoff(Number.isFinite(retryAfter) ? retryAfter : 60) * 1000;
}

function normalizeProfile(raw: unknown): NaProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.pubkey !== "string" || !HEX64.test(p.pubkey)) return null;

  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);

  return {
    pubkey: p.pubkey.toLowerCase(),
    display_name: str(p.display_name),
    preferred_name: str(p.preferred_name),
    name: str(p.name),
    picture: str(p.picture),
    nip05: str(p.nip05),
    about: str(p.about),
    follower_count: num(p.follower_count),
    last_active_at: num(p.last_active_at),
  };
}

function normalizeEvent(raw: unknown): NaEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== "string" || !HEX64.test(e.id)) return null;
  if (typeof e.pubkey !== "string" || !HEX64.test(e.pubkey)) return null;
  if (typeof e.kind !== "number" || typeof e.created_at !== "number") {
    return null;
  }

  // Tags may only be present on the nested `raw` event object.
  const rawInner = (e.raw ?? {}) as Record<string, unknown>;
  const tagsSource = Array.isArray(e.tags)
    ? e.tags
    : Array.isArray(rawInner.tags)
      ? rawInner.tags
      : [];
  const tags = (tagsSource as unknown[]).filter(
    (t): t is string[] =>
      Array.isArray(t) && t.every((x) => typeof x === "string"),
  );

  return {
    id: e.id.toLowerCase(),
    pubkey: e.pubkey.toLowerCase(),
    kind: e.kind,
    content: typeof e.content === "string" ? e.content : "",
    created_at: e.created_at,
    sig: typeof e.sig === "string" ? e.sig : undefined,
    tags,
    relay_url: typeof e.relay_url === "string" ? e.relay_url : undefined,
  };
}

/** Global username search (autocomplete). */
export async function naSuggest(
  query: string,
  limit: number = 8,
): Promise<NaProfile[]> {
  if (!query || query.trim().length < 2 || !naAvailable()) return [];

  const url = `${NA_BASE}/v1/search/suggest?q=${encodeURIComponent(
    query.trim(),
  )}&limit=${limit}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(SUGGEST_TIMEOUT_MS),
    });
    if (res.status === 429) {
      applyRateLimit(res);
      return [];
    }
    if (!res.ok) return [];
    const data = (await res.json()) as { suggestions?: unknown[] };
    const list = Array.isArray(data.suggestions) ? data.suggestions : [];
    return list
      .map(normalizeProfile)
      .filter((p): p is NaProfile => p !== null);
  } catch {
    return [];
  }
}

/** Bulk profile metadata lookup. Splits into 500-pubkey chunks. */
export async function naMetadata(pubkeys: string[]): Promise<NaProfile[]> {
  if (pubkeys.length === 0 || !naAvailable()) return [];

  const unique = [
    ...new Set(pubkeys.map((p) => p.toLowerCase()).filter((p) => HEX64.test(p))),
  ];
  const out: NaProfile[] = [];

  for (let i = 0; i < unique.length; i += METADATA_CHUNK) {
    const chunk = unique.slice(i, i + METADATA_CHUNK);
    try {
      const res = await fetch(`${NA_BASE}/v1/profiles/metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pubkeys: chunk }),
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
      });
      if (res.status === 429) {
        applyRateLimit(res);
        break;
      }
      if (!res.ok) continue;
      const data = (await res.json()) as { profiles?: unknown[] };
      const list = Array.isArray(data.profiles) ? data.profiles : [];
      for (const raw of list) {
        const p = normalizeProfile(raw);
        if (p) out.push(p);
      }
    } catch {
      // a failed chunk shouldn't abort the rest
    }
  }

  return out;
}

export interface NaEventQuery {
  /**
   * Author to filter by. NOTE: the API expects the singular `pubkey` param —
   * a NIP-01-style `authors` param is silently ignored and returns unrelated
   * events, so never pass that through.
   */
  pubkey?: string;
  kind?: number;
  /** Full-text search over event content. */
  q?: string;
  limit?: number;
}

/**
 * Query archived events. Returns [] on any failure so callers fall back to
 * relays rather than surfacing an error.
 */
export async function naEvents(query: NaEventQuery): Promise<NaEvent[]> {
  if (!naAvailable()) return [];
  if (query.pubkey && !HEX64.test(query.pubkey)) return [];

  const params = new URLSearchParams();
  if (query.pubkey) params.set("pubkey", query.pubkey.toLowerCase());
  if (typeof query.kind === "number") params.set("kind", String(query.kind));
  if (query.q) params.set("q", query.q);
  params.set("limit", String(query.limit ?? 100));

  try {
    const res = await fetch(`${NA_BASE}/v1/events?${params.toString()}`, {
      signal: AbortSignal.timeout(EVENTS_TIMEOUT_MS),
    });
    if (res.status === 429) {
      applyRateLimit(res);
      return [];
    }
    if (!res.ok) return [];
    const data = (await res.json()) as { events?: unknown[] };
    const list = Array.isArray(data.events) ? data.events : [];
    return list.map(normalizeEvent).filter((e): e is NaEvent => e !== null);
  } catch {
    return [];
  }
}

/**
 * Count a pubkey's events of a given kind. The API caps `limit`, so this is a
 * floor rather than a guaranteed total — callers should treat a result equal
 * to `cap` as "at least this many".
 */
export async function naCountEvents(
  pubkey: string,
  kind: number,
  cap: number = 1000,
): Promise<{ count: number; isCapped: boolean } | null> {
  const events = await naEvents({ pubkey, kind, limit: cap });
  if (events.length === 0) return null;
  const unique = new Set(events.map((e) => e.id));
  return { count: unique.size, isCapped: unique.size >= cap };
}
