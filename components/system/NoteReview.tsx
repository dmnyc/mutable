"use client";

import { ArrowLeft, Loader2, Send } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store";
import { getDisplayName } from "@/lib/utils/format";
import NotePreview, { QuotedNote } from "./NotePreview";

interface NoteReviewProps {
  content: string;
  /** Tags that ride with the note; hashtags and mentions are summarized. */
  tags: string[][];
  mentionNames?: Record<string, string>;
  images?: string[];
  quote?: QuotedNote;
  /** Extra line under the preview, e.g. "The image uploads when you post." */
  footnote?: string;
  posting?: boolean;
  /** Progress label while posting, e.g. "Uploading image…". */
  postingLabel?: string;
  error?: string | null;
  confirmLabel?: string;
  onBack: () => void;
  onConfirm: () => void;
  /** Which accent the confirm button wears; matches the host modal. */
  accent?: "primary" | "green" | "red" | "purple";
}

const ACCENTS: Record<NonNullable<NoteReviewProps["accent"]>, string> = {
  primary: "bg-gradient-to-b from-primary to-primary-deep",
  green: "bg-gradient-to-b from-green-600 to-green-800",
  red: "bg-red-600 hover:bg-red-700",
  purple: "bg-purple-600 hover:bg-purple-700",
};

/**
 * The confirm step every "post to Nostr" flow shares: the note drawn the way
 * a client will show it, what gets tagged, then Back or Post. Nothing is
 * signed or sent until onConfirm fires.
 */
export default function NoteReview({
  content,
  tags,
  mentionNames,
  images,
  quote,
  footnote,
  posting = false,
  postingLabel = "Posting…",
  error,
  confirmLabel = "Post to Nostr",
  onBack,
  onConfirm,
  accent = "primary",
}: NoteReviewProps) {
  const { session } = useAuth();
  const { userProfile } = useStore();
  const authorName = session
    ? getDisplayName(userProfile ?? undefined, "You")
    : "You";

  const hashtags = Array.from(
    new Set(tags.filter((t) => t[0] === "t").map((t) => `#${t[1]}`)),
  );
  const mentions = tags.filter(
    (t) => t[0] === "p" && t[1] !== session?.pubkey,
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-mut">Nothing posts until you confirm.</p>

      <NotePreview
        content={content}
        authorName={authorName}
        authorPicture={session ? userProfile?.picture : undefined}
        mentionNames={mentionNames}
        images={images}
        quote={quote}
      />

      {(hashtags.length > 0 || mentions.length > 0 || footnote) && (
        <div className="space-y-2">
          {hashtags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {hashtags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-px rounded-full bg-purple-500/15 text-xs font-semibold text-purple-600 dark:text-purple-400"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          {(mentions.length > 0 || footnote) && (
            <p className="text-xs text-mut text-balance">
              {[
                mentions.length > 0 ? "Notifies anyone mentioned." : null,
                footnote,
              ]
                .filter(Boolean)
                .join(" ")}
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={posting}
          className="flex-1 px-4 py-2 bg-inset border border-line-2 text-mid hover:text-hi rounded-[10px] text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <ArrowLeft size={15} />
          Back
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={posting}
          className={`flex-1 px-4 py-2 text-white rounded-[10px] text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 ${ACCENTS[accent]}`}
        >
          {posting ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Send size={15} />
          )}
          {posting ? postingLabel : confirmLabel}
        </button>
      </div>
    </div>
  );
}
