"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, File, RefreshCw, Trash2, X } from "lucide-react";
import type { Signer } from "@/lib/signers";
import { hexToNote } from "@/lib/nostr";
import {
  deleteBlob,
  mapWithConcurrency,
  signBlossomAuth,
  type BlossomDeleteOutcome,
} from "@/lib/blossom/client";
import { shortHash, shortServerHost, type BlobItem } from "@/lib/blossom/inventory";
import Button from "@/components/system/Button";

export interface ReapResult {
  hash: string;
  server: string;
  outcome: BlossomDeleteOutcome;
}

type Phase = "confirm" | "signing" | "reaping" | "done";

const copyKey = (hash: string, server: string) => `${hash}|${server}`;

function describeOutcome(outcome: BlossomDeleteOutcome): string {
  switch (outcome.status) {
    case "deleted":
      return "Deleted";
    case "missing":
      return "Already gone";
    case "unauthorized":
      return `Refused (HTTP ${outcome.code})`;
    case "failed":
      return outcome.message;
  }
}

export default function ReapDialog({
  items,
  signer,
  onClose,
  onComplete,
}: {
  items: BlobItem[];
  signer: Signer;
  onClose: () => void;
  onComplete: (results: ReapResult[]) => void;
}) {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [error, setError] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Map<string, BlossomDeleteOutcome>>(
    new Map(),
  );

  const copies = useMemo(
    () =>
      items.flatMap((item) =>
        item.copies.map((copy) => ({ item, copy, key: copyKey(item.hash, copy.server) })),
      ),
    [items],
  );
  const selected = copies.filter((entry) => !excluded.has(entry.key));
  const selectedHashes = Array.from(new Set(selected.map((entry) => entry.item.hash)));
  const linkedPosts = useMemo(() => {
    const seen = new Map<string, number>();
    for (const item of items) {
      for (const reference of item.references) {
        if (!seen.has(reference.eventId)) seen.set(reference.eventId, reference.kind);
      }
    }
    return Array.from(seen.entries());
  }, [items]);

  const toggle = (key: string) => {
    setExcluded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const reap = async () => {
    if (selected.length === 0) return;
    setError(null);
    setPhase("signing");
    let auth: string;
    try {
      auth = await signBlossomAuth(signer, "delete", { hashes: selectedHashes });
    } catch (err) {
      setPhase("confirm");
      setError(
        err instanceof Error && err.message
          ? `Signing failed: ${err.message}`
          : "Signing was declined.",
      );
      return;
    }

    setPhase("reaping");
    const collected: ReapResult[] = [];
    await mapWithConcurrency(selected, 4, async ({ item, copy, key }) => {
      const outcome = await deleteBlob(copy.server, item.hash, auth);
      collected.push({ hash: item.hash, server: copy.server, outcome });
      setResults((previous) => new Map(previous).set(key, outcome));
    });
    setPhase("done");
    onComplete(collected);
  };

  const tally = useMemo(() => {
    let gone = 0;
    let failed = 0;
    for (const outcome of results.values()) {
      if (outcome.status === "deleted" || outcome.status === "missing") gone += 1;
      else failed += 1;
    }
    return { gone, failed };
  }, [results]);

  const busy = phase === "signing" || phase === "reaping";

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      style={{ margin: 0 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reap-dialog-title"
    >
      <div className="panel relative rounded-2xl border border-line shadow-panel w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-red-500/15 text-red-600 dark:text-red-400 flex items-center justify-center flex-none">
              <Trash2 size={22} />
            </div>
            <div>
              <h2
                id="reap-dialog-title"
                className="font-display font-bold text-2xl tracking-tight text-hi"
              >
                {phase === "done" ? "Reaped" : "Reap these blooms?"}
              </h2>
              <p className="text-sm text-mut">
                {phase === "done"
                  ? `${tally.gone} of ${results.size} copies gone${
                      tally.failed ? `, ${tally.failed} refused or failed` : ""
                    }.`
                  : `${selected.length} cop${selected.length === 1 ? "y" : "ies"} of ${items.length} blob${
                      items.length === 1 ? "" : "s"
                    } will be deleted. One signature covers them all.`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-mut hover:text-hi disabled:opacity-40"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <ul className="space-y-3">
            {items.map((item) => (
              <li
                key={item.hash}
                className="flex gap-3 rounded-xl border border-line bg-inset p-3"
              >
                <div className="w-16 h-16 rounded-lg overflow-hidden bg-black/10 dark:bg-white/10 flex-none">
                  {item.media !== "image" ? (
                    <div className="w-full h-full flex items-center justify-center text-mut">
                      <File size={18} />
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.primaryUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="font-mono text-xs text-mut" title={item.hash}>
                    {shortHash(item.hash)}
                  </div>
                  <div className="space-y-1">
                    {item.copies.map((copy) => {
                      const key = copyKey(item.hash, copy.server);
                      const outcome = results.get(key);
                      const isSelected = !excluded.has(key);
                      return (
                        <label
                          key={key}
                          className="flex items-center gap-2 text-sm text-mid"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={phase !== "confirm"}
                            onChange={() => toggle(key)}
                            className="h-4 w-4 accent-red-600"
                          />
                          <span className="flex-1 truncate" title={copy.server}>
                            {shortServerHost(copy.server)}
                          </span>
                          {outcome ? (
                            <span
                              className={`inline-flex items-center gap-1 text-xs font-semibold ${
                                outcome.status === "deleted" || outcome.status === "missing"
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-red-600 dark:text-red-400"
                              }`}
                            >
                              {outcome.status === "deleted" || outcome.status === "missing" ? (
                                <Check size={13} />
                              ) : (
                                <AlertTriangle size={13} />
                              )}
                              {describeOutcome(outcome)}
                            </span>
                          ) : phase === "reaping" && isSelected ? (
                            <RefreshCw size={13} className="animate-spin text-mut" />
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {phase !== "done" ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-mid space-y-2">
              <p className="font-semibold text-hi flex items-center gap-2">
                <AlertTriangle size={15} className="text-amber-600 dark:text-amber-400" />
                This is a request, not a guarantee
              </p>
              <ul className="list-disc pl-5 space-y-1 text-[13px]">
                <li>Each server is asked separately. A copy on another server stays until it is reaped there too.</li>
                <li>A server only drops your claim on the file. If someone else uploaded the same bytes, it stays online, and anyone can re-upload identical bytes later.</li>
                <li>Copies already fetched by clients, caches or mirrors are out of reach.</li>
                {linkedPosts.length > 0 ? (
                  <li>
                    {linkedPosts.length === 1
                      ? "One of your posts still links to this file"
                      : `${linkedPosts.length} of your posts still link to these files`}{" "}
                    and will show a broken image. Delete the post too with Note Nuke:{" "}
                    {linkedPosts.slice(0, 5).map(([eventId, kind], index) => (
                      <span key={eventId}>
                        {index > 0 ? ", " : ""}
                        <Link
                          href={`/note-nuke?note=${hexToNote(eventId)}`}
                          target="_blank"
                          className="font-mono text-red-600 dark:text-red-400 hover:underline"
                        >
                          {kind === 0 ? "your profile" : hexToNote(eventId).slice(0, 14) + "…"}
                        </Link>
                      </span>
                    ))}
                    {linkedPosts.length > 5 ? ` and ${linkedPosts.length - 5} more` : ""}
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2.5">
            {phase === "done" ? (
              <Button onClick={onClose}>Done</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={onClose} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  onClick={reap}
                  disabled={busy || selected.length === 0}
                  className="min-w-[160px]"
                >
                  {busy ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : (
                    <Trash2 size={16} />
                  )}
                  {phase === "signing"
                    ? "Waiting for signature…"
                    : phase === "reaping"
                      ? "Reaping…"
                      : `Sign & reap ${selected.length}`}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
