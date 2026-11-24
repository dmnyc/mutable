"use client";

import { useMemo } from "react";
import ProfileAvatar from "@/components/ProfileAvatar";
import { buildPreviewParts } from "@/lib/notePreview";

export interface QuotedNote {
  content: string;
  /** Unix seconds; shown as a date on the quoted card. */
  createdAt: number;
  authorName?: string;
  authorPicture?: string;
}

interface NotePreviewProps {
  /** The exact note text that will be published. */
  content: string;
  authorName: string;
  authorPicture?: string;
  /** Right-hand label, "now" for a note that hasn't been posted yet. */
  timestampLabel?: string;
  /** Names for nostr:npub mentions; unknown ones fall back to a short key. */
  mentionNames?: Record<string, string>;
  /** Pictures shown under the text, e.g. an image that uploads on publish. */
  images?: string[];
  /** The note being quoted, rendered as an embedded card. */
  quote?: QuotedNote;
}

function formatQuoteDate(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * A note as a Nostr client would show it: avatar, name, linked hashtags,
 * mentions, inline images, and quoted notes. Display-only — it renders the
 * same text that gets signed, so what people confirm is what gets posted.
 */
export default function NotePreview({
  content,
  authorName,
  authorPicture,
  timestampLabel = "now",
  mentionNames = {},
  images = [],
  quote,
}: NotePreviewProps) {
  const { segments, inlineImages } = useMemo(
    () => buildPreviewParts(content, { quoted: Boolean(quote) }),
    [content, quote],
  );

  const allImages = [...inlineImages, ...images];
  const nameFor = (pubkey: string) =>
    mentionNames[pubkey] ?? `${pubkey.slice(0, 8)}…`;

  return (
    <div className="rounded-xl border border-line-2 bg-inset p-4 text-left shadow-sm">
      <div className="flex items-center gap-2.5 mb-2.5">
        <ProfileAvatar src={authorPicture} name={authorName} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-hi truncate leading-tight">
            {authorName}
          </p>
          <p className="text-xs text-mut leading-tight">
            {timestampLabel} · via Mutable
          </p>
        </div>
      </div>

      <div className="text-[15px] leading-relaxed text-hi whitespace-pre-wrap break-words [text-wrap:pretty]">
        {segments.map((segment, i) => {
          switch (segment.type) {
            case "mention":
              return (
                <span
                  key={i}
                  className="font-medium text-purple-600 dark:text-purple-400"
                >
                  @{nameFor(segment.pubkey)}
                </span>
              );
            case "hashtag":
              return (
                <span key={i} className="text-purple-600 dark:text-purple-400">
                  {segment.value}
                </span>
              );
            case "url":
              return (
                <span
                  key={i}
                  className="text-purple-600 dark:text-purple-400 underline break-all"
                >
                  {segment.value}
                </span>
              );
            default:
              return <span key={i}>{segment.value}</span>;
          }
        })}
      </div>

      {allImages.map((src) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt="Attached to the note"
          className="mt-3 w-full rounded-lg border border-line object-contain bg-black/5 dark:bg-white/5"
        />
      ))}

      {quote && (
        <div className="mt-3 rounded-lg border border-line bg-white/60 dark:bg-black/20 px-3.5 py-3">
          <div className="flex items-center gap-2 mb-1.5">
            <ProfileAvatar
              src={quote.authorPicture}
              name={quote.authorName}
              size="sm"
              className="!w-5 !h-5"
            />
            <span className="text-xs font-semibold text-hi truncate">
              {quote.authorName ?? "Anonymous"}
            </span>
            <span className="text-xs text-mut flex-none">
              · {formatQuoteDate(quote.createdAt)}
            </span>
          </div>
          <p className="text-sm leading-snug text-mid whitespace-pre-wrap break-words line-clamp-4">
            {quote.content || "(empty note)"}
          </p>
        </div>
      )}
    </div>
  );
}
