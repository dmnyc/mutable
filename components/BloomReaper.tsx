"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import type { Filter } from "nostr-tools";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ExternalLink,
  Flower2,
  ImageOff,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store";
import { DEFAULT_RELAYS, getPool, hasNip07, hexToNote, normalizeRelayList } from "@/lib/nostr";
import {
  isBlobHash,
  mapWithConcurrency,
  probeUrl,
  serverHost,
  type BlobDescriptor,
  type BlobPresence,
} from "@/lib/blossom/client";
import type { BlossomServerEntry, BlossomServerOrigin } from "@/lib/blossom/servers";
import type { ReferenceIndex } from "@/lib/blossom/references";
import {
  findMissingBlobs,
  groupServersByContent,
  removeReapedCopies,
  shortHash,
  type BlobItem,
  type MissingBlob,
} from "@/lib/blossom/inventory";
import { BlossomSigningError, scanBlossom, type BlossomScan } from "@/lib/blossom/scan";
import PageHeader from "@/components/system/PageHeader";
import Panel, { PanelHeader } from "@/components/system/Panel";
import Button from "@/components/system/Button";
import BlobTile, { formatUploaded } from "@/components/bloom-reaper/BlobTile";
import GallerySkeleton from "@/components/bloom-reaper/GallerySkeleton";
import WiltedRose from "@/components/bloom-reaper/WiltedRose";
import ReapDialog, { type ReapResult } from "@/components/bloom-reaper/ReapDialog";

type ServerStatus = "pending" | "ok" | "unauthorized" | "unsupported" | "failed";

interface ServerRow extends BlossomServerEntry {
  status: ServerStatus;
  count?: number;
  message?: string;
}

type Phase = "idle" | "signing" | "scanning" | "done" | "error";
type GalleryFilter =
  | "all"
  | "images"
  | "referenced"
  | "unlinked"
  | "unscanned"
  | "hidden";

const RELAY_MAX_WAIT_MS = 8000;
const PROBE_CONCURRENCY = 4;
// Tiles beyond the first page wait for a click: no DOM, no downloads.
const GALLERY_PAGE_SIZE = 24;
// "Linked but gone" rows are slim, so the page holds more of them.
const MISSING_PAGE_SIZE = 50;

const originLabels: Record<BlossomServerOrigin, string> = {
  list: "your list",
  mutable: "mutable",
  referenced: "in your posts",
};

// Quick cuts on the upload bracket: open-ended ranges ending today. The
// local calendar day matches how the from/to inputs compare.
const presetRanges = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
] as const;

function presetFrom(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const statusLabels: Record<ServerStatus, string> = {
  pending: "asking…",
  ok: "listed",
  unauthorized: "refused",
  unsupported: "listing unavailable",
  failed: "failed",
};

const filterLabels: Record<GalleryFilter, string> = {
  all: "All",
  images: "Images",
  referenced: "In your posts",
  unlinked: "No link found",
  unscanned: "Not scanned",
  hidden: "Dismissed",
};

export default function BloomReaper() {
  const { session } = useAuth();
  const signer = useStore((state) => state.signer);

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [references, setReferences] = useState<ReferenceIndex>(new Map());
  const [items, setItems] = useState<BlobItem[]>([]);
  const [missing, setMissing] = useState<MissingBlob[]>([]);
  const [missingPresence, setMissingPresence] = useState<Record<string, BlobPresence>>({});
  const [filter, setFilter] = useState<GalleryFilter>("all");
  const [visibleCount, setVisibleCount] = useState(GALLERY_PAGE_SIZE);
  const [missingVisibleCount, setMissingVisibleCount] = useState(MISSING_PAGE_SIZE);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [listings, setListings] = useState<ReadonlyMap<string, BlobDescriptor[]>>(
    new Map(),
  );
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reapTargets, setReapTargets] = useState<BlobItem[] | null>(null);
  const [referenceEventCount, setReferenceEventCount] = useState(0);
  const [referenceOldest, setReferenceOldest] = useState<number | undefined>(
    undefined,
  );

  const relays = useMemo(
    () =>
      Array.from(
        new Set(normalizeRelayList([...(session?.relays ?? []), ...DEFAULT_RELAYS])),
      ),
    [session],
  );

  const updateServer = (server: string, changes: Partial<ServerRow>) => {
    setServers((previous) =>
      previous.map((row) => (row.server === server ? { ...row, ...changes } : row)),
    );
  };

  const scan = useCallback(async () => {
    if (!session || !signer) return;
    const pubkey = session.pubkey;
    const query = (filterSpec: Filter) =>
      getPool().querySync(relays, filterSpec, { maxWait: RELAY_MAX_WAIT_MS });

    setError(null);
    setServers([]);
    setItems([]);
    setMissing([]);
    setMissingPresence({});
    setSelected(new Set());
    // Dismissals persist per key, so a rescan keeps the gallery tidy.
    let storedHidden: unknown = [];
    try {
      storedHidden = JSON.parse(
        localStorage.getItem(`bloom-reaper-hidden-${pubkey}`) ?? "[]",
      );
    } catch {
      storedHidden = [];
    }
    setHidden(
      new Set(
        Array.isArray(storedHidden)
          ? storedHidden.filter(
              (hash): hash is string => typeof hash === "string" && isBlobHash(hash),
            )
          : [],
      ),
    );
    setPhase("signing");

    let scanResult: BlossomScan;
    try {
      scanResult = await scanBlossom(
        { pubkey, signer, query },
        {
          onSigned: () => setPhase("scanning"),
          onServers: (entries) =>
            setServers(entries.map((entry) => ({ ...entry, status: "pending" }))),
          onServerResult: (server, outcome) => {
            if (outcome.status === "ok") {
              updateServer(server, { status: "ok", count: outcome.blobs.length });
            } else if (outcome.status === "failed") {
              updateServer(server, { status: "failed", message: outcome.message });
            } else {
              updateServer(server, {
                status: outcome.status,
                message: `HTTP ${outcome.code}`,
              });
            }
          },
        },
      );
    } catch (err) {
      setPhase("error");
      setError(
        err instanceof BlossomSigningError
          ? `Signing failed: ${err.message}. Without it no server will list your uploads.`
          : err instanceof Error && err.message
            ? err.message
            : "The scan failed.",
      );
      return;
    }

    setReferences(scanResult.references);
    setReferenceEventCount(scanResult.referenceEventCount);
    setReferenceOldest(scanResult.referenceOldest);
    setListings(scanResult.listings);
    setItems(scanResult.items);
    setMissing(scanResult.missing);
    setVisibleCount(GALLERY_PAGE_SIZE);
    setMissingVisibleCount(MISSING_PAGE_SIZE);
    setPhase("done");

    // Whether a dead-looking link still resolves at its original host.
    const presence: Record<string, BlobPresence> = {};
    await mapWithConcurrency(
      scanResult.missing.filter((blob) => blob.url),
      PROBE_CONCURRENCY,
      async (blob) => {
        presence[blob.hash] = await probeUrl(blob.url!);
        setMissingPresence({ ...presence });
      },
    );
  }, [session, signer, relays]);

  const handleReaped = (results: ReapResult[]) => {
    const gone = results.filter(
      (r) => r.outcome.status === "deleted" || r.outcome.status === "missing",
    );
    const remaining = removeReapedCopies(items, gone);
    if (remaining === items) return;
    setItems(remaining);
    setMissing(findMissingBlobs(remaining, references));
    setServers((previous) =>
      previous.map((row) => {
        const reapedHere = gone.filter((r) => r.server === row.server).length;
        return reapedHere && row.count !== undefined
          ? { ...row, count: Math.max(0, row.count - reapedHere) }
          : row;
      }),
    );
    setSelected((previous) => {
      const next = new Set<string>();
      for (const hash of previous) {
        if (remaining.some((item) => item.hash === hash)) next.add(hash);
      }
      return next;
    });
  };

  const toggleSelected = (hash: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  };

  const updateHidden = (next: Set<string>) => {
    setHidden(next);
    if (!session) return;
    try {
      localStorage.setItem(
        `bloom-reaper-hidden-${session.pubkey}`,
        JSON.stringify(Array.from(next)),
      );
    } catch {
      // Storage unavailable: the dismissal lasts for the session.
    }
  };

  const toggleHidden = (hash: string) => {
    const next = new Set(hidden);
    if (next.has(hash)) next.delete(hash);
    else next.add(hash);
    updateHidden(next);
    setSelected((previous) => {
      const nextSelected = new Set(previous);
      nextSelected.delete(hash);
      return nextSelected;
    });
  };

  const toggleExpanded = (server: string) => {
    setExpandedServers((previous) => {
      const next = new Set(previous);
      if (next.has(server)) next.delete(server);
      else next.add(server);
      return next;
    });
  };

  const selectedItems = items.filter((item) => selected.has(item.hash));
  // Servers without a single blob under the key are not shown at all, and
  // servers holding exactly the same files collapse into one row.
  const serverGroups = useMemo(
    () => groupServersByContent(listings, servers.map((row) => row.server)),
    [listings, servers],
  );
  const originsOf = useCallback(
    (server: string) =>
      servers.find((row) => row.server === server)?.origins ?? [],
    [servers],
  );
  // Local-calendar-day comparison against the YYYY-MM-DD input values.
  const uploadedDay = useCallback((uploaded: number): string => {
    const date = new Date(uploaded * 1000);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }, []);
  // With a range set, files whose upload date is unknown can't be placed in
  // it, so they stay out until the filter is cleared.
  const inDateRange = useCallback(
    (item: BlobItem) => {
      if (!dateFrom && !dateTo) return true;
      if (!item.uploaded) return false;
      const day = uploadedDay(item.uploaded);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      return true;
    },
    [dateFrom, dateTo, uploadedDay],
  );
  const datedItems = useMemo(
    () => items.filter(inDateRange),
    [items, inDateRange],
  );
  const liveItems = useMemo(
    () => datedItems.filter((item) => !hidden.has(item.hash)),
    [datedItems, hidden],
  );
  const hiddenItems = useMemo(
    () => datedItems.filter((item) => hidden.has(item.hash)),
    [datedItems, hidden],
  );
  const scanning = phase === "signing" || phase === "scanning";
  const signerReady = !!session && !!signer;

  const counts = useMemo(
    () => ({
      all: liveItems.length,
      images: liveItems.filter((item) => item.media === "image").length,
      referenced: liveItems.filter((item) => item.references.length > 0).length,
      unlinked: liveItems.filter((item) => item.referenceState === "unlinked").length,
      unscanned: liveItems.filter((item) => item.referenceState === "unscanned").length,
      hidden: hiddenItems.length,
    }),
    [liveItems, hiddenItems],
  );

  const visible = useMemo(() => {
    switch (filter) {
      case "images":
        return liveItems.filter((item) => item.media === "image");
      case "referenced":
        return liveItems.filter((item) => item.references.length > 0);
      case "unlinked":
        return liveItems.filter((item) => item.referenceState === "unlinked");
      case "unscanned":
        return liveItems.filter((item) => item.referenceState === "unscanned");
      case "hidden":
        return hiddenItems;
      default:
        return liveItems;
    }
  }, [liveItems, hiddenItems, filter]);

  const shown = visible.slice(0, visibleCount);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<WiltedRose size={34} />}
        iconBg="from-slate-600 to-slate-900"
        title="Bloom Reaper"
        subtitle="Every file you've uploaded to Blossom, on every server you use. Find the ones you lost track of, copy their links, or reap them."
        actions={
          phase === "done" || phase === "error" ? (
            <Button variant="secondary" onClick={scan} disabled={!signerReady}>
              <RefreshCw size={15} />
              Rescan
            </Button>
          ) : null
        }
      />

      {phase === "idle" || phase === "error" ? (
        <Panel className="p-6 space-y-4">
          <p className="text-sm text-mid max-w-3xl">
            Every Blossom server keeps a list of what each key uploaded.
            Bloom Reaper gathers your servers — your kind 10063 list,
            Mutable&apos;s defaults, and hosts from your recent posts — asks
            each for everything under your key, and checks your latest posts
            to see which files are still linked and which links point at
            nothing.
          </p>
          <p className="text-sm text-mid max-w-3xl">
            One signature lists them; servers only show a key its own uploads.
            Nothing is deleted without a second signature.
          </p>
          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
              <AlertTriangle size={15} />
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={scan} disabled={!signerReady}>
              <Flower2 size={16} />
              Find my blooms
            </Button>
            {session && !signer ? (
              session.signerType === "nip07" && !hasNip07() ? (
                <span className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                  <AlertTriangle size={14} />
                  Your signer extension isn&apos;t available in this browser, so
                  nothing can be signed here.
                </span>
              ) : (
                <span className="text-sm text-mut flex items-center gap-2">
                  <RefreshCw size={14} className="animate-spin" />
                  Connecting your signer…
                </span>
              )
            ) : null}
          </div>
        </Panel>
      ) : null}

      {phase === "signing" ? (
        <Panel className="p-5 flex items-center gap-3 text-sm text-mid">
          <RefreshCw size={15} className="animate-spin text-mut flex-none" />
          Waiting for your signature — approve the listing request in your
          signer to continue.
        </Panel>
      ) : null}

      {servers.length > 0 && (scanning || serverGroups.length > 0) ? (
        <Panel>
          <PanelHeader
            title="Servers"
            note={
              scanning
                ? `asking ${servers.length}…`
                : `${serverGroups.length} server${serverGroups.length === 1 ? "" : "s"} hold${serverGroups.length === 1 ? "s" : ""} your files`
            }
            actions={
              scanning ? <RefreshCw size={15} className="animate-spin text-mut" /> : null
            }
          />
          <ul className="divide-y divide-line">
            {scanning
              ? servers.map((row) => (
                  <li
                    key={row.server}
                    className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-sm"
                  >
                    <Server size={14} className="text-mut flex-none" />
                    <span className="font-mono text-mid truncate">{serverHost(row.server)}</span>
                    <span className="ml-auto text-xs text-mut">
                      {statusLabels[row.status]}
                    </span>
                  </li>
                ))
              : serverGroups.map((group) => (
                  <li
                    key={group.server}
                    className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-sm"
                  >
                    <Server size={14} className="text-mut flex-none" />
                    <span className="font-mono text-mid truncate">{serverHost(group.server)}</span>
                    {group.mirrors.length > 0 ? (
                      expandedServers.has(group.server) ? (
                        <span className="text-[11px] text-mut">
                          same files on {group.mirrors.map(serverHost).join(", ")}{" "}
                          <button
                            type="button"
                            onClick={() => toggleExpanded(group.server)}
                            className="underline decoration-dotted hover:text-mid"
                          >
                            less
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(group.server)}
                          className="text-[11px] text-mut hover:text-mid text-left"
                          title={`The same files are also listed on ${group.mirrors
                            .map(serverHost)
                            .join(", ")}`}
                        >
                          same files on {serverHost(group.mirrors[0])}
                          {group.mirrors.length > 1
                            ? ` +${group.mirrors.length - 1} more…`
                            : ""}
                        </button>
                      )
                    ) : null}
                    <span className="flex flex-wrap gap-1">
                      {originsOf(group.server).map((origin) => (
                        <span
                          key={origin}
                          className="px-1.5 py-0.5 rounded bg-inset border border-line-2 text-[10px] uppercase tracking-wide text-mut"
                        >
                          {originLabels[origin]}
                        </span>
                      ))}
                    </span>
                    <span className="ml-auto text-xs text-mut">
                      {group.count} blob{group.count === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
          </ul>
        </Panel>
      ) : null}

      {scanning ? (
        <Panel>
          <PanelHeader
            title="Your blooms"
            note={
              phase === "signing"
                ? "waiting for your signature…"
                : servers.length > 0
                  ? `asking ${servers.length} server${servers.length === 1 ? "" : "s"}…`
                  : "asking your servers…"
            }
            actions={<RefreshCw size={15} className="animate-spin text-mut" />}
          />
          <div className="p-5">
            <GallerySkeleton />
          </div>
        </Panel>
      ) : null}

      {phase === "done" ? (
        <>
          <Panel>
            <PanelHeader
              title="Your blooms"
              note={
                items.length === 0
                  ? "nothing listed"
                  : `${items.length} file${items.length === 1 ? "" : "s"}, checked against ${referenceEventCount} event${referenceEventCount === 1 ? "" : "s"}${
                      referenceOldest
                        ? ` back to ${formatUploaded(referenceOldest)}`
                        : ""
                    }`
              }
              actions={
                selectedItems.length > 0 ? (
                  <Button size="sm" onClick={() => setReapTargets(selectedItems)}>
                    <Trash2 size={14} />
                    Reap {selectedItems.length} selected
                  </Button>
                ) : null
              }
            />
            <div className="p-5 space-y-4">
              {items.length === 0 ? (
                <div className="text-sm text-mid space-y-2">
                  <p>
                    {servers.length === 0
                      ? "No server answered the listing request, so this may be a server problem rather than an empty account."
                      : "No server came back with files under your key. Either you haven't uploaded with this key, your uploads went to a server that isn't in your list and isn't linked from your recent posts, or you've reaped everything."}
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-mut">
                    <CalendarDays size={14} className="flex-none" />
                    <span className="font-semibold">Uploaded</span>
                    <input
                      type="date"
                      value={dateFrom}
                      max={dateTo || undefined}
                      onChange={(e) => {
                        setDateFrom(e.target.value);
                        setVisibleCount(GALLERY_PAGE_SIZE);
                      }}
                      className="px-2 py-1 rounded-lg bg-inset border border-line-2 text-mid dark:[color-scheme:dark]"
                      aria-label="From date"
                    />
                    <span aria-hidden="true">→</span>
                    <input
                      type="date"
                      value={dateTo}
                      min={dateFrom || undefined}
                      onChange={(e) => {
                        setDateTo(e.target.value);
                        setVisibleCount(GALLERY_PAGE_SIZE);
                      }}
                      className="px-2 py-1 rounded-lg bg-inset border border-line-2 text-mid dark:[color-scheme:dark]"
                      aria-label="To date"
                    />
                    {presetRanges.map(({ label, days }) => {
                      const active = dateFrom === presetFrom(days) && !dateTo;
                      return (
                        <button
                          key={label}
                          type="button"
                          onClick={() => {
                            setDateFrom(presetFrom(days));
                            setDateTo("");
                            setVisibleCount(GALLERY_PAGE_SIZE);
                          }}
                          className={`px-2 py-1 rounded-full border text-xs font-semibold transition-colors ${
                            active
                              ? "bg-red-500/15 border-red-500/40 text-red-700 dark:text-red-400"
                              : "bg-inset border-line-2 text-mut hover:text-hi"
                          }`}
                          title={`Uploaded in the last ${label}`}
                        >
                          {label}
                        </button>
                      );
                    })}
                    {dateFrom || dateTo ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDateFrom("");
                          setDateTo("");
                          setVisibleCount(GALLERY_PAGE_SIZE);
                        }}
                        className="underline decoration-dotted hover:text-hi"
                      >
                        Clear dates
                      </button>
                    ) : null}
                    {dateFrom || dateTo ? (
                      <span
                        title="Files with an unknown upload date are hidden while a date filter is set."
                      >
                        files with unknown dates are hidden
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {(Object.keys(filterLabels) as GalleryFilter[])
                      .filter(
                        (key) =>
                          (key !== "hidden" && key !== "unscanned") ||
                          counts[key] > 0,
                      )
                      .map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setFilter(key);
                          setVisibleCount(GALLERY_PAGE_SIZE);
                        }}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                          filter === key
                            ? "bg-red-500/15 border-red-500/40 text-red-700 dark:text-red-400"
                            : "bg-inset border-line-2 text-mid hover:text-hi"
                        }`}
                      >
                        {filterLabels[key]} · {counts[key]}
                      </button>
                    ))}
                    {selectedItems.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setSelected(new Set())}
                        className="ml-auto text-xs text-mut hover:text-hi"
                      >
                        Clear selection
                      </button>
                    ) : null}
                  </div>
                  {visible.length === 0 ? (
                    <p className="text-sm text-mut">Nothing matches this filter.</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        {shown.map((item) => (
                          <BlobTile
                            key={item.hash}
                            item={item}
                            dismissed={filter === "hidden"}
                            onToggleDismissed={() => toggleHidden(item.hash)}
                            selected={selected.has(item.hash)}
                            onToggleSelect={() => toggleSelected(item.hash)}
                            onReap={() => setReapTargets([item])}
                          />
                        ))}
                      </div>
                      {visible.length > shown.length ? (
                        <div className="flex justify-center pt-1">
                          <Button
                            variant="secondary"
                            onClick={() => setVisibleCount((count) => count + GALLERY_PAGE_SIZE)}
                          >
                            Load {Math.min(GALLERY_PAGE_SIZE, visible.length - shown.length)} more
                            ({visible.length - shown.length} not shown)
                          </Button>
                        </div>
                      ) : null}
                    </>
                  )}
                  <p className="text-xs text-mut flex items-start gap-2">
                    <AlertTriangle size={13} className="mt-0.5 flex-none" />
                    &ldquo;No link found&rdquo; means none of the scanned
                    events link to it. Files uploaded before{" "}
                    {referenceOldest
                      ? formatUploaded(referenceOldest)
                      : "the scan window"}{" "}
                    are marked &ldquo;not scanned&rdquo; — older posts weren&apos;t
                    fetched. Posts on other relays, images in DMs, and
                    clients that post proxy URLs can&apos;t be matched.
                  </p>
                </>
              )}
            </div>
          </Panel>

          {missing.length > 0 ? (
            <Panel>
              <PanelHeader
                title="Linked but gone"
                note={`${missing.length} file${missing.length === 1 ? "" : "s"} your posts point at that no listed server holds`}
              />
              <ul className="divide-y divide-line">
                {missing.slice(0, missingVisibleCount).map((blob) => {
                  const presence = missingPresence[blob.hash];
                  const posts = blob.references.length;
                  return (
                    <li
                      key={blob.hash}
                      className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm"
                    >
                      <div className="w-10 h-10 rounded-lg overflow-hidden flex-none">
                        {presence === "present" && blob.url ? (
                          <a
                            href={blob.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full h-full flex items-center justify-center text-white/80 bg-slate-500/40 hover:text-white transition-colors"
                            title="Open the file"
                          >
                            <WiltedRose size={20} />
                          </a>
                        ) : (
                          <div className="w-full h-full bg-black/5 dark:bg-white/10 flex items-center justify-center text-mut">
                            <ImageOff size={16} />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-xs text-mut" title={blob.hash}>
                          {shortHash(blob.hash)}
                        </div>
                        <div className="text-xs text-mid truncate" title={blob.url}>
                          {blob.url ? serverHost(blob.url) : "no URL in the post"} · in {posts} post{posts === 1 ? "" : "s"}
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          presence === "present"
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                            : presence === "missing"
                              ? "bg-red-500/15 text-red-700 dark:text-red-400"
                              : "bg-black/5 dark:bg-white/10 text-mut"
                        }`}
                        title={
                          presence === "present"
                            ? "The link still works, but the server didn't list it under your key"
                            : presence === "missing"
                              ? "The link is dead"
                              : presence === "failed"
                                ? "The host couldn't be checked from the browser"
                                : "Checking the link"
                        }
                      >
                        {presence === "present"
                          ? "still online"
                          : presence === "missing"
                            ? "gone"
                            : presence === "failed"
                              ? "couldn't check"
                              : "checking…"}
                      </span>
                      {blob.references[0] ? (
                        <Link
                          href={`/note-nuke?note=${hexToNote(blob.references[0].eventId)}`}
                          className="inline-flex items-center gap-1 text-xs text-mut hover:text-hi"
                          title="Open the newest post that links to it in Note Nuke"
                        >
                          <ExternalLink size={13} />
                          post
                        </Link>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {missing.length > missingVisibleCount ? (
                <div className="flex justify-center py-3 border-t border-line">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setMissingVisibleCount((count) => count + MISSING_PAGE_SIZE)
                    }
                  >
                    Load{" "}
                    {Math.min(MISSING_PAGE_SIZE, missing.length - missingVisibleCount)}{" "}
                    more ({missing.length - missingVisibleCount} not shown)
                  </Button>
                </div>
              ) : null}
            </Panel>
          ) : null}
        </>
      ) : null}

      {reapTargets && signer ? (
        <ReapDialog
          items={reapTargets}
          signer={signer}
          onClose={() => setReapTargets(null)}
          onComplete={handleReaped}
        />
      ) : null}

      {phase === "done" && items.length > 0 ? (
        <p className="text-xs text-mut flex items-center gap-2">
          <Check size={13} />
          Nothing was changed. Reaping asks for a second signature and lists exactly what it will send where.
        </p>
      ) : null}
    </div>
  );
}
