import type { Signer } from "@/lib/signers";
import {
  listBlobs,
  mapWithConcurrency,
  signBlossomAuth,
  type BlobDescriptor,
  type BlossomListOutcome,
  type BlossomRequestOptions,
} from "./client";
import {
  fetchBlossomServerList,
  mergeBlossomServers,
  MUTABLE_BLOSSOM_SERVERS,
  type BlossomServerEntry,
  type RelayQuery,
} from "./servers";
import {
  fetchReferenceEventsPaged,
  indexBlobReferences,
  referencedServers,
  REFERENCE_MAX_PAGES,
  REFERENCE_PAGE_SIZE,
  type ReferenceIndex,
  type ReferenceProgress,
} from "./references";

export type { ReferenceProgress };
import {
  buildBlobInventory,
  findMissingBlobs,
  type BlobItem,
  type MissingBlob,
} from "./inventory";

// The whole scan: one list signature, then the server list and the user's
// recent events from relays, then every server asked for its listing.

const DEFAULT_LIST_CONCURRENCY = 4;

export interface BlossomScanInput {
  pubkey: string;
  signer: Pick<Signer, "signEvent">;
  query: RelayQuery;
  request?: BlossomRequestOptions;
  referencePageSize?: number;
  referenceMaxPages?: number;
  defaultServers?: string[];
  concurrency?: number;
}

export interface BlossomScanCallbacks {
  onSigned?: () => void;
  /** Fired once the kind 10063 list is read (fast), and again after
      references are indexed with the hosts the posts revealed. */
  onServers?: (servers: BlossomServerEntry[]) => void;
  onServerResult?: (server: string, outcome: BlossomListOutcome) => void;
  /** After each finished slice of the reference walk, so the UI can show
      live coverage instead of silence. */
  onReferenceProgress?: (progress: ReferenceProgress) => void;
  /** Fired once the first listing pass completes: the gallery can render
      from listings alone while link states are still being computed. */
  onListingsDone?: (payload: { servers: BlossomServerEntry[]; items: BlobItem[] }) => void;
  /** Per finished slice: the gallery's link states refined with the
      references indexed so far. */
  onReferencesPartial?: (payload: { references: ReferenceIndex; items: BlobItem[] }) => void;
}

export interface BlossomScan {
  servers: BlossomServerEntry[];
  outcomes: Map<string, BlossomListOutcome>;
  listings: ReadonlyMap<string, BlobDescriptor[]>;
  references: ReferenceIndex;
  referenceEventCount: number;
  // Oldest event the reference scan covered; uploads older than this are
  // "unscanned" rather than "no link found".
  referenceOldest?: number;
  items: BlobItem[];
  missing: MissingBlob[];
}

// Signing is the one step the user can decline; callers show it differently
// from a server that fails.
export class BlossomSigningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlossomSigningError";
  }
}

export async function scanBlossom(
  input: BlossomScanInput,
  callbacks: BlossomScanCallbacks = {},
): Promise<BlossomScan> {
  const { pubkey, query } = input;

  let auth: string;
  try {
    auth = await signBlossomAuth(input.signer, "list");
  } catch (error) {
    throw new BlossomSigningError(
      error instanceof Error && error.message
        ? error.message
        : "Signing was declined",
    );
  }
  callbacks.onSigned?.();

  // The server list is one cheap relay query: show real rows before the
  // long reference walk starts rather than gating the page on it.
  const serverList = await fetchBlossomServerList(pubkey, query).catch(() => ({
    servers: [] as string[],
  }));
  let servers = mergeBlossomServers(
    serverList.servers,
    [],
    input.defaultServers ?? MUTABLE_BLOSSOM_SERVERS,
  );
  callbacks.onServers?.(servers);

  const outcomes = new Map<string, BlossomListOutcome>();
  const listings = new Map<string, BlobDescriptor[]>();
  const listServers = async (entries: BlossomServerEntry[]) => {
    await mapWithConcurrency(
      entries,
      input.concurrency ?? DEFAULT_LIST_CONCURRENCY,
      async (entry) => {
        const outcome = await listBlobs(entry.server, pubkey, auth, input.request);
        outcomes.set(entry.server, outcome);
        if (outcome.status === "ok") listings.set(entry.server, outcome.blobs);
        callbacks.onServerResult?.(entry.server, outcome);
      },
    );
  };

  // Listings and the reference walk are independent — run them together.
  // The gallery renders from listings alone as soon as they land; link
  // states refine as reference slices are indexed.
  const serverNames = servers.map((entry) => entry.server);
  const referencePromise = fetchReferenceEventsPaged(pubkey, query, {
    pageSize: input.referencePageSize ?? REFERENCE_PAGE_SIZE,
    maxPages: input.referenceMaxPages ?? REFERENCE_MAX_PAGES,
    onProgress: (progress) => {
      callbacks.onReferenceProgress?.(progress);
      if (callbacks.onReferencesPartial) {
        callbacks.onReferencesPartial({
          references: progress.references,
          items: buildBlobInventory(listings, serverNames, progress.references, progress.oldest),
        });
      }
    },
  }).catch(() => ({ events: [], pages: 0, oldestCreated: undefined }));

  await listServers(servers);
  callbacks.onListingsDone?.({
    servers,
    items: buildBlobInventory(listings, serverNames, new Map(), undefined),
  });
  const referenceScan = await referencePromise;
  const references = indexBlobReferences(referenceScan.events);

  // Posts can point at hosts that are in no list; ask those too.
  const referenced = referencedServers(references);
  const newReferenced = referenced.filter(
    (server) => !servers.some((entry) => entry.server === server),
  );
  if (newReferenced.length > 0) {
    servers = mergeBlossomServers(
      serverList.servers,
      referenced,
      input.defaultServers ?? MUTABLE_BLOSSOM_SERVERS,
    );
    callbacks.onServers?.(servers);
    await listServers(
      servers.filter((entry) => newReferenced.includes(entry.server)),
    );
  }

  const items = buildBlobInventory(
    listings,
    servers.map((entry) => entry.server),
    references,
    referenceScan.oldestCreated,
  );
  return {
    servers,
    outcomes,
    listings,
    references,
    referenceEventCount: referenceScan.events.length,
    referenceOldest: referenceScan.oldestCreated,
    items,
    missing: findMissingBlobs(items, references),
  };
}
