//
// Burn After Reading — bulk DM deletion for Mutable.
//
// What the signer can actually delete (NIP-09 authorization + NIP-59):
//   - kind:4 DMs the user authored (their sent copies)
//   - kind:1059 gift wraps whose "p" tag is the user — NIP-59 says relays
//     should delete gift wraps when the deletion signer matches the "p" tag,
//     which covers incoming private DMs and self-copies of sent ones.
//
// Everything else (received kind:4, wraps addressed to the counterparty) is
// authored by someone else or by ephemeral keys the user no longer holds, so
// relays reject those deletion requests. We never fetch those.
//
import { Event, EventTemplate, Filter } from "nostr-tools";
import { getPool, getExpandedRelayList, normalizeRelayList } from "./nostr";
import { Signer } from "./signers";

interface WindowWithNostr extends Window {
  nostr?: {
    nip04?: {
      decrypt(pubkey: string, ciphertext: string): Promise<string>;
    };
    nip44?: {
      decrypt(pubkey: string, ciphertext: string): Promise<string>;
    };
  };
}

declare const window: WindowWithNostr;

export const GIFT_WRAP_KIND = 1059;
export const DM_KIND = 4;

/** Max e-tags per kind:5 so deletion events stay under relay size limits. */
export const MAX_E_TAGS_PER_DELETION = 100;

export interface DeletableDMs {
  /** kind:4 events the user authored (their sent NIP-04 copies). */
  nip04Sent: Event[];
  /** kind:1059 gift wraps addressed to the user (p tag = user). */
  giftWraps: Event[];
}

export interface DMConversation {
  counterparty: string;
  events: Event[];
}

/**
 * Scan relays for DM envelopes the user is authorized to delete.
 * Envelope metadata only — no content is decrypted.
 */
export async function fetchDeletableDMs(
  pubkey: string,
  relays: string[],
  onProgress?: (phase: string, count: number) => void,
  abortSignal?: AbortSignal,
): Promise<DeletableDMs> {
  const pool = getPool();
  const scanRelays = getExpandedRelayList(normalizeRelayList(relays), 16);

  onProgress?.("Scanning relays for sent DMs...", 0);
  const nip04Filter: Filter = {
    kinds: [DM_KIND],
    authors: [pubkey],
    limit: 500,
  };
  const nip04Sent = dedupeById(await pool.querySync(scanRelays, nip04Filter));

  if (abortSignal?.aborted) throw new Error("Aborted");

  onProgress?.("Scanning relays for gift wraps...", nip04Sent.length);
  const wrapFilter: Filter = {
    kinds: [GIFT_WRAP_KIND],
    "#p": [pubkey],
    limit: 1000,
  };
  const giftWraps = dedupeById(await pool.querySync(scanRelays, wrapFilter));

  if (abortSignal?.aborted) throw new Error("Aborted");

  onProgress?.("Done", nip04Sent.length + giftWraps.length);

  const byOldest = (a: Event, b: Event) => a.created_at - b.created_at;
  nip04Sent.sort(byOldest);
  giftWraps.sort(byOldest);

  return { nip04Sent, giftWraps };
}

/** Group sent kind:4 events by counterparty (the "p" tag). */
export function groupNip04ByCounterparty(events: Event[]): DMConversation[] {
  const groups = new Map<string, Event[]>();
  events.forEach((event) => {
    const counterparty = event.tags.find((tag) => tag[0] === "p")?.[1] || "";
    const group = groups.get(counterparty);
    if (group) {
      group.push(event);
    } else {
      groups.set(counterparty, [event]);
    }
  });

  const conversations = Array.from(groups.entries()).map(
    ([counterparty, group]) => ({
      counterparty,
      events: group.sort((a, b) => a.created_at - b.created_at),
    }),
  );

  // Newest conversation first in the UI.
  return conversations.sort(
    (a, b) =>
      b.events[b.events.length - 1].created_at -
      a.events[a.events.length - 1].created_at,
  );
}

/** Split event ids into batches so each kind:5 stays under size limits. */
export function chunkEventIds(
  ids: string[],
  maxPerDeletion: number = MAX_E_TAGS_PER_DELETION,
): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += maxPerDeletion) {
    chunks.push(ids.slice(i, i + maxPerDeletion));
  }
  return chunks;
}

/** Selected deletions grouped by kind, so each template carries one k tag. */
export interface DeletionGroup {
  kind: number;
  ids: string[];
}

export function buildDeletionGroups(
  scan: DeletableDMs,
  selected: Set<string>,
): DeletionGroup[] {
  const groups: DeletionGroup[] = [];
  const nip04Ids = scan.nip04Sent
    .filter((event) => selected.has(event.id))
    .map((event) => event.id);
  const wrapIds = scan.giftWraps
    .filter((event) => selected.has(event.id))
    .map((event) => event.id);
  if (nip04Ids.length > 0) {
    groups.push({ kind: DM_KIND, ids: nip04Ids });
  }
  if (wrapIds.length > 0) {
    groups.push({ kind: GIFT_WRAP_KIND, ids: wrapIds });
  }
  return groups;
}

/** Build one kind:5 template per chunk of referenced event ids. */
export function buildDeletionTemplates(
  groups: DeletionGroup[],
  reason: string,
  createdAt: number,
): EventTemplate[] {
  const templates: EventTemplate[] = [];
  groups.forEach(({ kind, ids }) => {
    chunkEventIds(ids).forEach((chunk) => {
      templates.push({
        kind: 5,
        tags: [
          ...chunk.map((id) => ["e", id]),
          // NIP-09: deletion requests SHOULD carry the kind of each
          // referenced event — chunks are per-kind so one k tag suffices.
          ["k", String(kind)],
          ["client", "Burn After Reading by Mutable"],
        ],
        content: reason.trim(),
        created_at: createdAt,
      });
    });
  });
  return templates;
}

function dedupeById(events: Event[]): Event[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

//
// Reveal: decrypt message content locally, only on demand.
//

/** Decrypt a message addressed to/from `peerPubkey` (nip04 or nip44 ciphertext). */
export type PeerDecrypt = (
  peerPubkey: string,
  ciphertext: string,
) => Promise<string>;

export function createNip04Decryptor(signer?: Signer | null): PeerDecrypt {
  if (signer) {
    return (peer, ciphertext) => signer.nip04Decrypt(peer, ciphertext);
  }
  return async (peer, ciphertext) => {
    if (typeof window === "undefined" || !window.nostr?.nip04?.decrypt) {
      throw new Error("NIP-04 decryption isn't available from your signer.");
    }
    return window.nostr.nip04.decrypt(peer, ciphertext);
  };
}

export function createNip44Decryptor(signer?: Signer | null): PeerDecrypt {
  if (signer?.nip44Decrypt) {
    const signerWithNip44 = signer;
    return (peer, ciphertext) => signerWithNip44.nip44Decrypt!(peer, ciphertext);
  }
  return async (peer, ciphertext) => {
    if (typeof window === "undefined" || !window.nostr?.nip44?.decrypt) {
      throw new Error("NIP-44 decryption isn't available from your signer.");
    }
    return window.nostr.nip44.decrypt(peer, ciphertext);
  };
}

export function hasNip04DecryptSupport(signer?: Signer | null): boolean {
  if (signer) return true;
  return typeof window !== "undefined" && !!window.nostr?.nip04?.decrypt;
}

export function hasNip44DecryptSupport(signer?: Signer | null): boolean {
  if (signer?.nip44Decrypt) return true;
  return typeof window !== "undefined" && !!window.nostr?.nip44?.decrypt;
}

export interface RevealedMessage {
  eventId: string;
  /** Decryptor's peer — counterparty for kind:4, rumor author for wraps. */
  counterparty: string;
  content: string;
  createdAt: number;
  error?: string;
}

/** Decrypt one sent kind:4 DM. */
export async function revealNip04Message(
  event: Event,
  counterparty: string,
  decrypt: PeerDecrypt,
): Promise<RevealedMessage> {
  try {
    const content = await decrypt(counterparty, event.content);
    return {
      eventId: event.id,
      counterparty,
      content,
      createdAt: event.created_at,
    };
  } catch (error) {
    return {
      eventId: event.id,
      counterparty,
      content: "",
      createdAt: event.created_at,
      error: error instanceof Error ? error.message : "Decryption failed",
    };
  }
}

/**
 * Unwrap a kind:1059 gift wrap into its kind:14 rumor. Two nip44 hops, both
 * keyed from the user's private key: wrap layer against the ephemeral wrap
 * pubkey, then the seal layer against the sender's real pubkey.
 */
export async function unwrapGiftWrap(
  wrap: Event,
  decrypt: PeerDecrypt,
): Promise<RevealedMessage> {
  try {
    const seal = JSON.parse(await decrypt(wrap.pubkey, wrap.content)) as {
      pubkey?: string;
      content?: string;
    };
    if (!seal.pubkey || typeof seal.content !== "string") {
      throw new Error("Unexpected seal payload");
    }
    const rumor = JSON.parse(await decrypt(seal.pubkey, seal.content)) as {
      pubkey?: string;
      content?: string;
      created_at?: number;
    };
    return {
      eventId: wrap.id,
      counterparty: rumor.pubkey || seal.pubkey,
      content: typeof rumor.content === "string" ? rumor.content : "",
      createdAt: rumor.created_at || wrap.created_at,
    };
  } catch (error) {
    return {
      eventId: wrap.id,
      counterparty: "",
      content: "",
      createdAt: wrap.created_at,
      error:
        error instanceof Error && error.message === "Unexpected seal payload"
          ? error.message
          : "Couldn't unwrap this gift wrap",
    };
  }
}

/** Unwrap gift wraps with bounded concurrency and progress reporting. */
export async function unwrapGiftWraps(
  wraps: Event[],
  decrypt: PeerDecrypt,
  onProgress?: (done: number, total: number) => void,
  concurrency: number = 4,
): Promise<RevealedMessage[]> {
  const results: RevealedMessage[] = new Array(wraps.length);
  let next = 0;
  let done = 0;

  const runOne = async (): Promise<void> => {
    while (next < wraps.length) {
      const index = next++;
      results[index] = await unwrapGiftWrap(wraps[index], decrypt);
      done += 1;
      onProgress?.(done, wraps.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, wraps.length) }, () => runOne()),
  );
  return results;
}

/** Decrypt NIP-04 messages with bounded concurrency, preserving order. */
export async function revealNip04Messages(
  events: Event[],
  counterparty: string,
  decrypt: PeerDecrypt,
  concurrency: number = 4,
): Promise<RevealedMessage[]> {
  const results: RevealedMessage[] = new Array(events.length);
  let next = 0;

  const runOne = async (): Promise<void> => {
    while (next < events.length) {
      const index = next++;
      results[index] = await revealNip04Message(
        events[index],
        counterparty,
        decrypt,
      );
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, events.length) },
      () => runOne(),
    ),
  );
  return results;
}

