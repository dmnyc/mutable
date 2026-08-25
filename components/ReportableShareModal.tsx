"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Profile } from "@/types";
import { publishTextNote, hexToNpub } from "@/lib/nostr";
import {
  getDisplayName as getDisplayNameUtil,
  getErrorMessage,
} from "@/lib/utils/format";
import { copyToClipboard } from "@/lib/utils/clipboard";
import { useAuth } from "@/hooks/useAuth";
import { getReportScore } from "@/lib/utils/reportScore";
import { X, Copy, Check, Send, Loader2 } from "lucide-react";

interface ReportableShareModalProps {
  targetProfile: Profile;
  /** Total report events found. */
  resultCount: number;
  /** Distinct accounts that filed those reports — what the score is based on. */
  uniqueReporterCount: number;
  /** Report events the target has filed against others. */
  filedCount?: number;
  onClose: () => void;
}

export default function ReportableShareModal({
  targetProfile,
  resultCount,
  uniqueReporterCount,
  filedCount,
  onClose,
}: ReportableShareModalProps) {
  const { session } = useAuth();
  // Pre-check "This is me!" whenever the results being shared are the signed-in
  // user's own — covers Check my Reports, a self npub paste, and ?npub= links.
  const isSelf = session?.pubkey === targetProfile.pubkey;
  const [isMe, setIsMe] = useState(isSelf);
  const [includeFiled, setIncludeFiled] = useState(false);
  const [copied, setCopied] = useState(false);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get display name or fallback to npub
  const getDisplayName = () => {
    const npub = hexToNpub(targetProfile.pubkey);
    return getDisplayNameUtil(targetProfile, `@${npub.substring(0, 16)}...`);
  };

  // Generate the actual share message (with nostr:npub for posting)
  const getActualShareMessage = (
    isMeValue: boolean = isMe,
    includeFiledValue: boolean = includeFiled,
  ) => {
    const npub = hexToNpub(targetProfile.pubkey);
    const baseUrl = "https://mutable.top/reportable";
    const reportScore = getReportScore(uniqueReporterCount);

    const scoreBlock = `${reportScore.emoji} Report Score: ${reportScore.label} (${uniqueReporterCount} unique reporter${
      uniqueReporterCount === 1 ? "" : "s"
    })`;

    const filedBlock =
      includeFiledValue && filedCount !== undefined
        ? `\n\n📄 Reports filed against others: ${filedCount}`
        : "";

    if (isMeValue) {
      return `I just checked my public report history with Reportable by #Mutable. I have ${resultCount} public report${
        resultCount === 1 ? "" : "s"
      } on my permanent record.\n\n${scoreBlock}${filedBlock}\n\nCheck your reports here: 🚩\n${baseUrl}`;
    } else {
      // Include nostr: mention so clients will parse it and create a clickable link
      return `Hey nostr:${npub}, I just looked up your public report history with Reportable by #Mutable. You have ${resultCount} public report${
        resultCount === 1 ? "" : "s"
      } on your permanent record.\n\n${scoreBlock}${filedBlock}\n\nCheck your reports here: 🚩\n${baseUrl}`;
    }
  };

  // Update message when isMe changes
  const handleIsMeChange = (checked: boolean) => {
    setIsMe(checked);
  };

  // Copy to clipboard
  const handleCopy = async () => {
    const messageToShare = getActualShareMessage(isMe, includeFiled);
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
        ["p", targetProfile.pubkey], // Tag the target user
        ["t", "Reportable"],
        ["t", "Mutable"],
        ["client", "Mutable"], // Client tag to show "Posted from Mutable"
      ];

      const messageToShare = getActualShareMessage(isMe, includeFiled);
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

  return createPortal(
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
              Share this discovery with others on Nostr
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
          {/* This is me checkbox */}
          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
            <div className="flex items-start gap-3">
              <div className="flex items-center h-5">
                <input
                  type="checkbox"
                  id="reportable-isMe"
                  checked={isMe}
                  onChange={(e) => handleIsMeChange(e.target.checked)}
                  className="w-4 h-4 text-red-600 bg-gray-100 border-gray-300 rounded focus:ring-red-500 dark:focus:ring-red-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                />
              </div>
              <div className="flex-1">
                <label
                  htmlFor="reportable-isMe"
                  className="text-sm font-bold text-yellow-900 dark:text-yellow-100 cursor-pointer block mb-1"
                >
                  This is me!
                </label>
                <p className="text-xs text-yellow-800 dark:text-yellow-200">
                  Sharing your own Reportable results?
                </p>
              </div>
            </div>
          </div>

          {/* Include filed count checkbox */}
          {filedCount !== undefined && (
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <div className="flex items-start gap-3">
                <div className="flex items-center h-5">
                  <input
                    type="checkbox"
                    id="reportable-includeFiled"
                    checked={includeFiled}
                    onChange={(e) => setIncludeFiled(e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                </div>
                <div className="flex-1">
                  <label
                    htmlFor="reportable-includeFiled"
                    className="text-sm font-bold text-blue-900 dark:text-blue-100 cursor-pointer block mb-1"
                  >
                    Include filed count
                  </label>
                  <p className="text-xs text-blue-800 dark:text-blue-200">
                    Also share how many public reports{" "}
                    {isMe ? "you have" : `${getDisplayName()} has`} filed
                    against others ({filedCount} on record)
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Message preview */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Message Preview
            </label>
            {!isMe ? (
              <div className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-white whitespace-pre-wrap break-words">
                <div>
                  Hey{" "}
                  <span className="text-blue-600 dark:text-blue-400 font-medium">
                    {getDisplayName()}
                  </span>
                  , I just looked up your public report history with Reportable
                  by #Mutable. You have {resultCount} public report
                  {resultCount === 1 ? "" : "s"} on your permanent record.
                </div>
                <br />
                <div>
                  {getReportScore(uniqueReporterCount).emoji} Report Score:{" "}
                  {getReportScore(uniqueReporterCount).label} ({uniqueReporterCount}{" "}
                  unique reporter{uniqueReporterCount === 1 ? "" : "s"})
                </div>
                <br />
                {includeFiled && filedCount !== undefined && (
                  <>
                    <div>
                      📄 Reports filed against others: {filedCount}
                    </div>
                    <br />
                  </>
                )}
                <div>Check your reports here: 🚩</div>
                <div>https://mutable.top/reportable</div>
              </div>
            ) : (
              <div className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-white whitespace-pre-wrap break-words">
                <div>
                  I just checked my public report history with Reportable by
                  #Mutable. I have {resultCount} public report
                  {resultCount === 1 ? "" : "s"} on my permanent record.
                </div>
                <br />
                <div>
                  {getReportScore(uniqueReporterCount).emoji} Report Score:{" "}
                  {getReportScore(uniqueReporterCount).label} ({uniqueReporterCount}{" "}
                  unique reporter{uniqueReporterCount === 1 ? "" : "s"})
                </div>
                <br />
                {includeFiled && filedCount !== undefined && (
                  <>
                    <div>
                      📄 Reports filed against others: {filedCount}
                    </div>
                    <br />
                  </>
                )}
                <div>Check your reports here: 🚩</div>
                <div>https://mutable.top/reportable</div>
              </div>
            )}
            <div className="mt-2">
              {!isMe && (
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  Will mention user with npub when posted
                </p>
              )}
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
    </div>,
    document.body,
  );
}
