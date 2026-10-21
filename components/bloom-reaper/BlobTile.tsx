"use client";

import { useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  File,
  ImageOff,
  RefreshCw,
  Trash2,
  Undo2,
  Video,
  X,
} from "lucide-react";
import { formatBytes, shortHash, shortServerHost, type BlobItem } from "@/lib/blossom/inventory";
import { copyToClipboard } from "@/lib/utils/clipboard";

export function formatUploaded(uploaded: number | undefined): string {
  if (!uploaded) return "Upload date unknown";
  try {
    return new Date(uploaded * 1000).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "Upload date unknown";
  }
}

export default function BlobTile({
  item,
  selected,
  dismissed,
  onToggleDismissed,
  onToggleSelect,
  onReap,
}: {
  item: BlobItem;
  selected: boolean;
  /** In the Dismissed view: the button restores instead of dismissing. */
  dismissed: boolean;
  onToggleDismissed: () => void;
  onToggleSelect: () => void;
  onReap: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const posts = item.references.length;

  const linkBadge =
    posts > 0
      ? {
          cls: "bg-emerald-600/90 text-white",
          label: `in ${posts} post${posts === 1 ? "" : "s"}`,
          title: "Linked from your posts",
        }
      : item.referenceState === "unscanned"
        ? {
            cls: "bg-sky-700/90 text-white",
            label: "not scanned",
            title:
              "Uploaded before the oldest event this scan covered — older posts weren't fetched, so it may still be linked",
          }
        : {
            cls: "bg-black/60 text-white/90",
            label: "no link found",
            title: "None of the scanned events link to this blob",
          };

  const handleCopy = async () => {
    if (await copyToClipboard(item.primaryUrl)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  // Previews load on their own; loading="lazy" keeps off-page tiles free and
  // pagination keeps the page short. Blossom only serves the original file,
  // so large images just take their time under the spinner.
  const showImage = item.media === "image" && !broken;

  return (
    <div
      className={`rounded-xl border overflow-hidden bg-black/10 dark:bg-white/5 transition-colors ${
        selected ? "border-red-500/70 ring-1 ring-red-500/40" : "border-line"
      }`}
    >
      <div className="relative h-32 bg-black/10 dark:bg-white/5">
        {showImage ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.primaryUrl}
              alt=""
              loading="lazy"
              decoding="async"
              onLoad={() => setLoaded(true)}
              className={`w-full h-full object-cover ${loaded ? "" : "opacity-0"}`}
              onError={() => setBroken(true)}
            />
            {!loaded ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-mut">
                <RefreshCw size={20} className="animate-spin" />
                <span className="text-[11px]">Loading {formatBytes(item.size)}…</span>
              </div>
            ) : null}
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-mut">
            {item.media === "video" ? (
              <Video size={26} />
            ) : broken ? (
              <ImageOff size={26} />
            ) : (
              <File size={26} />
            )}
            <span className="text-[11px] uppercase tracking-wide">
              {broken ? "didn't load" : item.type || "file"}
            </span>
          </div>
        )}

        <label className="absolute top-2 left-2 flex items-center justify-center w-6 h-6 rounded-md bg-black/60 cursor-pointer">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="h-3.5 w-3.5 accent-red-600"
            aria-label="Select for reaping"
          />
        </label>

        <button
          type="button"
          onClick={onToggleDismissed}
          className="absolute top-2 right-2 flex items-center justify-center w-6 h-6 rounded-md bg-black/60 text-white/80 hover:text-white transition-colors"
          title={
            dismissed
              ? "Restore to the gallery"
              : "Dismiss — hides this tile from the gallery (nothing is deleted)"
          }
        >
          {dismissed ? <Undo2 size={13} /> : <X size={13} />}
        </button>

        <span
          className={`absolute bottom-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-semibold ${linkBadge.cls}`}
          title={linkBadge.title}
        >
          {linkBadge.label}
        </span>
        {item.copies.length > 1 ? (
          <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-black/60 text-white/90">
            {item.copies.length} servers
          </span>
        ) : null}
      </div>

      <div className="p-2.5 space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-xs text-mut">
          <span className="font-mono" title={item.hash}>
            {shortHash(item.hash)}
          </span>
          <span>{formatBytes(item.size)}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {item.copies.map((copy) => (
            <span
              key={copy.server}
              className="px-1.5 py-0.5 rounded bg-inset border border-line-2 text-[10px] text-mid"
              title={copy.url}
            >
              {shortServerHost(copy.server)}
            </span>
          ))}
        </div>
        <div className="text-[11px] text-mut">{formatUploaded(item.uploaded)}</div>
        <div className="flex items-center gap-1.5 pt-0.5">
          <button
            type="button"
            onClick={handleCopy}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-inset border border-line-2 text-xs font-semibold text-mid hover:text-hi hover:border-line-strong transition-colors"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy URL"}
          </button>
          <a
            href={item.primaryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-inset border border-line-2 text-mid hover:text-hi hover:border-line-strong transition-colors"
            title="Open"
          >
            <ExternalLink size={13} />
          </a>
          <button
            type="button"
            onClick={onReap}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Reap (request deletion)"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
