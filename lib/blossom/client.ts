import type { Event, EventTemplate } from "nostr-tools";
import type { Signer } from "@/lib/signers";

// Blossom client (BUD-01, BUD-11, BUD-12): listing, liveness and deletion.
// Pure: fetch comes in through the options, nothing here touches app state.

export const BLOSSOM_AUTH_KIND = 24242;
const AUTH_TTL_SECONDS = 300;
const DEFAULT_TIMEOUT_MS = 15_000;
const LIST_PAGE_SIZE = 100;
const LIST_MAX_PAGES = 50;

export type BlossomVerb = "get" | "upload" | "list" | "delete" | "media";

export interface BlobDescriptor {
  url: string;
  sha256: string;
  size: number;
  type?: string;
  uploaded?: number;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;

export function isBlobHash(value: string): boolean {
  return HASH_PATTERN.test(value);
}

// BUD-03: the hash is the last 64-hex run in the URL, which also covers
// non-Blossom hosts that name files by their hash.
export function extractBlobHash(url: string): string | undefined {
  const runs = url.match(/[0-9a-fA-F]+/g) ?? [];
  const hashes = runs.filter((run) => run.length === 64);
  return hashes.length > 0
    ? hashes[hashes.length - 1].toLowerCase()
    : undefined;
}

export function normalizeBlossomServer(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname) return null;
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    return null;
  }
}

export function serverHost(server: string): string {
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
}

export function blobUrl(server: string, hash: string): string {
  return `${server}/${hash}`;
}

export interface BlossomAuthOptions {
  hashes?: string[];
  content?: string;
  now?: number;
  ttlSeconds?: number;
}

const AUTH_CONTENT: Record<BlossomVerb, string> = {
  get: "Get blobs",
  upload: "Upload blob",
  list: "List blobs",
  delete: "Delete blobs",
  media: "Upload media",
};

// One token covers every server and, for deletes, every hash in its x tags:
// BUD-12 deletes only the blob in the request path, so a token listing
// several hashes can be reused across requests with a single signature.
export function buildBlossomAuthTemplate(
  verb: BlossomVerb,
  options: BlossomAuthOptions = {},
): EventTemplate {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const tags: string[][] = [
    ["t", verb],
    ["expiration", String(now + (options.ttlSeconds ?? AUTH_TTL_SECONDS))],
  ];
  for (const hash of options.hashes ?? []) tags.push(["x", hash]);
  return {
    kind: BLOSSOM_AUTH_KIND,
    created_at: now,
    tags,
    content: options.content ?? AUTH_CONTENT[verb],
  };
}

export function encodeBlossomAuth(event: Event): string {
  return "Nostr " + btoa(unescape(encodeURIComponent(JSON.stringify(event))));
}

export async function signBlossomAuth(
  signer: Pick<Signer, "signEvent">,
  verb: BlossomVerb,
  options: BlossomAuthOptions = {},
): Promise<string> {
  const event = await signer.signEvent(buildBlossomAuthTemplate(verb, options));
  return encodeBlossomAuth(event);
}

export type FetchLike = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export interface BlossomRequestOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
}

async function request(
  url: string,
  init: RequestInit,
  options: BlossomRequestOptions,
): Promise<Response> {
  const fetchImpl: FetchLike =
    options.fetch ?? ((input, requestInit) => globalThis.fetch(input, requestInit));
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "Timed out";
    if (error.name === "TypeError") return "Network error";
    return error.message;
  }
  return "Unknown error";
}

// X-Reason is human-readable only (BUD-02); it is shown, never parsed.
function describeStatus(response: Response): string {
  const reason = response.headers.get("X-Reason");
  return reason ? `HTTP ${response.status}: ${reason}` : `HTTP ${response.status}`;
}

function parseBlobDescriptor(
  value: unknown,
  server: string,
): BlobDescriptor | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const sha256 =
    typeof record.sha256 === "string" ? record.sha256.toLowerCase() : "";
  if (!isBlobHash(sha256)) return undefined;
  const size =
    typeof record.size === "number"
      ? record.size
      : Number.parseInt(String(record.size ?? ""), 10);
  return {
    url:
      typeof record.url === "string" && record.url
        ? record.url
        : blobUrl(server, sha256),
    sha256,
    size: Number.isFinite(size) && size >= 0 ? size : 0,
    type: typeof record.type === "string" ? record.type : undefined,
    uploaded:
      typeof record.uploaded === "number" ? record.uploaded : undefined,
  };
}

export type BlossomListOutcome =
  | { status: "ok"; blobs: BlobDescriptor[] }
  | { status: "unauthorized"; code: number }
  | { status: "unsupported"; code: number }
  | { status: "failed"; message: string };

// GET /list/<pubkey> (BUD-12), paged with cursor and limit. Servers may
// ignore both; a page that adds nothing new ends the listing.
export async function listBlobs(
  server: string,
  pubkey: string,
  authHeader: string | undefined,
  options: BlossomRequestOptions = {},
): Promise<BlossomListOutcome> {
  const blobs: BlobDescriptor[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < LIST_MAX_PAGES; page++) {
    const params = new URLSearchParams({ limit: String(LIST_PAGE_SIZE) });
    if (cursor) params.set("cursor", cursor);
    let response: Response;
    try {
      response = await request(
        `${server}/list/${pubkey}?${params.toString()}`,
        {
          method: "GET",
          headers: authHeader ? { Authorization: authHeader } : {},
        },
        options,
      );
    } catch (error) {
      return { status: "failed", message: describeError(error) };
    }

    if (response.status === 401 || response.status === 403) {
      return { status: "unauthorized", code: response.status };
    }
    if ([404, 405, 501].includes(response.status)) {
      return { status: "unsupported", code: response.status };
    }
    if (!response.ok) {
      return { status: "failed", message: describeStatus(response) };
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return { status: "failed", message: "Malformed response" };
    }
    if (!Array.isArray(parsed)) {
      return { status: "failed", message: "Malformed response" };
    }

    const descriptors = parsed
      .map((entry) => parseBlobDescriptor(entry, server))
      .filter((entry): entry is BlobDescriptor => entry !== undefined);
    let added = 0;
    for (const descriptor of descriptors) {
      if (seen.has(descriptor.sha256)) continue;
      seen.add(descriptor.sha256);
      blobs.push(descriptor);
      added += 1;
    }

    if (parsed.length < LIST_PAGE_SIZE || added === 0) break;
    cursor = descriptors[descriptors.length - 1]?.sha256;
    if (!cursor) break;
  }

  return { status: "ok", blobs };
}

export type BlobPresence = "present" | "missing" | "failed";

export async function probeUrl(
  url: string,
  options: BlossomRequestOptions = {},
): Promise<BlobPresence> {
  try {
    // no-store: gallery tiles render these exact URLs as <img> and blobs
    // are content-addressed (servers often mark them immutably cacheable),
    // so a cached response would report a just-deleted blob as still there.
    const response = await request(
      url,
      { method: "HEAD", cache: "no-store" },
      options,
    );
    if (response.ok) return "present";
    if (response.status === 404 || response.status === 410) return "missing";
    return "failed";
  } catch {
    return "failed";
  }
}

export function headBlob(
  server: string,
  hash: string,
  options: BlossomRequestOptions = {},
): Promise<BlobPresence> {
  return probeUrl(blobUrl(server, hash), options);
}

export type BlossomDeleteOutcome =
  | { status: "deleted" }
  | { status: "missing" }
  | { status: "unauthorized"; code: number }
  | { status: "failed"; message: string };

// DELETE /<sha256> (BUD-12). Deletion is per server, and a server only drops
// this pubkey's claim: the same bytes uploaded by someone else stay.
export async function deleteBlob(
  server: string,
  hash: string,
  authHeader: string,
  options: BlossomRequestOptions = {},
): Promise<BlossomDeleteOutcome> {
  try {
    const response = await request(
      blobUrl(server, hash),
      { method: "DELETE", headers: { Authorization: authHeader } },
      options,
    );
    if (response.status === 200 || response.status === 204) {
      return { status: "deleted" };
    }
    if (response.status === 404) return { status: "missing" };
    if (response.status === 401 || response.status === 403) {
      return { status: "unauthorized", code: response.status };
    }
    return { status: "failed", message: describeStatus(response) };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      // The request dying says nothing about whether the server finished
      // the deletion: settle it with a presence check instead of
      // reporting an ambiguous failure.
      const presence = await probeUrl(blobUrl(server, hash), options);
      if (presence === "missing") return { status: "missing" };
      if (presence === "present") {
        return { status: "failed", message: "Timed out — file still there" };
      }
    }
    return { status: "failed", message: describeError(error) };
  }
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}
