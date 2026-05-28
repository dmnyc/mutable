"use client";

import { useState } from "react";
import {
  LifeBuoy,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  Users,
  Star,
  History,
  Cloud,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  scanFollowListHistory,
  recoverFollowList,
  FollowListCandidate,
  FollowRecoveryScanResult,
  RecoverFollowListResult,
} from "@/lib/followRecovery";
import { getErrorMessage } from "@/lib/utils/format";
import { backupService } from "@/lib/backupService";

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}

function relativeAge(unixSeconds: number): string {
  const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  const days = Math.floor(ageSeconds / 86400);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"} ago`;
  const hours = Math.floor(ageSeconds / 3600);
  if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const minutes = Math.floor(ageSeconds / 60);
  if (minutes >= 1) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  return "just now";
}

export default function FollowRecoverySection() {
  const { session } = useAuth();
  const [optedIn, setOptedIn] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [result, setResult] = useState<FollowRecoveryScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState<
    (RecoverFollowListResult & { followCount: number }) | null
  >(null);
  const [showAllCandidates, setShowAllCandidates] = useState(false);
  const [showPerRelay, setShowPerRelay] = useState(false);

  const handleScan = async () => {
    if (!session) return;
    setScanning(true);
    setError(null);
    setResult(null);
    setProgress("Connecting to relays…");

    try {
      const scan = await scanFollowListHistory(
        session.pubkey,
        session.relays,
        { onProgress: setProgress },
      );
      setResult(scan);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to scan follow list history"));
    } finally {
      setScanning(false);
      setProgress("");
    }
  };

  const handleRecover = async (candidate: FollowListCandidate) => {
    if (!session) return;

    const confirmMsg =
      `Restore this follow list with ${candidate.followCount} follow${candidate.followCount === 1 ? "" : "s"} ` +
      `from ${formatDate(candidate.createdAt)}?\n\n` +
      `This will REPLACE your current follow list on relays and publish immediately. ` +
      `A local snapshot of your current list will be saved first so you can roll back.`;
    if (!confirm(confirmMsg)) return;

    setRestoring(candidate.eventId);
    setError(null);
    setRestoreSuccess(null);
    setShowPerRelay(false);

    try {
      // Snapshot the current list locally before overwriting, so the user
      // can roll back from the Local Backup History if they change their mind.
      if (result?.current) {
        const backup = backupService.createFollowListBackup(
          session.pubkey,
          result.current.followPubkeys,
          `Auto-snapshot before Follow Recovery (event ${result.current.eventId.slice(0, 8)})`,
        );
        backupService.saveBackup(backup);
      }

      const publishResult = await recoverFollowList(candidate, session.relays);
      setRestoreSuccess({ ...publishResult, followCount: candidate.followCount });
      // Re-scan so the UI reflects the new "current" state.
      await handleScan();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to publish recovered follow list"));
    } finally {
      setRestoring(null);
    }
  };

  const renderCandidate = (candidate: FollowListCandidate) => {
    const isRecommended = candidate.isRecommended;
    const isCurrent = candidate.isCurrent;
    const tombstone = candidate.followCount === 0;
    const recovering = restoring === candidate.eventId;

    return (
      <div
        key={candidate.eventId}
        className={`rounded-lg border p-3 ${
          isRecommended
            ? "border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-900/20"
            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Users
                size={16}
                className={
                  tombstone
                    ? "text-gray-400"
                    : "text-blue-600 dark:text-blue-400"
                }
              />
              <span className="font-semibold text-gray-900 dark:text-white">
                {candidate.followCount} follow
                {candidate.followCount === 1 ? "" : "s"}
              </span>
              {isRecommended && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-green-200 text-green-900 dark:bg-green-800 dark:text-green-100">
                  <Star size={12} /> Recommended
                </span>
              )}
              {isCurrent && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-200 text-blue-900 dark:bg-blue-800 dark:text-blue-100">
                  Current
                </span>
              )}
              {tombstone && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                  Empty
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {formatDate(candidate.createdAt)} ({relativeAge(candidate.createdAt)})
              {" · "}
              <span title={candidate.eventId}>
                event {candidate.eventId.slice(0, 8)}…
              </span>
              {" · "}
              found on {candidate.foundOnRelays.length} relay
              {candidate.foundOnRelays.length === 1 ? "" : "s"}
            </p>
          </div>
          <button
            onClick={() => handleRecover(candidate)}
            disabled={
              recovering || tombstone || isCurrent || !session || !!restoring
            }
            className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              isRecommended
                ? "bg-green-600 text-white hover:bg-green-700"
                : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
            }`}
            title={
              tombstone
                ? "This version has no follows — nothing to restore"
                : isCurrent
                  ? "This is already your current follow list"
                  : "Republish this version as your follow list"
            }
          >
            {recovering ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <LifeBuoy size={14} />
            )}
            Restore
          </button>
        </div>
      </div>
    );
  };

  if (!session) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
            <LifeBuoy
              className="text-blue-600 dark:text-blue-400"
              size={24}
            />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              Follow List Recovery
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Sign in to scan your relays for older versions of your follow
              list and recover one that may have been overwritten.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const recommended = result?.recommended ?? null;
  const candidates = result?.candidates ?? [];
  const olderCandidates = candidates.filter((c) => !c.isCurrent);
  const noRecoverableFound = result !== null && recommended === null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-start gap-4">
        <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
          <LifeBuoy className="text-blue-600 dark:text-blue-400" size={24} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
            Follow List Recovery
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Cross-client kind:3 overwrites are the most common way a follow
            graph gets lost. This tool scans your relays (plus a broad
            archival set) for older versions of your follow list and lets
            you republish a previous one.
          </p>

          {!optedIn ? (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3 mb-4">
              <div className="flex items-start gap-2">
                <AlertTriangle
                  size={18}
                  className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5"
                />
                <div className="text-sm text-blue-800 dark:text-blue-200">
                  <p className="font-semibold mb-1">Before you scan</p>
                  <ul className="space-y-1 ml-4 list-disc">
                    <li>
                      Recovery is best-effort — relays only sometimes retain
                      old versions of replaceable events.
                    </li>
                    <li>
                      Restoring will overwrite your current follow list. A
                      local snapshot of the current list is saved first.
                    </li>
                    <li>
                      Your private key never leaves your signer; only a
                      signed kind:3 event is published.
                    </li>
                  </ul>
                  <button
                    onClick={() => setOptedIn(true)}
                    className="mt-3 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                  >
                    I understand — enable scanning
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  onClick={handleScan}
                  disabled={scanning}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {scanning ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : (
                    <History size={16} />
                  )}
                  <span>
                    {scanning
                      ? "Scanning…"
                      : result
                        ? "Re-scan relays"
                        : "Scan for recoverable versions"}
                  </span>
                </button>
              </div>

              {progress && (
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-3">
                  <RefreshCw size={14} className="animate-spin" />
                  <span>{progress}</span>
                </div>
              )}

              {error && (
                <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded">
                  <div className="flex items-start gap-2">
                    <AlertCircle
                      size={16}
                      className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5"
                    />
                    <p className="text-sm text-red-700 dark:text-red-300">
                      {error}
                    </p>
                  </div>
                </div>
              )}

              {restoreSuccess && (
                <div className="mb-4 p-4 rounded-lg border-2 border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-900/20 shadow-sm">
                  <div className="flex items-start gap-3">
                    <CheckCircle
                      size={28}
                      className="text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-base font-bold text-green-800 dark:text-green-200 mb-1">
                        Follow list restored
                      </h4>
                      <p className="text-sm text-green-700 dark:text-green-300 mb-2">
                        Republished{" "}
                        <span className="font-bold text-green-800 dark:text-green-100">
                          {restoreSuccess.followCount}
                        </span>{" "}
                        follow
                        {restoreSuccess.followCount === 1 ? "" : "s"} · accepted by{" "}
                        <span className="font-semibold">
                          {restoreSuccess.accepted.length}/{restoreSuccess.total}
                        </span>{" "}
                        relays · event{" "}
                        <span className="font-mono text-xs">
                          {restoreSuccess.eventId.slice(0, 12)}…
                        </span>
                      </p>

                      <button
                        onClick={() => setShowPerRelay(!showPerRelay)}
                        className="text-xs text-green-700 dark:text-green-300 hover:text-green-900 dark:hover:text-green-100 underline cursor-pointer flex items-center gap-1"
                      >
                        {showPerRelay ? (
                          <ChevronUp size={12} />
                        ) : (
                          <ChevronDown size={12} />
                        )}
                        Per-relay results
                      </button>
                      {showPerRelay && (
                        <div className="mt-2 space-y-1 text-xs font-mono">
                          {restoreSuccess.accepted.map((r) => (
                            <div key={r} className="text-green-700 dark:text-green-300">
                              ✓ {r}
                            </div>
                          ))}
                          {restoreSuccess.rejected.map((r) => (
                            <div
                              key={r.relay}
                              className="text-red-600 dark:text-red-300 break-all"
                            >
                              ✗ {r.relay} — {r.reason}
                            </div>
                          ))}
                        </div>
                      )}

                      {restoreSuccess.rejected.length > 0 && (
                        <p className="text-xs text-green-700/80 dark:text-green-200/70 mt-3">
                          {restoreSuccess.rejected.length} relay
                          {restoreSuccess.rejected.length === 1 ? "" : "s"} rejected the
                          event. Other clients reading from the accepting relays will see
                          your restored follow list. Propagation may take a moment.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {result && (
                <div className="space-y-3">
                  {/* Current state */}
                  <div className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2 flex-wrap">
                    <Cloud size={14} />
                    <span>
                      Scanned {result.queriedRelays.length} relay
                      {result.queriedRelays.length === 1 ? "" : "s"} ·{" "}
                      {result.respondingRelays.length} returned data ·{" "}
                      {result.candidates.length} distinct version
                      {result.candidates.length === 1 ? "" : "s"} found
                    </span>
                  </div>

                  {/* Recommended */}
                  {recommended && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                        <Star
                          size={14}
                          className="text-green-600 dark:text-green-400"
                        />
                        Recommended recovery
                      </h3>
                      {renderCandidate(recommended)}
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                        Largest non-empty version found
                        {result.current
                          ? `, with ${recommended.followCount - result.current.followCount} more follow${recommended.followCount - result.current.followCount === 1 ? "" : "s"} than your current list (${result.current.followCount})`
                          : ""}
                        .
                      </p>
                    </div>
                  )}

                  {noRecoverableFound && (
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded">
                      <div className="flex items-start gap-2">
                        <CheckCircle
                          size={16}
                          className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5"
                        />
                        <p className="text-sm text-blue-700 dark:text-blue-300">
                          No older version was found that&apos;s larger than
                          your current follow list. Your current list of{" "}
                          {result.current?.followCount ?? 0} follow
                          {result.current?.followCount === 1 ? "" : "s"}{" "}
                          appears to already be the best available.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* All candidates toggle */}
                  {candidates.length > 0 && (
                    <div>
                      <button
                        onClick={() => setShowAllCandidates((v) => !v)}
                        className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                      >
                        {showAllCandidates ? (
                          <ChevronUp size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )}
                        <span>
                          {showAllCandidates ? "Hide" : "Show"} all{" "}
                          {candidates.length} version
                          {candidates.length === 1 ? "" : "s"} found
                        </span>
                      </button>
                      {showAllCandidates && (
                        <div className="mt-2 space-y-2">
                          {/* Show current first, then older ones in time order */}
                          {result.current && renderCandidate(result.current)}
                          {olderCandidates.map(renderCandidate)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
