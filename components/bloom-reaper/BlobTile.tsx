"use client";

import { useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  File,
  ImageOff,
  RefreshCw,
  Trash2,
  Undo2,
  Video,
  X,
} from "lucide-react";
import { serverHost } from "@/lib/blossom/client";
import { formatBytes, shortHash, type BlobItem } from "@/lib/blossom/inventory";
import { copyToClipboard } from "@/lib/utils/clipboard";
import WiltedRose from "@/components/bloom-reaper/WiltedRose";

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

// A muted, deterministic backdrop per blob, so placeholder tiles are
// tellable apart without loading a single byte of image data.
export function hashGradient(hash: string): string {
  const hue = parseInt(hash.slice(0, 4), 16) % 360;
  return `linear-gradient(135deg, hsl(${hue} 28% 24%), hsl(${(hue + 50) % 360} 24% 12%))`;
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
  const [preview, setPreview] = useState(false);
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const posts = item.references.length;

  const handleCopy = async () => {
    if (await copyToClipboard(item.primaryUrl)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const showImage = item.media === "image" && preview && !broken;

  return (
    <div
      className={`panel rounded-xl border overflow-hidden transition-colors ${
        selected ? "border-red-500/70 ring-1 ring-red-500/40" : "border-line"
      }`}
    >
      <div
        className="relative h-32"
        style={showImage ? undefined : { background: hashGradient(item.hash) }}
      >
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
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
                <RefreshCw size={20} className="animate-spin" />
                <span className="text-[11px]">Loading {formatBytes(item.size)}…</span>
              </div>
            ) : null}
          </>
        ) : item.media === "other" || (preview && broken) ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-white/80">
            {item.media === "other" ? (
              <File size={26} />
            ) : (
              <ImageOff size={26} />
            )}
            <span className="text-[11px] uppercase tracking-wide">
              {item.media === "other" ? item.type || "file" : "didn't load"}
            </span>
          </div>
        ) : item.media === "video" ? (
          <button
            type="button"
            onClick={() => setPreview(true)}
            className="w-full h-full flex flex-col items-center justify-center gap-2 text-white/90 hover:text-white transition-colors"
          >
            <Video size={26} />
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 text-[11px] font-semibold">
              <Eye size={13} />
              Load preview
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setPreview(true)}
            className="w-full h-full group flex flex-col items-center justify-center gap-2 text-white/90 hover:text-white transition-colors"
            title="Load the image (the full file downloads — Blossom has no smaller sizes)"
          >
            <WiltedRose size={26} className="opacity-60 group-hover:opacity-90 transition-opacity" />
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 text-[11px] font-semibold">
              <Eye size={13} />
              Load preview
            </span>
          </button>
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
          className={`absolute bottom-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
            posts > 0
              ? "bg-emerald-600/90 text-white"
              : "bg-black/60 text-white/90"
          }`}
          title={
            posts > 0
              ? "Linked from your posts"
              : "No post in the scan links to this blob"
          }
        >
          {posts > 0 ? `in ${posts} post${posts === 1 ? "" : "s"}` : "orphaned"}
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
              {serverHost(copy.server)}
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
