"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Loader2, Lock, Send, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { publishTextNote } from "@/lib/nostr";
import { copyToClipboard } from "@/lib/utils/clipboard";
import { getErrorMessage } from "@/lib/utils/format";
import { SharePart, shareContent, shareMentions } from "@/lib/draftable/share";
import { useRequestSignIn } from "./DraftableShell";

/** Copy a share message, or post it as a note when signed in. */
export default function ShareModal({
  title,
  subtitle,
  message,
  onClose,
}: {
  title: string;
  subtitle: string;
  message: SharePart[];
  onClose: () => void;
}) {
  const { session } = useAuth();
  const requestSignIn = useRequestSignIn();
  const [copied, setCopied] = useState(false);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const content = shareContent(message);
  const mentions = message.filter(
    (part): part is Exclude<SharePart, string> => typeof part !== "string",
  );

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
    if (!session) return;
    setPosting(true);
    setError(null);
    try {
      const result = await publishTextNote(
        content,
        [
          ...shareMentions(message).map((pubkey) => ["p", pubkey]),
          ["t", "Draftable"],
          ["t", "Mutable"],
          ["client", "Mutable"],
        ],
        session.relays,
      );
      if (!result.success) throw new Error(result.error);
      setPosted(true);
      setTimeout(onClose, 2000);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to publish note"));
    } finally {
      setPosting(false);
    }
  };

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

        <div className="p-6 space-y-4">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Message preview
            </p>
            <div className="px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-white whitespace-pre-wrap break-words">
              {message.map((part, i) =>
                typeof part === "string" ? (
                  part
                ) : (
                  <span
                    key={i}
                    className="font-medium text-[#4b5320] dark:text-[#b9cc7f]"
                  >
                    @{part.name}
                  </span>
                ),
              )}
            </div>
            {mentions.length > 0 && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Posting mentions {mentions.map((m) => m.name).join(" and ")}, so
                they&apos;ll be notified.
              </p>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          {posted && (
            <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-300">
              Posted to Nostr.
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 p-6 flex flex-wrap gap-3 justify-end">
          <button
            onClick={handleCopy}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors font-medium flex items-center gap-2"
          >
            {copied ? <Check size={18} /> : <Copy size={18} />}
            {copied ? "Copied" : "Copy"}
          </button>
          {session ? (
            <button
              onClick={handlePost}
              disabled={posting || posted}
              className="px-4 py-2 bg-[#4b5320] text-white rounded-lg hover:bg-[#3c4419] transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
              className="px-4 py-2 bg-[#4b5320] text-white rounded-lg hover:bg-[#3c4419] transition-colors font-medium flex items-center gap-2"
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
