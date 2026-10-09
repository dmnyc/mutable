"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  Lock,
  Pencil,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store";
import { publishTextNote } from "@/lib/nostr";
import { copyToClipboard } from "@/lib/utils/clipboard";
import { getDisplayName, getErrorMessage } from "@/lib/utils/format";
import { getPostedNoteLink } from "@/lib/utils/links";
import { draftableRelays } from "@/lib/draftable/service";
import {
  SharePart,
  noteSegments,
  noteTags,
  shareContent,
} from "@/lib/draftable/share";
import ProfileAvatar from "../ProfileAvatar";
import { useRequestSignIn } from "./DraftableShell";
import MentionEditor from "./MentionEditor";

/** How a linked page unfurls, for the preview. */
export interface LinkPreview {
  url: string;
  image: string;
  title: string;
}

/**
 * Edit a prewritten note, see it the way a Nostr client would show it, then
 * copy it or post it when signed in.
 */
export default function ShareModal({
  title,
  subtitle,
  message,
  preview,
  secondaryLink,
  onClose,
}: {
  title: string;
  subtitle: string;
  message: SharePart[];
  /** The card a client shows for this link, while the link is in the note. */
  preview?: LinkPreview;
  /** Another way to act, shown at the left of the buttons. */
  secondaryLink?: { href: string; label: string };
  onClose: () => void;
}) {
  const { session } = useAuth();
  const { userProfile } = useStore();
  const requestSignIn = useRequestSignIn();
  // The editor keeps mentions as pills and reports the note text, with
  // each pill written out as a nostr: mention.
  const original = useMemo(() => shareContent(message), [message]);
  const [content, setContent] = useState(original);
  const [names, setNames] = useState<Map<string, string>>(
    () =>
      new Map(
        message.flatMap((part) =>
          typeof part === "string" ? [] : [[part.pubkey, part.name]],
        ),
      ),
  );
  const [resetKey, setResetKey] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const relays = useMemo(
    () => draftableRelays(session?.relays),
    [session?.relays],
  );
  const [copied, setCopied] = useState(false);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);
  // Where to open the note once it's posted.
  const [postedLink, setPostedLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const segments = useMemo(() => noteSegments(content), [content]);
  const mentioned = Array.from(
    new Set(segments.flatMap((s) => (s.type === "mention" ? [s.pubkey] : []))),
  );
  const nameFor = (pubkey: string) =>
    names.get(pubkey) ?? `${pubkey.slice(0, 8)}…`;
  const showCard =
    !!preview &&
    segments.some((s) => s.type === "url" && s.value === preview.url);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleCopy = async () => {
    if (await copyToClipboard(content)) {
      setError(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } else {
      setError("Couldn't copy to the clipboard.");
    }
  };

  const handlePost = async () => {
    if (!session || !content.trim()) return;
    setPosting(true);
    setError(null);
    try {
      const result = await publishTextNote(
        content.trim(),
        noteTags(content),
        session.relays,
      );
      if (!result.success) throw new Error(result.error);
      setPosted(true);
      if (result.event) {
        setPostedLink(
          getPostedNoteLink(result.event.id, {
            relays: session.relays,
            author: result.event.pubkey,
          }),
        );
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to publish note"));
    } finally {
      setPosting(false);
    }
  };

  const posterName = session
    ? getDisplayName(userProfile ?? undefined, "You")
    : "You";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="draftable-share-title"
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-200 dark:border-gray-700 p-6 flex items-start justify-between gap-4">
          <div>
            <h2
              id="draftable-share-title"
              className="text-2xl font-bold text-gray-900 dark:text-white mb-1"
            >
              {title}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {subtitle}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Close"
          >
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Preview
            </p>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <ProfileAvatar
                  src={session ? userProfile?.picture : undefined}
                  name={posterName}
                  size="sm"
                />
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  {posterName}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  now
                </span>
              </div>
              <div className="text-[15px] leading-relaxed text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words">
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
                        <span
                          key={i}
                          className="text-purple-600 dark:text-purple-400"
                        >
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
              {showCard && preview && (
                <div className="mt-3 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview.image}
                    alt=""
                    className="w-full aspect-[1200/630] object-cover bg-gray-200 dark:bg-gray-700"
                  />
                  <div className="px-3 py-2">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {new URL(preview.url).host}
                    </p>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                      {preview.title}
                    </p>
                  </div>
                </div>
              )}
            </div>
            {mentioned.length > 0 && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Posting mentions{" "}
                {mentioned.map((pubkey) => nameFor(pubkey)).join(" and ")}, so
                they&apos;ll be notified.
              </p>
            )}
          </div>

          {/* Collapsed until asked for; kept mounted so edits survive. */}
          <div>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setEditorOpen((open) => !open)}
                aria-expanded={editorOpen}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[#4b5320] dark:text-[#b9cc7f] hover:underline"
              >
                <Pencil size={14} />
                {editorOpen ? "Hide editor" : "Edit message"}
                <ChevronDown
                  size={14}
                  className={`transition-transform ${editorOpen ? "rotate-180" : ""}`}
                />
              </button>
              {content !== original && (
                <button
                  type="button"
                  onClick={() => setResetKey((k) => k + 1)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                >
                  <RotateCcw size={12} />
                  Reset
                </button>
              )}
            </div>
            <div className={editorOpen ? "mt-2" : "hidden"}>
              <MentionEditor
                initial={message}
                resetKey={resetKey}
                relays={relays}
                onChange={(nextContent, pillNames) => {
                  setContent(nextContent);
                  setNames((prev) => new Map([...prev, ...pillNames]));
                }}
              />
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          {posted && (
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-300">
              <span>Posted to Nostr.</span>
              {postedLink && (
                <a
                  href={postedLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-semibold underline hover:no-underline"
                >
                  <ExternalLink size={14} />
                  Open in Jumble
                </a>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 p-6 flex flex-wrap items-center gap-3 justify-end">
          {secondaryLink && (
            <a
              href={secondaryLink.href}
              target="_blank"
              rel="noopener noreferrer"
              className="mr-auto inline-flex items-center gap-1.5 text-sm font-medium text-[#4b5320] dark:text-[#b9cc7f] hover:underline"
            >
              <ExternalLink size={14} />
              {secondaryLink.label}
            </a>
          )}
          <button
            onClick={handleCopy}
            disabled={!content.trim()}
            className="h-10 px-4 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors font-medium flex items-center gap-2 disabled:opacity-50"
          >
            {copied ? <Check size={18} /> : <Copy size={18} />}
            {copied ? "Copied" : "Copy"}
          </button>
          {session ? (
            <button
              onClick={handlePost}
              disabled={posting || posted || !content.trim()}
              className="camo camo-button [--camo-x:-40px] [--camo-y:-90px] h-10 px-4 rounded-lg font-bold flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {posting ? (
                <Loader2 size={18} className="animate-spin" />
              ) : posted ? (
                <Check size={18} />
              ) : (
                <Send size={18} />
              )}
              {posting ? "Posting..." : posted ? "Posted" : "Post to Nostr"}
            </button>
          ) : (
            <button
              onClick={() => {
                onClose();
                requestSignIn();
              }}
              className="camo camo-button [--camo-x:-40px] [--camo-y:-90px] h-10 px-4 rounded-lg font-bold flex items-center gap-2"
            >
              <Lock size={18} />
              Connect to post
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
