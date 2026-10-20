"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import type { Filter } from "nostr-tools";
import {
  AlertTriangle,
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
  mapWithConcurrency,
  probeUrl,
  serverHost,
  type BlobPresence,
} from "@/lib/blossom/client";
import type { BlossomServerEntry, BlossomServerOrigin } from "@/lib/blossom/servers";
import { DEFAULT_REFERENCE_LIMIT, type ReferenceIndex } from "@/lib/blossom/references";
import {
  findMissingBlobs,
  removeReapedCopies,
  shortHash,
  type BlobItem,
  type MissingBlob,
} from "@/lib/blossom/inventory";
import { BlossomSigningError, scanBlossom, type BlossomScan } from "@/lib/blossom/scan";
import PageHeader from "@/components/system/PageHeader";
import Panel, { PanelHeader } from "@/components/system/Panel";
import Button from "@/components/system/Button";
import BlobTile from "@/components/bloom-reaper/BlobTile";
import ReapDialog, { type ReapResult } from "@/components/bloom-reaper/ReapDialog";

type ServerStatus = "pending" | "ok" | "unauthorized" | "unsupported" | "failed";

interface ServerRow extends BlossomServerEntry {
  status: ServerStatus;
  count?: number;
  message?: string;
}

type Phase = "idle" | "signing" | "scanning" | "done" | "error";
type GalleryFilter = "all" | "images" | "referenced" | "orphaned";

const RELAY_MAX_WAIT_MS = 8000;
const PROBE_CONCURRENCY = 4;

const originLabels: Record<BlossomServerOrigin, string> = {
  list: "your list",
  mutable: "mutable",
  referenced: "in your posts",
};

const statusLabels: Record<ServerStatus, string> = {
  pending: "asking…",
  ok: "listed",
  unauthorized: "refused",
  unsupported: "listing unavailable",
  failed: "failed",
};

const statusStyles: Record<ServerStatus, string> = {
  pending: "bg-black/5 dark:bg-white/10 text-mut",
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  unauthorized: "bg-red-500/15 text-red-700 dark:text-red-400",
  unsupported: "bg-black/5 dark:bg-white/10 text-mut",
  failed: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
};

const filterLabels: Record<GalleryFilter, string> = {
  all: "All",
  images: "Images",
  referenced: "In your posts",
  orphaned: "Orphaned",
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reapTargets, setReapTargets] = useState<BlobItem[] | null>(null);
  const [referenceEventCount, setReferenceEventCount] = useState(0);

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
    setItems(scanResult.items);
    setMissing(scanResult.missing);
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

  const counts = useMemo(
    () => ({
      all: items.length,
      images: items.filter((item) => item.media === "image").length,
      referenced: items.filter((item) => item.references.length > 0).length,
      orphaned: items.filter((item) => item.references.length === 0).length,
    }),
    [items],
  );

  const visible = useMemo(() => {
    switch (filter) {
      case "images":
        return items.filter((item) => item.media === "image");
      case "referenced":
        return items.filter((item) => item.references.length > 0);
      case "orphaned":
        return items.filter((item) => item.references.length === 0);
      default:
        return items;
    }
  }, [items, filter]);

  const toggleSelected = (hash: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  };

  const selectedItems = items.filter((item) => selected.has(item.hash));
  const listedServers = servers.filter((row) => row.status === "ok").length;
  const scanning = phase === "signing" || phase === "scanning";
  const signerReady = !!session && !!signer;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Flower2 size={26} />}
        iconBg="from-rose-500 to-red-700"
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
            Blossom servers store files by their hash, and they keep a list of
            what each key uploaded. Bloom Reaper reads your Blossom server
            list (kind 10063), adds the servers Mutable uploads to and any host
            your posts link from, and asks each one for everything under your
            key. Your latest posts are checked too, so you can see which files
            are still linked and which links now point at nothing.
          </p>
          <p className="text-sm text-mid max-w-3xl">
            Listing needs one signature: servers only show a key its own
            uploads. Nothing is deleted without a second, separate signature.
          </p>
          <p className="text-xs text-mut max-w-3xl">
            Images shared from Snoopable while signed out were uploaded under a
            throwaway key. They can&apos;t be listed or reaped by anyone, only
            reached through the link you got at the time.
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

      {phase !== "idle" ? (
        <Panel>
          <PanelHeader
            title="Servers"
            note={
              scanning
                ? phase === "signing"
                  ? "waiting for your signature"
                  : "asking each server"
                : `${listedServers} of ${servers.length} answered with a list`
            }
            actions={
              scanning ? <RefreshCw size={15} className="animate-spin text-mut" /> : null
            }
          />
          <ul className="divide-y divide-line">
            {servers.map((row) => (
              <li
                key={row.server}
                className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-sm"
              >
                <Server size={14} className="text-mut flex-none" />
                <span className="font-mono text-mid truncate">{serverHost(row.server)}</span>
                <span className="flex flex-wrap gap-1">
                  {row.origins.map((origin) => (
                    <span
                      key={origin}
                      className="px-1.5 py-0.5 rounded bg-inset border border-line-2 text-[10px] uppercase tracking-wide text-mut"
                    >
                      {originLabels[origin]}
                    </span>
                  ))}
                </span>
                <span className="ml-auto flex items-center gap-2 text-xs">
                  {row.status === "ok" ? (
                    <span className="text-mut">
                      {row.count} blob{row.count === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  <span
                    className={`px-2 py-0.5 rounded-full font-semibold ${statusStyles[row.status]}`}
                    title={row.message || statusLabels[row.status]}
                  >
                    {statusLabels[row.status]}
                  </span>
                </span>
              </li>
            ))}
            {servers.length === 0 && phase === "signing" ? (
              <li className="px-5 py-3 text-sm text-mut">
                Sign the listing request in your signer to continue.
              </li>
            ) : null}
          </ul>
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
                  : `${items.length} file${items.length === 1 ? "" : "s"}, checked against your latest ${referenceEventCount} events`
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
                    {listedServers === 0
                      ? "No server answered the listing request, so this may be a server problem rather than an empty account."
                      : "Nothing is listed under your key on these servers. Either you haven't uploaded with this key, your uploads went to a server that isn't in your list and isn't linked from your recent posts, or you've reaped everything."}
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    {(Object.keys(filterLabels) as GalleryFilter[]).map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setFilter(key)}
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
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      {visible.map((item) => (
                        <BlobTile
                          key={item.hash}
                          item={item}
                          selected={selected.has(item.hash)}
                          onToggleSelect={() => toggleSelected(item.hash)}
                          onReap={() => setReapTargets([item])}
                        />
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-mut flex items-start gap-2">
                    <AlertTriangle size={13} className="mt-0.5 flex-none" />
                    &ldquo;Orphaned&rdquo; means none of your latest{" "}
                    {Math.min(referenceEventCount, DEFAULT_REFERENCE_LIMIT) || DEFAULT_REFERENCE_LIMIT}{" "}
                    events link to it. Older posts, other people&apos;s posts and
                    DMs weren&apos;t checked.
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
                {missing.map((blob) => {
                  const presence = missingPresence[blob.hash];
                  const posts = blob.references.length;
                  return (
                    <li
                      key={blob.hash}
                      className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm"
                    >
                      <div className="w-10 h-10 rounded-lg overflow-hidden bg-black/5 dark:bg-white/10 flex items-center justify-center flex-none text-mut">
                        {presence === "present" && blob.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={blob.url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <ImageOff size={16} />
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
