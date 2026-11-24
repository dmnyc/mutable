import type { Filter } from "nostr-tools";
import { getPool, getExpandedRelayList } from "./nostr";
import { BRAINSTORM_SEARCH_RELAY, BRAINSTORM_UNRANKED } from "./brainstorm";
import {
  findEarliestEvent,
  NOSTR_EPOCH,
  type AgeEvent,
  type WindowProbe,
} from "./accountAge";

/**
 * The Dossier's two small queries that no other lens needed:
 * how many kind:5 deletion requests someone has published, and whether
 * their NIP-05 identifier actually points back at their pubkey.
 */

export interface DeletionCount {
  /** kind:5 events found (deduplicated by event id across relays). */
  deletions: number;
  /** Distinct event ids they've asked relays to forget. */
  targets: number;
}

export async function countDeletionsBy(
  pubkey: string,
  relays: string[],
): Promise<DeletionCount> {
  const pool = getPool();
  const events = await pool.querySync(getExpandedRelayList(relays), {
    kinds: [5],
    authors: [pubkey],
    limit: 800,
  });

  const seen = new Set<string>();
  let deletions = 0;
  const deduped = new Set<string>();
  for (const event of events) {
    if (deduped.has(event.id)) continue;
    deduped.add(event.id);
    deletions += 1;
    for (const tag of event.tags) {
      if (tag[0] === "e" && tag[1]) seen.add(tag[1]);
    }
  }

  return { deletions, targets: seen.size };
}

export type Nip05Status = "verified" | "mismatch" | "unverified";

/**
 * Checks the domain's .well-known/nostr.json for the claimed name and
 * compares the returned pubkey. Network or DNS failures read as
 * "unverified" rather than "mismatch" — we can only prove a mismatch
 * when the domain answers.
 */
export async function verifyNip05(
  nip05: string,
  pubkey: string,
): Promise<Nip05Status> {
  const at = nip05.lastIndexOf("@");
  if (at < 1 || at === nip05.length - 1) return "unverified";
  const name = nip05.slice(0, at);
  const domain = nip05.slice(at + 1);

  try {
    const res = await fetch(
      `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return "unverified";
    const json = await res.json();
    const match: string | undefined = json?.names?.[name.toLowerCase()];
    if (!match) return "unverified";
    return match.toLowerCase() === pubkey.toLowerCase() ? "verified" : "mismatch";
  } catch {
    return "unverified";
  }
}

export interface DmActivity {
  /** Legacy kind:4 DMs they authored. */
  sent: number;
  /** Distinct people they have sent kind:4 DMs to. */
  recipients: number;
  /** Legacy kind:4 DMs addressed to them. */
  received: number;
  /** Distinct people who have sent them kind:4 DMs. */
  senders: number;
  /** Unix seconds of the earliest and latest kind:4 seen, either direction. */
  first: number | null;
  last: number | null;
}

/**
 * Legacy (NIP-04) DM metadata. Content is encrypted, but who talked to
 * whom and when is public on relays. NIP-17 gift wraps hide the sender
 * and are not counted here.
 */
export async function fetchDmActivity(
  pubkey: string,
  relays: string[],
): Promise<DmActivity> {
  const pool = getPool();
  const expanded = getExpandedRelayList(relays);
  const [outgoing, incoming] = await Promise.all([
    pool.querySync(expanded, { kinds: [4], authors: [pubkey], limit: 1000 }),
    pool.querySync(expanded, { kinds: [4], "#p": [pubkey], limit: 1000 }),
  ]);

  const sentIds = new Set<string>();
  const recipients = new Set<string>();
  const receivedIds = new Set<string>();
  const senders = new Set<string>();
  let first: number | null = null;
  let last: number | null = null;
  const touch = (t: number) => {
    if (first === null || t < first) first = t;
    if (last === null || t > last) last = t;
  };

  for (const e of outgoing) {
    if (sentIds.has(e.id)) continue;
    sentIds.add(e.id);
    touch(e.created_at);
    for (const tag of e.tags) {
      if (tag[0] === "p" && tag[1]) recipients.add(tag[1]);
    }
  }
  for (const e of incoming) {
    if (receivedIds.has(e.id)) continue;
    receivedIds.add(e.id);
    touch(e.created_at);
    senders.add(e.pubkey);
  }

  return {
    sent: sentIds.size,
    recipients: recipients.size,
    received: receivedIds.size,
    senders: senders.size,
    first,
    last,
  };
}

export interface AccountAge {
  /** Oldest event of any kind this key has signed that we could find. */
  firstSeen: AgeEvent | null;
  /** Oldest kind:1 note. Same event as firstSeen when that was a note. */
  firstNote: AgeEvent | null;
}

const AGE_PROBE_WAIT_MS = 4000;

/**
 * When the key was first used, as a lower bound: relays prune, profiles and
 * follow lists are replaceable (only the latest survives), and created_at is
 * self-reported, so this is the oldest surviving event, not the key's birth.
 * Events dated before Nostr existed are ignored as backdated.
 *
 * The narrowing runs against the Brainstorm archive, which answers each
 * probe in well under a second. A general relay pool always waits out its
 * slowest member (seconds per probe), so the relays get one question once
 * the archive has answered: is there anything older? Only when they say yes
 * does the search continue on them.
 */
export async function fetchAccountAge(
  pubkey: string,
  relays: string[],
): Promise<AccountAge> {
  const pool = getPool();
  const relaySet = relays.filter((r) => !r.includes("search.brainstorm.world"));
  const params = { maxWait: AGE_PROBE_WAIT_MS };

  const ownEvents = (kinds?: number[]) => (events: AgeEvent[]) =>
    events.filter(
      (e) => e.pubkey === pubkey && (!kinds || kinds.includes(e.kind)),
    );

  const archiveProbe =
    (kinds?: number[]): WindowProbe =>
    (since, until, limit) => {
      const filter: Filter = {
        authors: [pubkey],
        since,
        until,
        limit,
        search: BRAINSTORM_UNRANKED,
      };
      if (kinds) filter.kinds = kinds;
      return pool
        .querySync([BRAINSTORM_SEARCH_RELAY], filter, params)
        .then(ownEvents(kinds))
        .catch(() => []);
    };

  const relayProbe =
    (kinds?: number[]): WindowProbe =>
    (since, until, limit) => {
      if (relaySet.length === 0) return Promise.resolve([]);
      const filter: Filter = { authors: [pubkey], since, until, limit };
      if (kinds) filter.kinds = kinds;
      return pool
        .querySync(relaySet, filter, params)
        .then(ownEvents(kinds))
        .catch(() => []);
    };

  const earliest = async (kinds?: number[], lo?: number) => {
    const fromArchive = await findEarliestEvent(archiveProbe(kinds), { lo });
    const floor = Math.max(lo ?? NOSTR_EPOCH, NOSTR_EPOCH);
    const ceiling = fromArchive
      ? fromArchive.created_at - 1
      : Math.floor(Date.now() / 1000);
    if (ceiling < floor) return fromArchive;
    const older = (await relayProbe(kinds)(floor, ceiling, 1)).filter(
      (e) => e.created_at >= floor && e.created_at <= ceiling,
    );
    if (older.length === 0) return fromArchive;
    const fromRelays = await findEarliestEvent(relayProbe(kinds), {
      lo: floor,
      hi: Math.min(...older.map((e) => e.created_at)),
    });
    return fromRelays ?? fromArchive;
  };

  const firstSeen = await earliest();
  if (!firstSeen) return { firstSeen: null, firstNote: null };
  if (firstSeen.kind === 1) return { firstSeen, firstNote: firstSeen };

  // Nothing predates firstSeen, so the note search can start there.
  const firstNote = await earliest([1], firstSeen.created_at);
  return { firstSeen, firstNote };
}
