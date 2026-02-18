"use client";

import { useState } from "react";
import { publishTextNote } from "@/lib/nostr";
import { getErrorMessage } from "@/lib/utils/format";
import { copyToClipboard } from "@/lib/utils/clipboard";
import { useAuth } from "@/hooks/useAuth";
import { X, Copy, Check, Send, Loader2 } from "lucide-react";

interface DecimatorShareModalProps {
  decimatedCount: number;
  onClose: () => void;
}

export default function DecimatorShareModal({
  decimatedCount,
  onClose,
}: DecimatorShareModalProps) {
  const { session } = useAuth();
  const [copied, setCopied] = useState(false);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generate the share message
  const getShareMessage = () => {
    const baseUrl = "https://mutable.top";
    return `I just decimated ${decimatedCount} of my follows using Decimator by #Mutable! 💀\n\nCull your follows randomly by any amount you like – it's nothing personal!\n\nTry it here:\n${baseUrl}`;
  };

  // Copy to clipboard
  const handleCopy = async () => {
    const messageToShare = getShareMessage();
    const success = await copyToClipboard(messageToShare);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } else {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = messageToShare;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      } catch (e) {
        setError("Failed to copy to clipboard");
      }
      document.body.removeChild(textArea);
    }
  };

  // Post to Nostr
  const handlePost = async () => {
    if (!session) {
      setError("You must be signed in to post");
      return;
    }

    setPosting(true);
    setError(null);

    try {
      // Build tags
      const tags: string[][] = [
        ["t", "Decimator"],
        ["t", "Mutable"],
        ["client", "Mutable"], // Client tag to show "Posted from Mutable"
      ];

      const messageToShare = getShareMessage();
      const result = await publishTextNote(
        messageToShare,
        tags,
        session.relays,
      );

      if (result.success) {
        setPosted(true);
        setTimeout(() => {
          onClose();
        }, 2000);
      } else {
        setError(result.error || "Failed to publish note");
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to publish note"));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-gray-200 dark:border-gray-700 p-6 flex items-start justify-between">
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
              Share Results
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Share your decimation with others on Nostr
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Message preview */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Message Preview
            </label>
            <div className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-white whitespace-pre-wrap break-words">
              <div>
                I just decimated {decimatedCount} of my follows using Decimator
                by #Mutable! 💀
              </div>
              <br />
              <div>
                Cull your follows randomly by any amount you like – it&apos;s
                nothing personal!
              </div>
              <br />
              <div>Try it here:</div>
              <div>https://mutable.top</div>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="p-3 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {/* Success message */}
          {posted && (
            <div className="p-3 bg-green-100 dark:bg-green-900/30 border border-green-400 dark:border-green-700 rounded-lg">
              <p className="text-sm text-green-700 dark:text-green-300">
                ✓ Posted to Nostr successfully!
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="border-t border-gray-200 dark:border-gray-700 p-6 flex gap-3 justify-end">
          <button
            onClick={handleCopy}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium flex items-center gap-2"
          >
            {copied ? (
              <>
                <Check size={20} />
                Copied!
              </>
            ) : (
              <>
                <Copy size={20} />
                Copy
              </>
            )}
          </button>

          {session && (
            <button
              onClick={handlePost}
              disabled={posting || posted}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {posting ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Posting...
                </>
              ) : posted ? (
                <>
                  <Check size={20} />
                  Posted!
                </>
              ) : (
                <>
                  <Send size={20} />
                  Post to Nostr
                </>
              )}
            </button>
          )}
        </div>

        {/* Sign in prompt */}
        {!session && (
          <div className="px-6 pb-6">
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>Tip:</strong> Sign in to post this directly to Nostr!
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
