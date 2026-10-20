import type { Event, Filter } from "nostr-tools";
import { BLOSSOM_SERVERS_ANON, BLOSSOM_SERVERS_AUTHED } from "@/lib/imageUpload";
import { normalizeBlossomServer } from "./client";

// Which Blossom servers to ask about a user: their kind 10063 list (BUD-03),
// the servers Mutable itself uploads to, and the hosts their posts link.

export const BLOSSOM_SERVER_LIST_KIND = 10063;

export type RelayQuery = (filter: Filter) => Promise<Event[]>;

function uniqueServers(servers: Array<string | null>): string[] {
  const result: string[] = [];
  for (const server of servers) {
    if (server && !result.includes(server)) result.push(server);
  }
  return result;
}

// Mutable uploaded here before it read server lists, so these are searched
// even when the user's list doesn't name them.
export const MUTABLE_BLOSSOM_SERVERS: string[] = uniqueServers(
  [...BLOSSOM_SERVERS_AUTHED, ...BLOSSOM_SERVERS_ANON].map(
    normalizeBlossomServer,
  ),
);

// Same-second versions: the lowest id wins, as relays apply it (NIP-01).
export function newestReplaceable(
  events: Event[],
  kind: number,
  pubkey: string,
): Event | undefined {
  return events
    .filter((event) => event.kind === kind && event.pubkey === pubkey)
    .sort(
      (a, b) =>
        b.created_at - a.created_at || (a.id < b.id ? -1 : 1),
    )[0];
}

// Server order is meaningful: the first is where clients must upload.
export function parseBlossomServerList(event: Event | undefined): string[] {
  if (!event) return [];
  return uniqueServers(
    event.tags
      .filter((tag) => tag[0] === "server" && typeof tag[1] === "string")
      .map((tag) => normalizeBlossomServer(tag[1])),
  );
}

export interface BlossomServerList {
  event?: Event;
  servers: string[];
}

export async function fetchBlossomServerList(
  pubkey: string,
  query: RelayQuery,
): Promise<BlossomServerList> {
  const events = await query({
    kinds: [BLOSSOM_SERVER_LIST_KIND],
    authors: [pubkey],
  });
  const event = newestReplaceable(events, BLOSSOM_SERVER_LIST_KIND, pubkey);
  return { event, servers: parseBlossomServerList(event) };
}

export type BlossomServerOrigin = "list" | "mutable" | "referenced";

export interface BlossomServerEntry {
  server: string;
  origins: BlossomServerOrigin[];
}

export function mergeBlossomServers(
  listServers: string[],
  referencedServers: string[],
  defaults: string[] = MUTABLE_BLOSSOM_SERVERS,
): BlossomServerEntry[] {
  const entries = new Map<string, BlossomServerEntry>();
  const add = (server: string, origin: BlossomServerOrigin) => {
    const existing = entries.get(server);
    if (existing) {
      if (!existing.origins.includes(origin)) existing.origins.push(origin);
      return;
    }
    entries.set(server, { server, origins: [origin] });
  };
  for (const server of listServers) add(server, "list");
  for (const server of defaults) add(server, "mutable");
  for (const server of referencedServers) add(server, "referenced");
  return Array.from(entries.values());
}
