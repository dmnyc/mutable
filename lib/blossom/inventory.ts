import type { BlobDescriptor } from "./client";
import { serverHost } from "./client";
import type { BlobReference, ReferenceIndex } from "./references";

// The gallery model: one item per hash, with every server that holds a copy
// and every post that points at it.

export type BlobMedia = "image" | "video" | "other";

export interface BlobCopy {
  server: string;
  url: string;
  size: number;
  type?: string;
  uploaded?: number;
}

export interface BlobItem {
  hash: string;
  copies: BlobCopy[];
  primaryUrl: string;
  size: number;
  type?: string;
  // Earliest known upload.
  uploaded?: number;
  references: BlobReference[];
  media: BlobMedia;
  referenceState: ReferenceState;
}

export type ReferenceState = "linked" | "unlinked" | "unscanned";

// "linked": a scanned event points at it. "unlinked": the scan covered the
// upload's date and found no link. "unscanned": the file predates (or
// predates knowing) the scanned window, so its absence proves nothing.
function referenceStateOf(
  references: BlobReference[],
  uploaded: number | undefined,
  windowStart: number | undefined,
): ReferenceState {
  if (references.length > 0) return "linked";
  if (windowStart === undefined || !uploaded) return "unscanned";
  return uploaded < windowStart ? "unscanned" : "unlinked";
}

export interface MissingBlob {
  hash: string;
  url?: string;
  references: BlobReference[];
}

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|avif|svg|bmp|heic|heif)$/i;
const VIDEO_EXTENSION = /\.(mp4|webm|mov|m4v|mkv)$/i;

export function classifyMedia(type?: string, url?: string): BlobMedia {
  if (type?.startsWith("image/")) return "image";
  if (type?.startsWith("video/")) return "video";
  if (url) {
    const path = url.split(/[?#]/)[0];
    if (IMAGE_EXTENSION.test(path)) return "image";
    if (VIDEO_EXTENSION.test(path)) return "video";
  }
  return "other";
}

export function buildBlobInventory(
  listings: ReadonlyMap<string, BlobDescriptor[]>,
  serverOrder: string[],
  references: ReferenceIndex,
  // Oldest event the reference scan covered; see referenceStateOf.
  referenceWindowStart?: number,
): BlobItem[] {
  const items = new Map<string, BlobItem>();
  for (const server of serverOrder) {
    for (const descriptor of listings.get(server) ?? []) {
      const copy: BlobCopy = {
        server,
        url: descriptor.url,
        size: descriptor.size,
        type: descriptor.type,
        uploaded: descriptor.uploaded,
      };
      const existing = items.get(descriptor.sha256);
      if (existing) {
        if (!existing.copies.some((c) => c.server === server)) {
          existing.copies.push(copy);
        }
        if (!existing.type && copy.type) existing.type = copy.type;
        if (!existing.size && copy.size) existing.size = copy.size;
        if (
          copy.uploaded !== undefined &&
          (existing.uploaded === undefined || copy.uploaded < existing.uploaded)
        ) {
          existing.uploaded = copy.uploaded;
        }
        existing.referenceState = referenceStateOf(
          existing.references,
          existing.uploaded,
          referenceWindowStart,
        );
        existing.media = classifyMedia(existing.type, existing.primaryUrl);
        continue;
      }
      const itemReferences = references.get(descriptor.sha256) ?? [];
      items.set(descriptor.sha256, {
        hash: descriptor.sha256,
        copies: [copy],
        primaryUrl: descriptor.url,
        size: descriptor.size,
        type: descriptor.type,
        uploaded: descriptor.uploaded,
        references: itemReferences,
        media: classifyMedia(descriptor.type, descriptor.url),
        referenceState: referenceStateOf(
          itemReferences,
          descriptor.uploaded,
          referenceWindowStart,
        ),
      });
    }
  }
  return Array.from(items.values()).sort(
    (a, b) =>
      (b.uploaded ?? -1) - (a.uploaded ?? -1) || (a.hash < b.hash ? -1 : 1),
  );
}

// Referenced from the user's posts, held by none of the listed servers.
export function findMissingBlobs(
  items: BlobItem[],
  references: ReferenceIndex,
): MissingBlob[] {
  const present = new Set(items.map((item) => item.hash));
  const missing: MissingBlob[] = [];
  for (const [hash, refs] of references) {
    if (present.has(hash)) continue;
    missing.push({
      hash,
      url: refs.find((ref) => ref.url)?.url,
      references: refs,
    });
  }
  return missing.sort(
    (a, b) =>
      (b.references[0]?.createdAt ?? 0) - (a.references[0]?.createdAt ?? 0),
  );
}

export interface ReapedCopy {
  hash: string;
  server: string;
}

// After a reap: drop the copies that are gone, and the items left with none.
export function removeReapedCopies(
  items: BlobItem[],
  reaped: Iterable<ReapedCopy>,
): BlobItem[] {
  const gone = new Set<string>();
  for (const copy of reaped) gone.add(`${copy.hash}|${copy.server}`);
  if (gone.size === 0) return items;
  const remaining: BlobItem[] = [];
  for (const item of items) {
    const copies = item.copies.filter(
      (copy) => !gone.has(`${item.hash}|${copy.server}`),
    );
    if (copies.length === 0) continue;
    remaining.push(
      copies.length === item.copies.length
        ? item
        : { ...item, copies, primaryUrl: copies[0].url },
    );
  }
  return remaining;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}

// Per-npub subdomains (npub1….blossom.band) are the same storage as their
// base host, and the full label is unreadable in a chip; show the base.
// The full host stays available at the call site for tooltips.
export function shortServerHost(server: string): string {
  return serverHost(server).replace(
    /^npub1[02-9ac-hj-np-z]+\.(?=[a-z0-9-]+\.[a-z]{2,}$)/,
    "",
  );
}

export interface ServerContentGroup {
  server: string;
  mirrors: string[];
  count: number;
}

// Servers holding exactly the same set of files are one storage listed
// several times (per-npub subdomains, shared backends); collapse them so the
// panel names each storage once. Empty servers form no group.
export function groupServersByContent(
  listings: ReadonlyMap<string, BlobDescriptor[]>,
  serverOrder: string[],
): ServerContentGroup[] {
  const groups = new Map<string, ServerContentGroup>();
  for (const server of serverOrder) {
    const descriptors = listings.get(server) ?? [];
    if (descriptors.length === 0) continue;
    const key = descriptors
      .map((descriptor) => descriptor.sha256)
      .sort()
      .join("|");
    const existing = groups.get(key);
    if (existing) {
      existing.mirrors.push(server);
      continue;
    }
    groups.set(key, { server, mirrors: [], count: descriptors.length });
  }
  return Array.from(groups.values());
}
