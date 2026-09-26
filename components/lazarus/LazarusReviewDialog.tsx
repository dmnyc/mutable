"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { Event } from "nostr-tools";
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  X,
  XCircle,
} from "lucide-react";
import {
  getLazarusItemRange,
  parseRelayListEvent,
  probeRelay,
  type LazarusCandidate,
  type LazarusDelta,
  type LazarusItemCount,
  type LazarusKindProfile,
  type LazarusProfileChange,
  type LazarusPublishResult,
  type LazarusRelayLiveness,
  type LazarusWriteRelayAnswer,
} from "@/lib/lazarus";
import {
  describeItem,
  formatCount,
  formatDate,
  formatDateTime,
  itemNoun,
  kindPhrase,
  shortRelay,
} from "./format";

export type LazarusReviewStatus =
  "review" | "working" | "unconfirmed" | "failed" | "published";

export interface LazarusReview {
  key: number;
  profile: LazarusKindProfile;
  candidate: LazarusCandidate;
  originLabel?: string;
  current?: Event;
  currentItemCount?: LazarusItemCount;
  delta: LazarusDelta;
  profileChanges?: LazarusProfileChange[];
  changedSinceReview: boolean;
  blockers: string[];
  unsavedMuteChanges: boolean;
  writeRelaysAreDefaults: boolean;
  status: LazarusReviewStatus;
  step?: string;
  attempts: number;
  error?: string;
  rereadAnswers?: LazarusWriteRelayAnswer[];
  writeResults?: LazarusPublishResult[];
  extraResults?: LazarusPublishResult[];
  extraPending?: boolean;
}

interface LazarusReviewDialogProps {
  review: LazarusReview;
  onClose: () => void;
  onConfirm: (override: boolean) => void;
}

const LIST_PREVIEW = 100;

function ItemList({ tags }: { tags: string[][] }) {
  return (
    <ul className="mt-1 max-h-48 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-2 font-mono text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
      {tags.slice(0, LIST_PREVIEW).map((tag, i) => (
        <li key={`${tag.join("|")}-${i}`} className="truncate">
          {describeItem(tag)}
        </li>
      ))}
      {tags.length > LIST_PREVIEW && (
        <li className="text-gray-500">and {tags.length - LIST_PREVIEW} more</li>
      )}
    </ul>
  );
}

function Notice({
  tone = "amber",
  children,
}: {
  tone?: "amber" | "red" | "blue";
  children: React.ReactNode;
}) {
  const tones = {
    amber:
      "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200",
    red: "border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-900/20 dark:text-red-200",
    blue: "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-200",
  };
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${tones[tone]}`}
    >
      <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function PublishResults({ results }: { results: LazarusPublishResult[] }) {
  const label = {
    accepted: "Accepted",
    rejected: "Rejected",
    failed: "Couldn't connect",
    "timed-out": "Timed out",
  };
  return (
    <ul className="space-y-0.5 text-xs">
      {results.map((result) => (
        <li key={result.url} className="flex justify-between gap-3">
          <span className="min-w-0 truncate text-gray-600 dark:text-gray-400">
            {shortRelay(result.url)}
          </span>
          <span
            className={
              result.status === "accepted"
                ? "flex-shrink-0 text-emerald-700 dark:text-emerald-400"
                : "flex-shrink-0 text-gray-500 dark:text-gray-400"
            }
            title={result.message}
          >
            {label[result.status]}
            {result.message ? `: ${result.message}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function describeKeys(count: number, current: boolean): string {
  const who = current ? "Your current version" : "This version";
  if (count === 0) {
    return `${who} is empty: it announces that you don't use NIP-4e, so clients stop encrypting direct messages to NIP-4e keys.`;
  }
  return `${who} lists ${count} encryption ${count === 1 ? "key" : "keys"}. Clients encrypt direct messages to ${count === 1 ? "it" : "them"}.`;
}

export default function LazarusReviewDialog({
  review,
  onClose,
  onConfirm,
}: LazarusReviewDialogProps) {
  const [shrinkAck, setShrinkAck] = useState(false);
  const [intent, setIntent] = useState<"restore" | "keep" | null>(null);
  const [overrideAck, setOverrideAck] = useState(false);
  const [showAdded, setShowAdded] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  const [liveness, setLiveness] = useState<
    Record<string, LazarusRelayLiveness | "checking">
  >({});

  const { profile, candidate, delta, status } = review;
  const kind = profile.kind;
  const chosen = candidate.event;
  const busy = status === "working";
  const done = status === "published";
  const chosenRange = getLazarusItemRange(candidate.itemCount);
  const needsIntent = profile.meaningfulEmpty;
  const staleRelays = profile.requiredWarnings.includes("stale-relays");
  const chosenRelays =
    kind === 10002
      ? parseRelayListEvent(chosen).write.concat(
          parseRelayListEvent(chosen).read,
        )
      : chosen.tags.filter((t) => t[0] === "relay" && t[1]).map((t) => t[1]);
  const uniqueChosenRelays = Array.from(new Set(chosenRelays));

  const publishLabel =
    kind === 0
      ? `Publish profile from ${formatDate(chosen.created_at)}`
      : `Publish ${kindPhrase(profile.name)} from ${formatDate(chosen.created_at)} (${formatCount(kind, candidate.itemCount)})`;

  const canPublish =
    !busy &&
    !done &&
    review.blockers.length === 0 &&
    (!needsIntent || intent === "restore") &&
    (!delta.shrinks || shrinkAck);

  const checkRelays = async () => {
    const pending = Object.fromEntries(
      uniqueChosenRelays.map((url) => [url, "checking" as const]),
    );
    setLiveness(pending);
    await Promise.all(
      uniqueChosenRelays.map(async (url) => {
        const result = await probeRelay(url);
        setLiveness((prev) => ({ ...prev, [url]: result }));
      }),
    );
  };

  const accepted = review.writeResults?.filter((r) => r.status === "accepted");

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lazarus-review-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg bg-white shadow-xl dark:bg-gray-800">
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-5 dark:border-gray-700">
          <div>
            <h2
              id="lazarus-review-title"
              className="text-lg font-semibold text-gray-900 dark:text-white"
            >
              Review restore: {profile.name}
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Restoring publishes the selected version as your current{" "}
              {kindPhrase(profile.name)}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50 dark:hover:text-gray-300"
            aria-label="Close"
          >
            <X size={22} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-sm">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-900/20">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
                Selected version
              </div>
              <div className="mt-1 font-medium text-gray-900 dark:text-white">
                {formatCount(kind, candidate.itemCount)}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                {formatDateTime(chosen.created_at)}
              </div>
              {review.originLabel && (
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  {review.originLabel}
                </div>
              )}
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
                Current version
              </div>
              {review.current && review.currentItemCount ? (
                <>
                  <div className="mt-1 font-medium text-gray-900 dark:text-white">
                    {formatCount(kind, review.currentItemCount)}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    {formatDateTime(review.current.created_at)}
                  </div>
                </>
              ) : (
                <div className="mt-1 text-gray-600 dark:text-gray-400">
                  None found on relays
                </div>
              )}
            </div>
          </div>

          {review.changedSinceReview && (
            <Notice tone="blue">
              Your {kindPhrase(profile.name)} changed after this review opened
              (another device or client), so the changes below now compare
              against that newer version. Check them again before restoring.
            </Notice>
          )}

          {review.profileChanges ? (
            review.profileChanges.length === 0 ? (
              <p className="text-gray-700 dark:text-gray-300">
                No profile fields would change.
              </p>
            ) : (
              <div>
                <div className="mb-2 font-medium text-gray-900 dark:text-white">
                  {review.profileChanges.length}{" "}
                  {review.profileChanges.length === 1
                    ? "field changes"
                    : "fields change"}
                </div>
                <div className="space-y-2">
                  {review.profileChanges.map((change) => (
                    <div
                      key={change.field}
                      className="rounded border border-gray-200 p-2 text-xs dark:border-gray-700"
                    >
                      <div className="font-semibold text-gray-900 dark:text-white">
                        {change.field}
                      </div>
                      <div className="break-words text-emerald-700 dark:text-emerald-400">
                        {change.to ?? "(removed)"}
                      </div>
                      {change.from !== undefined && (
                        <div className="break-words text-gray-500 line-through dark:text-gray-400">
                          {change.from}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : (
            <div className="space-y-2">
              <div className="font-medium text-gray-900 dark:text-white">
                +{delta.addedCount} {itemNoun(kind, delta.addedCount)} added · −
                {delta.removedCount} {itemNoun(kind, delta.removedCount)}{" "}
                removed
              </div>
              {delta.addedCount > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowAdded((shown) => !shown)}
                    className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                  >
                    {showAdded ? (
                      <ChevronUp size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )}
                    Show added
                  </button>
                  {showAdded && <ItemList tags={delta.added} />}
                </div>
              )}
              {delta.removedCount > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowRemoved((shown) => !shown)}
                    className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                  >
                    {showRemoved ? (
                      <ChevronUp size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )}
                    Show removed
                  </button>
                  {showRemoved && <ItemList tags={delta.removed} />}
                </div>
              )}
            </div>
          )}

          {kind === 10000 && delta.addedCount > 0 && (
            <Notice>
              This re-mutes {delta.addedCount}{" "}
              {itemNoun(kind, delta.addedCount)} that you don&apos;t mute now.
              If you unmuted any of them on purpose, restoring mutes them again:
              a moderation action taken on your behalf.
            </Notice>
          )}
          {kind === 10000 && delta.removedCount > 0 && (
            <Notice>
              This unmutes {delta.removedCount}{" "}
              {itemNoun(kind, delta.removedCount)} you mute now.
            </Notice>
          )}
          {kind === 3 && delta.addedCount > 0 && (
            <p className="text-gray-700 dark:text-gray-300">
              This re-follows {delta.addedCount}{" "}
              {delta.addedCount === 1 ? "account" : "accounts"}.
            </p>
          )}
          {kind === 3 && delta.removedCount > 0 && (
            <Notice>
              This unfollows {delta.removedCount}{" "}
              {delta.removedCount === 1 ? "account" : "accounts"} you follow
              now.
            </Notice>
          )}
          {kind === 10044 && (
            <p className="text-gray-700 dark:text-gray-300">
              Other clients read this list to decide how to encrypt messages to
              you.
            </p>
          )}

          {delta.privateUnknown && (
            <Notice>
              Private items in one of these versions weren&apos;t compared
              because they couldn&apos;t be decrypted, so the changes above
              cover public items only. By size, the selected version has{" "}
              {chosenRange.min === chosenRange.max
                ? chosenRange.min
                : `about ${chosenRange.min}–${chosenRange.max}`}{" "}
              items
              {review.currentItemCount &&
                (() => {
                  const current = getLazarusItemRange(review.currentItemCount);
                  return ` and your current one has ${
                    current.min === current.max
                      ? current.min
                      : `about ${current.min}–${current.max}`
                  }`;
                })()}
              .
            </Notice>
          )}

          {staleRelays && (
            <div className="space-y-2">
              <Notice>
                Old relay lists can point at relays that no longer exist, which
                quietly breaks delivery. Check which relays still answer before
                you restore.
              </Notice>
              {uniqueChosenRelays.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={checkRelays}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    Check {uniqueChosenRelays.length}{" "}
                    {uniqueChosenRelays.length === 1 ? "relay" : "relays"}
                  </button>
                  {Object.keys(liveness).length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs">
                      {uniqueChosenRelays.map((url) => (
                        <li key={url} className="flex justify-between gap-3">
                          <span className="min-w-0 truncate text-gray-600 dark:text-gray-400">
                            {shortRelay(url)}
                          </span>
                          <span
                            className={
                              liveness[url] === "live"
                                ? "text-emerald-700 dark:text-emerald-400"
                                : "text-gray-500 dark:text-gray-400"
                            }
                          >
                            {liveness[url] === "checking"
                              ? "Checking…"
                              : liveness[url] === "live"
                                ? "Reachable"
                                : liveness[url] === "timed-out"
                                  ? "No answer"
                                  : "Unreachable"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {review.unsavedMuteChanges && (
            <Notice>
              You have unsaved mute list edits in Mutable. Restoring replaces
              them.
            </Notice>
          )}

          {review.writeRelaysAreDefaults && (
            <Notice tone="blue">
              No relay list was found for your account, so Mutable&apos;s
              default relays stand in as your write relays.
            </Notice>
          )}

          {needsIntent && (
            <fieldset className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <legend className="px-1 text-sm font-medium text-gray-900 dark:text-white">
                What do you want?
              </legend>
              <p className="text-gray-700 dark:text-gray-300">
                {describeKeys(chosenRange.max, false)}
              </p>
              <p className="text-gray-700 dark:text-gray-300">
                {describeKeys(
                  review.currentItemCount
                    ? getLazarusItemRange(review.currentItemCount).max
                    : 0,
                  true,
                )}
              </p>
              <label className="flex items-center gap-2 text-gray-800 dark:text-gray-200">
                <input
                  type="radio"
                  name="lazarus-intent"
                  checked={intent === "restore"}
                  onChange={() => setIntent("restore")}
                />
                Publish the selected version
              </label>
              <label className="flex items-center gap-2 text-gray-800 dark:text-gray-200">
                <input
                  type="radio"
                  name="lazarus-intent"
                  checked={intent === "keep"}
                  onChange={() => setIntent("keep")}
                />
                Keep my current version
              </label>
            </fieldset>
          )}

          {delta.shrinks && !done && (
            <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
              <input
                type="checkbox"
                className="mt-1"
                checked={shrinkAck}
                onChange={(e) => setShrinkAck(e.target.checked)}
              />
              <span>
                I understand this restore leaves me with fewer{" "}
                {itemNoun(kind, 2)}: it removes {delta.removedCount} and adds{" "}
                {delta.addedCount}.
              </span>
            </label>
          )}

          {review.blockers.length > 0 && (
            <Notice tone="red">
              <ul className="space-y-1">
                {review.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </Notice>
          )}

          {busy && (
            <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <Loader2 size={16} className="animate-spin" />
              {review.step ?? "Working…"}
            </div>
          )}

          {status === "unconfirmed" && (
            <div className="space-y-3">
              <Notice tone="red">
                Couldn&apos;t reach any of your write relays to confirm your
                current version, so nothing was published.
                {review.rereadAnswers && review.rereadAnswers.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs">
                    {review.rereadAnswers.map((answer) => (
                      <li
                        key={answer.url}
                        className="flex justify-between gap-3"
                      >
                        <span className="min-w-0 truncate">
                          {shortRelay(answer.url)}
                        </span>
                        <span>
                          {answer.outcome === "timed-out"
                            ? "Timed out"
                            : "Failed"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Notice>
              {review.attempts >= 2 && (
                <div className="space-y-2 rounded-lg border border-red-300 p-3 dark:border-red-800">
                  <p className="text-gray-700 dark:text-gray-300">
                    If your relay list names relays that no longer exist, you
                    can restore without confirming. Edits made on another device
                    since this review may be lost.
                  </p>
                  <label className="flex items-start gap-2 text-gray-800 dark:text-gray-200">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={overrideAck}
                      onChange={(e) => setOverrideAck(e.target.checked)}
                    />
                    <span>
                      I understand my current version couldn&apos;t be
                      confirmed, and edits made since this review may be lost.
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => onConfirm(true)}
                    disabled={!overrideAck || !canPublish}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Restore anyway
                  </button>
                </div>
              )}
            </div>
          )}

          {status === "failed" && (
            <Notice tone="red">
              {review.error ??
                "No write relay accepted the restore, so nothing changed."}
              {review.writeResults && review.writeResults.length > 0 && (
                <div className="mt-2">
                  <PublishResults results={review.writeResults} />
                </div>
              )}
            </Notice>
          )}

          {done && review.writeResults && (
            <div className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-900/20">
              <div className="flex items-center gap-2 font-medium text-emerald-900 dark:text-emerald-200">
                <CheckCircle2 size={16} />
                Restored. Accepted by {accepted?.length ?? 0} of{" "}
                {review.writeResults.length} write{" "}
                {review.writeResults.length === 1 ? "relay" : "relays"}.
              </div>
              <PublishResults results={review.writeResults} />
              {review.extraPending ? (
                <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                  <Loader2 size={12} className="animate-spin" />
                  Also sending it to other relays that hold older copies…
                </div>
              ) : (
                review.extraResults &&
                review.extraResults.length > 0 && (
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    Also sent to {review.extraResults.length} other{" "}
                    {review.extraResults.length === 1 ? "relay" : "relays"} that
                    held older copies:{" "}
                    {
                      review.extraResults.filter((r) => r.status === "accepted")
                        .length
                    }{" "}
                    accepted.
                  </div>
                )
              )}
            </div>
          )}

          {status === "review" && review.error && (
            <div className="flex items-start gap-2 text-red-700 dark:text-red-400">
              <XCircle size={16} className="mt-0.5 flex-shrink-0" />
              {review.error}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 p-4 dark:border-gray-700">
          {done || (needsIntent && intent === "keep") ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              {done ? "Done" : "Close"}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onConfirm(false)}
                disabled={!canPublish}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <ArchiveRestore size={16} />
                )}
                {status === "unconfirmed"
                  ? "Check again"
                  : status === "failed"
                    ? "Try again"
                    : publishLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
