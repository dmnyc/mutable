"use client";

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { DMMessageMeta, Profile } from "@/types";
import { hexToNpub } from "@/lib/nostr";
import { getDisplayName } from "@/lib/utils/format";

/**
 * One DM envelope in a message list (heatmap drill-down, inbox). Shows only
 * public metadata — the content itself stays encrypted: direction, time,
 * counterparty, ciphertext size, client, reply and expiration markers.
 */
export default function DMMessageRow({
  msg,
  profile,
  maxContentLength,
  onSelectPubkey,
}: {
  msg: DMMessageMeta;
  profile?: Profile;
  /** Ciphertext-size bars normalize against this max (0 hides the bar). */
  maxContentLength: number;
  onSelectPubkey?: (pubkey: string) => void;
}) {
  const name = msg.counterparty
    ? profile
      ? getDisplayName(profile)
      : `${hexToNpub(msg.counterparty).slice(0, 14)}…`
    : "unknown";
  const isSent = msg.direction === "sent";
  const widthPct =
    maxContentLength > 0
      ? Math.max(4, (msg.contentLength / maxContentLength) * 100)
      : 0;

  return (
    <div className="flex items-center gap-2 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5">
      <span
        className={
          isSent
            ? "text-purple-600 dark:text-purple-400 flex-shrink-0"
            : "text-pink-600 dark:text-pink-400 flex-shrink-0"
        }
        title={isSent ? "Sent" : "Received"}
      >
        {isSent ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
      </span>

      <span className="font-mono text-gray-500 dark:text-gray-400 flex-shrink-0 tabular-nums">
        {new Date(msg.createdAt * 1000).toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>

      <button
        onClick={() => msg.counterparty && onSelectPubkey?.(msg.counterparty)}
        disabled={!msg.counterparty || !onSelectPubkey}
        className="font-medium text-gray-900 dark:text-white truncate max-w-[10rem] text-left enabled:hover:underline disabled:cursor-default"
        title={msg.counterparty ? hexToNpub(msg.counterparty) : undefined}
      >
        {name}
      </button>

      {/* Ciphertext size — the body stays encrypted, but its length is public
          and approximates message size. */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
        <div className="hidden sm:block w-16 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${isSent ? "bg-purple-500" : "bg-pink-500"}`}
            style={{ width: `${widthPct}%` }}
          />
        </div>
        <span
          className="text-gray-500 dark:text-gray-400 tabular-nums flex-shrink-0"
          title="Encrypted payload size in bytes"
        >
          {msg.contentLength}B
        </span>
      </div>

      {msg.client && (
        <span
          className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 flex-shrink-0 hidden md:inline"
          title="Client tag published with this message"
        >
          {msg.client}
        </span>
      )}
      {msg.replyToEventId && (
        <span
          className="text-gray-400 dark:text-gray-500 flex-shrink-0"
          title="Replies to an earlier event"
        >
          ↩
        </span>
      )}
      {msg.expiresAt && (
        <span
          className="text-amber-600 dark:text-amber-400 flex-shrink-0"
          title="Disappearing message"
        >
          ⏳
        </span>
      )}
    </div>
  );
}
