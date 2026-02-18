"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRelaySync } from "@/hooks/useRelaySync";
import {
  RefreshCw,
  Skull,
  AlertCircle,
  Copy,
  ExternalLink,
  UserMinus,
  Share2,
  Shield,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Trash2,
} from "lucide-react";
import { Profile } from "@/types";
import UserProfileModal from "./UserProfileModal";
import DecimatorShareModal from "./DecimatorShareModal";
import {
  getFollowListPubkeys,
  unfollowMultipleUsers,
  fetchProfile,
  hexToNpub,
} from "@/lib/nostr";
import { getDisplayName, getErrorMessage } from "@/lib/utils/format";
import { copyToClipboard } from "@/lib/utils/clipboard";
import { backupService } from "@/lib/backupService";
import { protectionService } from "@/lib/protectionService";

interface DecimatorResult {
  pubkey: string;
  profile?: Profile;
}

export default function Decimator() {
  const { session } = useAuth();
  const {
    addProtection: addProtectionToRelay,
    removeProtection: removeProtectionFromRelay,
  } = useRelaySync();
  const [processing, setProcessing] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<DecimatorResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [copiedNpub, setCopiedNpub] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [inputMode, setInputMode] = useState<"percentage" | "target">(
    "percentage",
  );
  const [percentageValue, setPercentageValue] = useState(10);
  const [targetValue, setTargetValue] = useState<number | null>(null);
  const [totalFollows, setTotalFollows] = useState<number | null>(null);
  const [followsLoaded, setFollowsLoaded] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [decimatedCount, setDecimatedCount] = useState<number>(0);
  const [protectedPubkeys, setProtectedPubkeys] = useState<Set<string>>(
    new Set(),
  );
  const [protectedUsers, setProtectedUsers] = useState<DecimatorResult[]>([]);
  const [showProtectedList, setShowProtectedList] = useState(false);
  const [loadingProtectedProfiles, setLoadingProtectedProfiles] =
    useState(false);
  const [protectedPage, setProtectedPage] = useState(1);
  const [protectedPageSize, setProtectedPageSize] = useState(10);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load protected users on mount
  useEffect(() => {
    const loadProtected = async () => {
      const protectedSet = protectionService.loadProtectedUsers();
      setProtectedPubkeys(protectedSet);

      // Load profiles for protected users
      if (protectedSet.size > 0 && session) {
        setLoadingProtectedProfiles(true);
        const pubkeysArray = Array.from(protectedSet);
        const results: DecimatorResult[] = [];

        for (const pubkey of pubkeysArray) {
          try {
            const profile = await fetchProfile(pubkey, session.relays);
            results.push({ pubkey, profile: profile || undefined });
          } catch (err) {
            results.push({ pubkey });
          }
        }

        setProtectedUsers(results);
        setLoadingProtectedProfiles(false);
      }
    };

    loadProtected();
  }, [session]);

  // Load follow count when switching to target mode
  const loadFollowCount = async () => {
    if (!session || followsLoaded) return;

    try {
      const followList = await getFollowListPubkeys(
        session.pubkey,
        session.relays,
      );
      setTotalFollows(followList.length);
      setTargetValue(followList.length);
      setFollowsLoaded(true);
    } catch (err) {
      console.error("Error loading follow count:", err);
    }
  };

  const handleSelectUsers = async () => {
    if (!session) return;
    if (processing) return;

    abortControllerRef.current = new AbortController();

    try {
      setProcessing(true);
      setError(null);
      setSelectedUsers([]);
      setDecimatedCount(0); // Reset decimated count for new selection
      setProgress("Fetching your follow list...");

      // Get current follow list
      const allFollows = await getFollowListPubkeys(
        session.pubkey,
        session.relays,
      );

      if (allFollows.length === 0) {
        setError("You don&apos;t follow anyone yet!");
        setProgress("");
        setProcessing(false);
        return;
      }

      // Filter out protected users from selection pool
      const followList = allFollows.filter(
        (pubkey) => !protectedPubkeys.has(pubkey),
      );
      const protectedCount = allFollows.length - followList.length;

      if (followList.length === 0) {
        setError(
          "All of your follows are protected! Remove protection from some users to proceed.",
        );
        setProgress("");
        setProcessing(false);
        return;
      }

      if (protectedCount > 0) {
        console.log(
          `${protectedCount} protected user${protectedCount === 1 ? "" : "s"} excluded from selection`,
        );
      }

      // Calculate how many to remove
      let numberToRemove: number;
      if (inputMode === "percentage") {
        numberToRemove = Math.ceil((followList.length * percentageValue) / 100);
      } else {
        // Target mode: calculate how many to remove to reach target
        numberToRemove = Math.max(
          0,
          followList.length - (targetValue || followList.length),
        );
      }

      if (numberToRemove === 0) {
        setError("No users to remove with current settings.");
        setProgress("");
        setProcessing(false);
        return;
      }

      if (numberToRemove >= followList.length) {
        setError(`Cannot remove all follows. Please adjust your settings.`);
        setProgress("");
        setProcessing(false);
        return;
      }

      setProgress(
        `Selecting ${numberToRemove} users randomly (${protectedCount} protected)...`,
      );

      // Shuffle the follow list using Fisher-Yates algorithm
      const shuffled = [...followList];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      // Take the first N users from the shuffled list
      const usersToRemove = shuffled.slice(0, numberToRemove);

      // Convert to DecimatorResult format
      const results: DecimatorResult[] = usersToRemove.map((pubkey) => ({
        pubkey,
      }));

      setSelectedUsers(results);

      // Enrich with profiles (in batches of 5)
      setProgress(`Loading profiles for ${results.length} selected users...`);

      const enrichedResults: DecimatorResult[] = [];
      const batchSize = 5;

      for (let i = 0; i < results.length; i += batchSize) {
        if (abortControllerRef.current?.signal.aborted) {
          break;
        }

        const batch = results.slice(i, i + batchSize);
        const profiles = await Promise.all(
          batch.map(async (result) => {
            try {
              const profile = await fetchProfile(result.pubkey, session.relays);
              return { ...result, profile: profile || undefined };
            } catch (err) {
              return result;
            }
          }),
        );

        enrichedResults.push(...profiles);
        // Filter out any users that were protected during loading
        setSelectedUsers((prev) => {
          const currentProtected = protectionService.loadProtectedUsers();
          return enrichedResults.filter(
            (user) => !currentProtected.has(user.pubkey),
          );
        });

        setProgress(
          `Loading profiles... ${enrichedResults.length}/${results.length}`,
        );

        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      setProgress("");
    } catch (err) {
      console.error("Selection error:", err);
      setError(getErrorMessage(err, "Failed to select users"));
      setProgress("");
    } finally {
      setProcessing(false);
    }
  };

  const handleAbort = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setProgress("Stopping...");
    }
  };

  const handleShare = () => {
    setShowShareModal(true);
  };

  const handleDecimate = async () => {
    if (!session || selectedUsers.length === 0) return;

    const confirmed = confirm(
      `Unfollow ${selectedUsers.length} randomly selected user${selectedUsers.length === 1 ? "" : "s"}?\n\n` +
        `This will:\n` +
        `• Create a backup of your follow list first\n` +
        `• Remove ${selectedUsers.length} user${selectedUsers.length === 1 ? "" : "s"} from your follow list\n` +
        `• Publish the updated list to your relays (one time)\n\n` +
        `This action cannot be undone (except by restoring from backup).`,
    );

    if (!confirmed) return;

    try {
      setProcessing(true);
      setProgress("Creating backup...");

      // Get current follows
      const currentFollows = await getFollowListPubkeys(
        session.pubkey,
        session.relays,
      );

      // Create backup first
      const backup = backupService.createFollowListBackup(
        session.pubkey,
        currentFollows,
        `Auto-backup before decimating ${selectedUsers.length} follows`,
      );
      backupService.saveBackup(backup);

      setProgress(
        `Publishing updated follow list (removing ${selectedUsers.length} user${selectedUsers.length === 1 ? "" : "s"})...`,
      );

      // Unfollow all selected users at once
      const pubkeysToUnfollow = selectedUsers.map((r) => r.pubkey);
      await unfollowMultipleUsers(pubkeysToUnfollow, session.relays);

      setProgress("");

      // Save count for sharing
      setDecimatedCount(selectedUsers.length);

      // Automatically open share modal
      setShowShareModal(true);

      // Don't clear results yet - show share option first
    } catch (err) {
      console.error("Decimate error:", err);
      setError(getErrorMessage(err, "Failed to unfollow users"));
    } finally {
      setProcessing(false);
    }
  };

  const handleCopyNpub = async (pubkey: string) => {
    const npub = hexToNpub(pubkey);
    const success = await copyToClipboard(npub);
    if (success) {
      setCopiedNpub(pubkey);
      setTimeout(() => setCopiedNpub(null), 2000);
    }
  };

  const handleViewProfile = (profile: Profile) => {
    setSelectedProfile(profile);
  };

  const handleToggleProtection = async (pubkey: string) => {
    const isProtected = protectedPubkeys.has(pubkey);

    if (isProtected) {
      // Remove from protected list and sync to relay
      await removeProtectionFromRelay(pubkey);
      setProtectedPubkeys((prev) => {
        const newSet = new Set(prev);
        newSet.delete(pubkey);
        return newSet;
      });
      // Remove from protected users list
      setProtectedUsers((prev) =>
        prev.filter((user) => user.pubkey !== pubkey),
      );
    } else {
      // Add to protected list and sync to relay
      await addProtectionToRelay(pubkey);
      setProtectedPubkeys((prev) => new Set(prev).add(pubkey));

      // Remove from current selection list if protecting
      setSelectedUsers((prev) => prev.filter((user) => user.pubkey !== pubkey));

      // Add to protected users list with profile
      if (session) {
        try {
          const profile = await fetchProfile(pubkey, session.relays);
          setProtectedUsers((prev) => [
            ...prev,
            { pubkey, profile: profile || undefined },
          ]);
        } catch (err) {
          setProtectedUsers((prev) => [...prev, { pubkey }]);
        }
      }
    }
  };

  const handleClearAllProtection = () => {
    const confirmed = confirm(
      `Remove protection from all ${protectedPubkeys.size} user${protectedPubkeys.size === 1 ? "" : "s"}?\n\n` +
        `This will make them eligible for decimation again.`,
    );

    if (!confirmed) return;

    protectionService.clearAllProtection();
    setProtectedPubkeys(new Set());
    setProtectedUsers([]);
    setProtectedPage(1);
  };

  // Pagination calculations for protected users
  const protectedTotalPages = Math.ceil(
    protectedUsers.length / protectedPageSize,
  );
  const protectedStartIndex = (protectedPage - 1) * protectedPageSize;
  const protectedEndIndex = protectedStartIndex + protectedPageSize;
  const protectedCurrentItems = protectedUsers.slice(
    protectedStartIndex,
    protectedEndIndex,
  );

  const handleProtectedPageChange = (page: number) => {
    setProtectedPage(page);
  };

  if (!session) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center">
          <Skull className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            Sign in to use Decimator
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Connect your Nostr account to decimate your follow list.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Skull className="w-8 h-8 text-red-500" />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Decimator
          </h1>
        </div>
        <p className="text-gray-600 dark:text-gray-400">
          Randomly remove a percentage of your follows to cull your list down to
          a manageable size.
        </p>
      </div>

      {/* Info Card */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
        <div className="flex gap-3">
          <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900 dark:text-blue-100">
            <p className="font-semibold mb-1">Safe to use with backups</p>
            <p>
              Your follow list will be automatically backed up before any
              changes are made. You can restore from backups in the Backups tab
              at any time.
            </p>
          </div>
        </div>
      </div>

      {/* Protected Users Section */}
      {protectedPubkeys.size > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setShowProtectedList(!showProtectedList)}
              className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              <Shield className="w-5 h-5 text-green-600 dark:text-green-400" />
              <span>Protected Users ({protectedPubkeys.size})</span>
              {showProtectedList ? (
                <ChevronUp className="w-5 h-5" />
              ) : (
                <ChevronDown className="w-5 h-5" />
              )}
            </button>
            {showProtectedList && (
              <button
                onClick={handleClearAllProtection}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg font-medium flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Clear All
              </button>
            )}
          </div>

          {showProtectedList && (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                These users will be excluded from random decimation selection.
              </p>

              {loadingProtectedProfiles ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-6 h-6 text-gray-400 animate-spin" />
                  <span className="ml-2 text-gray-600 dark:text-gray-400">
                    Loading profiles...
                  </span>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    {protectedCurrentItems.map((user) => (
                      <div
                        key={user.pubkey}
                        className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        <div
                          className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
                          onClick={() =>
                            user.profile && handleViewProfile(user.profile)
                          }
                          title={user.profile ? "View profile" : undefined}
                        >
                          <div className="relative">
                            {user.profile?.picture ? (
                              <img
                                src={user.profile.picture}
                                alt=""
                                className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display =
                                    "none";
                                  const placeholder = (
                                    e.target as HTMLImageElement
                                  ).nextElementSibling as HTMLElement;
                                  if (placeholder)
                                    placeholder.style.display = "flex";
                                }}
                              />
                            ) : null}
                            <div
                              className="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex-shrink-0"
                              style={{
                                display: user.profile?.picture
                                  ? "none"
                                  : "flex",
                              }}
                            />
                            <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-green-600 dark:bg-green-700 flex items-center justify-center">
                              <ShieldCheck className="w-3 h-3 text-white" />
                            </div>
                          </div>
                          <div className="min-w-0 flex-1">
                            {user.profile ? (
                              <>
                                <div className="font-medium text-gray-900 dark:text-white truncate">
                                  {getDisplayName(user.profile)}
                                </div>
                                {user.profile.nip05 && (
                                  <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                                    {user.profile.nip05}
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="text-gray-500 dark:text-gray-400 text-sm truncate font-mono">
                                {user.pubkey.slice(0, 16)}...
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => handleToggleProtection(user.pubkey)}
                            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg font-medium transition-colors"
                            title="Remove protection"
                          >
                            Revoke
                          </button>
                          <button
                            onClick={() => handleCopyNpub(user.pubkey)}
                            className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                            title="Copy npub"
                          >
                            {copiedNpub === user.pubkey ? (
                              <span className="text-green-600 dark:text-green-400 text-xs">
                                ✓
                              </span>
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Pagination */}
                  {protectedUsers.length > 0 && protectedTotalPages > 1 && (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t border-gray-200 dark:border-gray-600">
                      <div className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        Showing {protectedStartIndex + 1}-
                        {Math.min(protectedEndIndex, protectedUsers.length)} of{" "}
                        {protectedUsers.length}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() =>
                            handleProtectedPageChange(protectedPage - 1)
                          }
                          disabled={protectedPage === 1}
                          className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                        >
                          Previous
                        </button>
                        <div className="flex items-center gap-1">
                          {Array.from(
                            { length: protectedTotalPages },
                            (_, i) => i + 1,
                          ).map((page) => {
                            // Show first page, last page, current page, and adjacent pages
                            if (
                              page === 1 ||
                              page === protectedTotalPages ||
                              (page >= protectedPage - 1 &&
                                page <= protectedPage + 1)
                            ) {
                              return (
                                <button
                                  key={page}
                                  onClick={() =>
                                    handleProtectedPageChange(page)
                                  }
                                  className={`px-3 py-1 text-sm rounded ${
                                    protectedPage === page
                                      ? "bg-green-600 text-white"
                                      : "border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                                  }`}
                                >
                                  {page}
                                </button>
                              );
                            } else if (
                              page === protectedPage - 2 ||
                              page === protectedPage + 2
                            ) {
                              return (
                                <span key={page} className="px-1 text-gray-500">
                                  ...
                                </span>
                              );
                            }
                            return null;
                          })}
                        </div>
                        <button
                          onClick={() =>
                            handleProtectedPageChange(protectedPage + 1)
                          }
                          disabled={protectedPage === protectedTotalPages}
                          className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Selection Controls */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Selection Method
        </h2>

        {/* Mode Selector */}
        <div className="flex gap-4 mb-4">
          <button
            onClick={() => setInputMode("percentage")}
            className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
              inputMode === "percentage"
                ? "bg-red-600 text-white"
                : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            By Percentage
          </button>
          <button
            onClick={() => {
              setInputMode("target");
              loadFollowCount();
            }}
            className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
              inputMode === "target"
                ? "bg-red-600 text-white"
                : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            Target Number
          </button>
        </div>

        {/* Percentage Input */}
        {inputMode === "percentage" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Percentage to remove: {percentageValue}%
            </label>
            <input
              type="range"
              min="1"
              max="50"
              value={percentageValue}
              onChange={(e) => setPercentageValue(Number(e.target.value))}
              className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-red-600"
              disabled={processing}
            />
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
              <span>1%</span>
              <span>50%</span>
            </div>
            {totalFollows && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                This will remove approximately{" "}
                {Math.ceil((totalFollows * percentageValue) / 100)} users
              </p>
            )}
          </div>
        )}

        {/* Target Input */}
        {inputMode === "target" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Target number to keep (remaining follows)
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  setTargetValue((prev) => Math.max(1, (prev || 1) - 10))
                }
                disabled={processing || (targetValue || 0) <= 1}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed font-bold"
              >
                −
              </button>
              <input
                type="number"
                min="1"
                max={totalFollows || 10000}
                value={targetValue ?? ""}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (totalFollows && val > totalFollows) {
                    setTargetValue(totalFollows);
                  } else if (val >= 1) {
                    setTargetValue(val);
                  }
                }}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-red-500 focus:border-transparent text-center"
                disabled={processing}
              />
              <button
                onClick={() =>
                  setTargetValue((prev) =>
                    Math.min(totalFollows || 10000, (prev || 0) + 10),
                  )
                }
                disabled={
                  processing ||
                  Boolean(totalFollows && (targetValue || 0) >= totalFollows)
                }
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed font-bold"
              >
                +
              </button>
            </div>
            {totalFollows && targetValue && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                {totalFollows > targetValue ? (
                  <>
                    This will remove {totalFollows - targetValue} users
                    (currently following {totalFollows})
                  </>
                ) : (
                  <>
                    You&apos;re already at or below your target (currently
                    following {totalFollows})
                  </>
                )}
              </p>
            )}
          </div>
        )}

        {/* Action Button */}
        <button
          onClick={handleSelectUsers}
          disabled={processing}
          className="w-full mt-4 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {processing ? (
            <>
              <RefreshCw className="w-5 h-5 animate-spin" />
              {progress || "Processing..."}
            </>
          ) : (
            <>
              <Skull className="w-5 h-5" />
              Select Users to Remove
            </>
          )}
        </button>

        {processing && (
          <button
            onClick={handleAbort}
            className="w-full mt-2 bg-gray-600 hover:bg-gray-700 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
            <div className="text-sm text-red-900 dark:text-red-100">
              <p className="font-semibold mb-1">Error</p>
              <p>{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Success/Share Section */}
      {decimatedCount > 0 && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6 mb-6">
          <div className="flex flex-col items-center text-center gap-4">
            <div>
              <h3 className="text-xl font-bold text-green-900 dark:text-green-100 mb-2">
                Successfully decimated! 💀
              </h3>
              <p className="text-green-800 dark:text-green-200">
                You unfollowed {decimatedCount} user
                {decimatedCount === 1 ? "" : "s"}.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleShare}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold flex items-center gap-2 transition-colors"
              >
                <Share2 className="w-5 h-5" />
                Share on Nostr
              </button>
              <button
                onClick={() => {
                  setDecimatedCount(0);
                  setSelectedUsers([]);
                  setTotalFollows(null);
                  setFollowsLoaded(false);
                }}
                className="px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-semibold transition-colors"
              >
                Start Over
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {selectedUsers.length > 0 && decimatedCount === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Selected Users ({selectedUsers.length})
            </h2>
            <button
              onClick={handleDecimate}
              disabled={processing}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white rounded-lg font-medium flex items-center gap-2 transition-colors"
            >
              <UserMinus className="w-4 h-4" />
              Unfollow All
            </button>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {selectedUsers.map((user) => (
              <div
                key={user.pubkey}
                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <div
                  className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
                  onClick={() =>
                    user.profile && handleViewProfile(user.profile)
                  }
                  title={user.profile ? "View profile" : undefined}
                >
                  <div className="relative w-10 h-10 flex-shrink-0">
                    {user.profile?.picture ? (
                      <img
                        src={user.profile.picture}
                        alt=""
                        className="w-10 h-10 rounded-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                          const placeholder = (e.target as HTMLImageElement)
                            .nextElementSibling as HTMLElement;
                          if (placeholder) placeholder.style.display = "flex";
                        }}
                      />
                    ) : null}
                    <div
                      className="w-10 h-10 rounded-full bg-gradient-to-br from-red-400 to-red-600"
                      style={{
                        display: user.profile?.picture ? "none" : "flex",
                      }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    {user.profile ? (
                      <>
                        <div className="font-medium text-gray-900 dark:text-white truncate">
                          {getDisplayName(user.profile)}
                        </div>
                        {user.profile.nip05 && (
                          <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                            {user.profile.nip05}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-gray-500 dark:text-gray-400 text-sm truncate">
                        {user.pubkey.slice(0, 16)}...
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleToggleProtection(user.pubkey)}
                    className={`p-2 transition-colors ${
                      protectedPubkeys.has(user.pubkey)
                        ? "text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300"
                        : "text-gray-600 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400"
                    }`}
                    title={
                      protectedPubkeys.has(user.pubkey)
                        ? "Remove protection"
                        : "Protect from decimation"
                    }
                  >
                    {protectedPubkeys.has(user.pubkey) ? (
                      <ShieldCheck className="w-4 h-4" />
                    ) : (
                      <Shield className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => handleCopyNpub(user.pubkey)}
                    className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                    title="Copy npub"
                  >
                    {copiedNpub === user.pubkey ? (
                      <span className="text-green-600 dark:text-green-400 text-xs">
                        ✓
                      </span>
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* User Profile Modal */}
      {selectedProfile && (
        <UserProfileModal
          profile={selectedProfile}
          onClose={() => setSelectedProfile(null)}
        />
      )}

      {/* Share Modal */}
      {showShareModal && decimatedCount > 0 && (
        <DecimatorShareModal
          decimatedCount={decimatedCount}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </div>
  );
}
