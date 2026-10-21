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
  DEFAULT_REFERENCE_LIMIT,
  fetchReferenceEvents,
  indexBlobReferences,
  referencedServers,
  type ReferenceIndex,
} from "./references";
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
  referenceLimit?: number;
  defaultServers?: string[];
  concurrency?: number;
}

export interface BlossomScanCallbacks {
  onSigned?: () => void;
  onServers?: (servers: BlossomServerEntry[]) => void;
  onServerResult?: (server: string, outcome: BlossomListOutcome) => void;
}

export interface BlossomScan {
  servers: BlossomServerEntry[];
  outcomes: Map<string, BlossomListOutcome>;
  listings: ReadonlyMap<string, BlobDescriptor[]>;
  references: ReferenceIndex;
  referenceEventCount: number;
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

  const [serverList, referenceEvents] = await Promise.all([
    fetchBlossomServerList(pubkey, query).catch(() => ({
      servers: [] as string[],
    })),
    fetchReferenceEvents(
      pubkey,
      query,
      input.referenceLimit ?? DEFAULT_REFERENCE_LIMIT,
    ).catch(() => []),
  ]);
  const references = indexBlobReferences(referenceEvents);
  const servers = mergeBlossomServers(
    serverList.servers,
    referencedServers(references),
    input.defaultServers ?? MUTABLE_BLOSSOM_SERVERS,
  );
  callbacks.onServers?.(servers);

  const outcomes = new Map<string, BlossomListOutcome>();
  const listings = new Map<string, BlobDescriptor[]>();
  await mapWithConcurrency(
    servers,
    input.concurrency ?? DEFAULT_LIST_CONCURRENCY,
    async (entry) => {
      const outcome = await listBlobs(entry.server, pubkey, auth, input.request);
      outcomes.set(entry.server, outcome);
      if (outcome.status === "ok") listings.set(entry.server, outcome.blobs);
      callbacks.onServerResult?.(entry.server, outcome);
    },
  );

  const items = buildBlobInventory(
    listings,
    servers.map((entry) => entry.server),
    references,
  );
  return {
    servers,
    outcomes,
    listings,
    references,
    referenceEventCount: referenceEvents.length,
    items,
    missing: findMissingBlobs(items, references),
  };
}
