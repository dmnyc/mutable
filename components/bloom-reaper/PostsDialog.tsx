"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { File, Link2, Trash2, Video, X } from "lucide-react";
import { hexToNote } from "@/lib/nostr";
import {
  shortHash,
  type BlobItem,
  type BlobMedia,
} from "@/lib/blossom/inventory";
import type { BlobReference } from "@/lib/blossom/references";
import PostLinks from "./PostLinks";

const KIND_LABELS: Record<number, string> = {
  0: "profile",
  1: "note",
  20: "picture",
  1063: "file metadata",
  1111: "comment",
  30023: "article",
  34235: "emoji pack",
  34236: "emoji pack",
  39089: "follow pack",
};

const formatDate = (createdAt: number) =>
  new Date(createdAt * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

/**
 * Every post we saw referencing a blob, newest first, each with the ways to
 * act on it: Note Nuke, the exact URL as posted, the post ID, and Jumble.
 */
export default function PostsDialog({
  hash,
  references,
  previewUrl,
  media,
  emptyMessage,
  fileUrl,
  onDelete,
  onClose,
}: {
  hash: string;
  references: BlobReference[];
  previewUrl: string;
  media: BlobMedia;
  /** Shown instead of the list when no referencing post was found. */
  emptyMessage?: string;
  /** The file's own URL — offered in the empty state. */
  fileUrl?: string;
  /** Reap flow for the file itself, offered in the empty state. */
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const showPreview =
    (media === "image" || media === "video") && !broken;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="posts-dialog-title"
    >
      <div className="panel relative rounded-2xl border border-line shadow-panel w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 px-6 pt-6">
          <div className="min-w-0">
            <h2
              id="posts-dialog-title"
              className="font-display font-bold text-2xl tracking-tight text-hi"
            >
              {references.length > 0 ? "Posts using this media" : "No posts found"}
            </h2>
            <p className="text-xs text-mut font-mono mt-1.5" title={hash}>
              {shortHash(hash)} · {references.length}{" "}
              reference{references.length === 1 ? "" : "s"}
              {references.length > 0 ? ", newest first" : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-mut hover:text-hi mt-1"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 pt-3">
          <div
            className={`relative w-full h-44 rounded-xl overflow-hidden border border-line-2 bg-black/10 dark:bg-white/10 ${
              showPreview ? "cursor-pointer" : ""
            }`}
            onClick={
              showPreview
                ? () => window.open(previewUrl, "_blank", "noopener,noreferrer")
                : undefined
            }
            title={showPreview ? "Open full size in a new tab" : undefined}
          >
            {showPreview ? (
              media === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={() => setBroken(true)}
                />
              ) : (
                <video
                  src={previewUrl.includes("#") ? previewUrl : `${previewUrl}#t=0.1`}
                  preload="metadata"
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                  onError={() => setBroken(true)}
                />
              )
            ) : (
              <div className="w-full h-full flex items-center justify-center text-mut">
                {media === "video" ? <Video size={24} /> : <File size={24} />}
              </div>
            )}
            {media === "video" && !broken ? (
              <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-black/60 text-white/90">
                <Video size={11} />
                video
              </span>
            ) : null}
          </div>
        </div>

        {references.length > 0 ? (
          <ul className="px-6 pb-6 pt-3 space-y-2 max-h-[55vh] overflow-y-auto">
          {references.map((reference) => (
            <li
              key={reference.eventId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-line-2 bg-inset px-3.5 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm text-mid">
                  {KIND_LABELS[reference.kind] ?? `kind ${reference.kind}`}{" "}
                  <span className="text-mut">
                    · {formatDate(reference.createdAt)}
                  </span>
                </div>
                <div className="font-mono text-xs text-mut" title={reference.eventId}>
                  {shortHash(reference.eventId)}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <Link
                  href={`/note-nuke?note=${hexToNote(reference.eventId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-mut hover:text-hi transition-colors"
                  title="Open this post in Note Nuke (new tab)"
                >
                  <Trash2 size={12} />
                  delete
                </Link>
                {reference.url ? (
                  <a
                    href={reference.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-mut hover:text-hi transition-colors"
                    title="Open the link exactly as it was posted (new tab)"
                  >
                    <Link2 size={12} />
                    url
                  </a>
                ) : null}
                <PostLinks eventId={reference.eventId} kind={reference.kind} />
              </div>
            </li>
          ))}
        </ul>
        ) : (
          <div className="mx-6 mb-6 mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-line-2 bg-inset px-3.5 py-3">
            <p className="min-w-0 flex-1 text-sm text-mid">{emptyMessage}</p>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {onDelete ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onDelete();
                  }}
                  className="inline-flex items-center gap-1 text-mut hover:text-hi transition-colors"
                  title="Reap this file from your servers"
                >
                  <Trash2 size={12} />
                  delete
                </button>
              ) : null}
              {fileUrl ? (
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-mut hover:text-hi transition-colors"
                  title="Open the file's URL (new tab)"
                >
                  <Link2 size={12} />
                  url
                </a>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
