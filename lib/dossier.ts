import { getPool, getExpandedRelayList } from "./nostr";

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
