"use client";

import {
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Trash2,
} from "lucide-react";
import {
  getLazarusItemRange,
  type LazarusCandidate,
  type LazarusKindProfile,
} from "@/lib/lazarus";
import { formatCount, formatDate, formatDateTime, itemNoun } from "./format";

export type PrivateItemsNote = "too-large" | "failed" | "unsupported";

interface LazarusVersionRowProps {
  profile: LazarusKindProfile;
  candidate: LazarusCandidate;
  note?: PrivateItemsNote;
  decrypting: boolean;
  tooLargeToRestore: boolean;
  restorable: boolean;
  preparing: boolean;
  onReview: (candidate: LazarusCandidate) => void;
  onDownload: (candidate: LazarusCandidate) => void;
  onRetryDecrypt?: (candidate: LazarusCandidate) => void;
  sourceLabel?: string;
  onDelete?: () => void;
}

export function LazarusVersionRow({
  profile,
  candidate,
  note,
  decrypting,
  tooLargeToRestore,
  restorable,
  preparing,
  onReview,
  onDownload,
  onRetryDecrypt,
  sourceLabel,
  onDelete,
}: LazarusVersionRowProps) {
  const { itemCount, event } = candidate;
  const range = getLazarusItemRange(itemCount);
  const empty = range.max === 0 && profile.kind !== 0;

  let badge: { text: string; className: string } | undefined;
  if (candidate.isCurrent) {
    badge = {
      text: "Current",
      className:
        "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
    };
  } else if (candidate.isRecommended) {
    badge = {
      text: "Recommended",
      className:
        "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    };
  } else if (empty && profile.meaningfulEmpty) {
    badge = {
      text: "Empty state",
      className:
        "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    };
  } else if (empty) {
    badge = {
      text: "Empty",
      className:
        "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    };
  }

  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            {formatCount(profile.kind, itemCount)}
          </span>
          {!!itemCount.privateCount && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {itemCount.privateCount} private
            </span>
          )}
          {itemCount.privateEstimate && (
            <span
              className="text-xs text-amber-700 dark:text-amber-400"
              title="Estimated from the size of the encrypted private items, which weren't decrypted."
            >
              encrypted, estimated
            </span>
          )}
          {itemCount.partial && !itemCount.privateEstimate && (
            <span
              className="text-xs text-amber-700 dark:text-amber-400"
              title="Private items couldn't be decrypted or sized, so this count may be higher."
            >
              partial count
            </span>
          )}
          {decrypting && (
            <Loader2 size={12} className="animate-spin text-gray-400" />
          )}
          {badge && (
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${badge.className}`}
            >
              {badge.text}
            </span>
          )}
        </div>
        <div className="truncate text-xs text-gray-500 dark:text-gray-400">
          {formatDateTime(event.created_at)}
          {candidate.foundOn.length > 0 &&
            ` · on ${candidate.foundOn.length} ${candidate.foundOn.length === 1 ? "relay" : "relays"}`}
          {sourceLabel && ` · ${sourceLabel}`}
        </div>
        {note === "too-large" && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Too large for a remote signer to decrypt
          </div>
        )}
        {note === "unsupported" && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Your signer can&apos;t decrypt these private items (NIP-44)
          </div>
        )}
        {note === "failed" && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Couldn&apos;t decrypt the private items
            {onRetryDecrypt && (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={() => onRetryDecrypt(candidate)}
                  className="underline hover:text-gray-900 dark:hover:text-white"
                >
                  try again
                </button>
              </>
            )}
          </div>
        )}
        {tooLargeToRestore && note !== "too-large" && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Too large to restore with a remote signer
          </div>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onDownload(candidate)}
          className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
          title="Download this version as JSON"
          aria-label="Download this version as JSON"
        >
          <Download size={16} />
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-gray-400 dark:hover:bg-red-900/20 dark:hover:text-red-400"
            title="Remove from this device"
            aria-label="Remove from this device"
          >
            <Trash2 size={16} />
          </button>
        )}
        {restorable && !candidate.isCurrent && (
          <button
            type="button"
            onClick={() => onReview(candidate)}
            disabled={preparing}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {preparing && <Loader2 size={14} className="animate-spin" />}
            Review
          </button>
        )}
      </div>
    </div>
  );
}

interface LazarusVersionGroupProps {
  kind: number;
  candidates: LazarusCandidate[];
  clobbered: boolean;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export function LazarusVersionGroup({
  kind,
  candidates,
  clobbered,
  expanded,
  onToggle,
  children,
}: LazarusVersionGroupProps) {
  const ranges = candidates.map((c) => getLazarusItemRange(c.itemCount));
  const min = Math.min(...ranges.map((r) => r.min));
  const max = Math.max(...ranges.map((r) => r.max));
  const estimated = candidates.some((c) => !!c.itemCount.privateEstimate);
  const newest = formatDate(candidates[0].event.created_at);
  const oldest = formatDate(candidates[candidates.length - 1].event.created_at);
  let size = `${min}–${max} ${itemNoun(kind, max)}`;
  if (min === max) size = `${min} ${itemNoun(kind, min)}`;
  else if (estimated) size = `≈ ${size}`;

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 py-2 text-left text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
      >
        <span className="min-w-0 truncate">
          {candidates.length} versions · {size} ·{" "}
          {clobbered && (
            <span className="font-semibold text-amber-700 dark:text-amber-400">
              sudden drops ·{" "}
            </span>
          )}
          {oldest === newest ? newest : `${oldest} to ${newest}`}
        </span>
        {expanded ? (
          <ChevronUp size={16} className="flex-shrink-0" />
        ) : (
          <ChevronDown size={16} className="flex-shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="border-l-2 border-gray-200 pl-3 dark:border-gray-700">
          {children}
        </div>
      )}
    </div>
  );
}
