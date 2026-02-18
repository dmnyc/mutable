"use client";

import { useState, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store";
import {
  RefreshCw,
  Flame,
  User,
  Volume2,
  VolumeX,
  ExternalLink,
  X,
  Copy,
  Shield,
  Check,
  CheckSquare,
  Square,
  Users,
} from "lucide-react";

// Custom pitchfork icon for hellthread search
function PitchforkIcon({
  size = 16,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="currentColor"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M63.6707 20.7427C63.5443 20.6172 63.3869 20.5276 63.2146 20.4828C63.0423 20.438 62.8611 20.4397 62.6897 20.4877L51.6777 23.6347C51.4685 23.6943 51.2845 23.8204 51.1535 23.994C51.0225 24.1676 50.9516 24.3792 50.9517 24.5967V28.8967L50.4587 29.3967C48.7503 31.1053 46.5362 32.2171 44.1454 32.5668C41.7546 32.9165 39.3149 32.4854 37.1887 31.3377L52.3637 16.1577H56.6697C56.887 16.1578 57.0985 16.0871 57.2721 15.9563C57.4457 15.8255 57.5719 15.6417 57.6317 15.4327L60.7787 4.42169C60.8276 4.25026 60.8298 4.06886 60.785 3.8963C60.7403 3.72373 60.6502 3.56626 60.5242 3.4402C60.3981 3.31415 60.2406 3.22408 60.0681 3.17933C59.8955 3.13458 59.7141 3.13677 59.5427 3.18569L48.5317 6.33069C48.3227 6.39046 48.1389 6.51669 48.0081 6.69028C47.8772 6.86386 47.8065 7.07533 47.8067 7.29269V11.6007L32.6277 26.7757C31.4792 24.6502 31.0473 22.2109 31.3961 19.8203C31.7449 17.4297 32.8558 15.2154 34.5637 13.5067L35.0637 13.0127H39.3637C39.5812 13.0127 39.7927 12.9419 39.9663 12.8109C40.1399 12.6799 40.2661 12.4959 40.3257 12.2867L43.4767 1.27469C43.5257 1.10315 43.5279 0.921632 43.4831 0.748947C43.4383 0.576262 43.3482 0.418703 43.222 0.292607C43.0958 0.166512 42.9381 0.0764716 42.7654 0.0318239C42.5927 -0.0128238 42.4112 -0.0104533 42.2397 0.0386895L31.2287 3.18569C31.0197 3.24523 30.8358 3.37124 30.7048 3.54463C30.5738 3.71803 30.5028 3.92938 30.5027 4.14669V8.45169L30.0097 8.94469C27.1005 11.8708 25.3031 15.7199 24.9271 19.8288C24.5511 23.9378 25.62 28.0492 27.9497 31.4547L1.01966 58.3847C0.42476 58.9581 0.0641256 59.7321 0.00776531 60.5564C-0.048595 61.3808 0.203339 62.1966 0.714664 62.8457C1.00265 63.1892 1.35877 63.4692 1.76052 63.668C2.16226 63.8668 2.60089 63.9801 3.04866 64.0007C3.09466 64.0007 3.14066 64.0007 3.18766 64.0007C4.04284 63.9997 4.86288 63.6603 5.46866 63.0567L32.5097 36.0147C35.9151 38.3446 40.0266 39.4136 44.1356 39.0376C48.2446 38.6615 52.0937 36.864 55.0197 33.9547L55.5127 33.4617H59.8177C60.035 33.4615 60.2463 33.3906 60.4197 33.2596C60.5931 33.1286 60.7191 32.9447 60.7787 32.7357L63.9257 21.7247C63.9746 21.5531 63.9768 21.3716 63.9319 21.1989C63.8871 21.0263 63.7969 20.8687 63.6707 20.7427Z" />
    </svg>
  );
}
import { ClientFilterResult, HellthreadResult, Profile } from "@/types";
import { getDisplayName, getErrorMessage } from "@/lib/utils/format";
import { copyToClipboard } from "@/lib/utils/clipboard";
import UserProfileModal from "./UserProfileModal";
import {
  findFollowsUsingClient,
  findFollowsPostingHellthreads,
  hexToNpub,
  hexToNevent,
} from "@/lib/nostr";
import { protectionService } from "@/lib/protectionService";

type SearchMode = "client" | "hellthread";

export default function Purgatory() {
  const { session } = useAuth();
  const {
    muteList,
    setMuteList,
    addMutedItem,
    removeMutedItem,
    setHasUnsavedChanges,
  } = useStore();

  // Mode selection
  const [searchMode, setSearchMode] = useState<SearchMode>("client");

  // Client search state
  const [clientString, setClientString] = useState("");
  const [clientResults, setClientResults] = useState<ClientFilterResult[]>([]);

  // Hellthread search state
  const [threshold, setThreshold] = useState(25);
  const [hellthreadResults, setHellthreadResults] = useState<
    HellthreadResult[]
  >([]);

  // Shared state
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [copiedNpub, setCopiedNpub] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [selectedPubkeys, setSelectedPubkeys] = useState<Set<string>>(
    new Set(),
  );
  const abortControllerRef = useRef<AbortController | null>(null);

  // Get results based on current mode
  const results = searchMode === "client" ? clientResults : hellthreadResults;

  const handleSearch = async () => {
    if (!session) return;
    if (searching) return;

    // Validate inputs
    if (searchMode === "client" && !clientString.trim()) return;

    abortControllerRef.current = new AbortController();

    try {
      setSearching(true);
      setError(null);
      setSelectedPubkeys(new Set());
      setProgress({ current: 0, total: 0 });

      if (searchMode === "client") {
        setClientResults([]);

        const results = await findFollowsUsingClient(
          session.pubkey,
          clientString.trim(),
          session.relays,
          (current, total) => {
            setProgress({ current, total });
          },
          abortControllerRef.current?.signal,
          (result) => {
            setClientResults((prev) => {
              if (prev.some((r) => r.pubkey === result.pubkey)) return prev;
              return [...prev, result].sort((a, b) => b.lastSeen - a.lastSeen);
            });
          },
        );

        setClientResults(results);
        setProgress(null);

        if (results.length === 0) {
          setError(
            `No users found publishing with client "${clientString}" in your follow list.`,
          );
        }
      } else {
        setHellthreadResults([]);

        const results = await findFollowsPostingHellthreads(
          session.pubkey,
          threshold,
          session.relays,
          (current, total) => {
            setProgress({ current, total });
          },
          abortControllerRef.current?.signal,
          (result) => {
            setHellthreadResults((prev) => {
              if (prev.some((r) => r.pubkey === result.pubkey)) return prev;
              return [...prev, result].sort(
                (a, b) => b.maxTagCount - a.maxTagCount,
              );
            });
          },
        );

        setHellthreadResults(results);
        setProgress(null);

        if (results.length === 0) {
          setError(
            `No users found posting hellthreads (${threshold}+ tagged users) in your follow list.`,
          );
        }
      }
    } catch (err) {
      console.error("Search error:", err);
      if (err instanceof Error && err.name === "AbortError") {
        setProgress(null);
      } else {
        setError(getErrorMessage(err, "Failed to search"));
        setProgress(null);
      }
    } finally {
      setSearching(false);
      abortControllerRef.current = null;
    }
  };

  const handleStopScan = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setProgress(null);
    }
  };

  const handleModeChange = (mode: SearchMode) => {
    if (searching) return;
    setSearchMode(mode);
    setError(null);
    setSelectedPubkeys(new Set());
  };

  const handleMuteToggle = (pubkey: string, reason: string) => {
    const isAlreadyMuted = muteList.pubkeys.some((m) => m.value === pubkey);

    if (isAlreadyMuted) {
      removeMutedItem(pubkey, "pubkeys");
    } else {
      addMutedItem(
        {
          type: "pubkey",
          value: pubkey,
          reason,
        },
        "pubkeys",
      );
    }
  };

  const handleCopyNpub = async (npub: string) => {
    const success = await copyToClipboard(npub);
    if (success) {
      setCopiedNpub(npub);
      setTimeout(() => setCopiedNpub(null), 2000);
    }
  };

  const handleViewProfile = (profile: Profile | undefined, pubkey: string) => {
    setSelectedProfile(profile || { pubkey });
  };

  const toggleSelection = (pubkey: string) => {
    const newSelected = new Set(selectedPubkeys);
    if (newSelected.has(pubkey)) {
      newSelected.delete(pubkey);
    } else {
      newSelected.add(pubkey);
    }
    setSelectedPubkeys(newSelected);
  };

  const selectAll = () => {
    const protectedPubkeys = protectionService.loadProtectedUsers();
    const selectablePubkeys = results
      .filter((r) => !protectedPubkeys.has(r.pubkey))
      .map((r) => r.pubkey);
    setSelectedPubkeys(new Set(selectablePubkeys));
  };

  const selectNone = () => {
    setSelectedPubkeys(new Set());
  };

  const handleMuteSelected = () => {
    if (selectedPubkeys.size === 0) return;

    const alreadyMuted = muteList.pubkeys.map((m) => m.value);
    const toMute = Array.from(selectedPubkeys).filter(
      (pubkey) => !alreadyMuted.includes(pubkey),
    );

    if (toMute.length === 0) {
      alert("All selected users are already muted.");
      return;
    }

    const newPubkeys = toMute.map((pubkey) => {
      let reason: string;
      if (searchMode === "client") {
        reason = `Uses client: ${clientString}`;
      } else {
        const result = hellthreadResults.find((r) => r.pubkey === pubkey);
        reason = result
          ? `Posted hellthread with ${result.maxTagCount} tagged users`
          : `Posted hellthread (${threshold}+ tags)`;
      }

      return {
        type: "pubkey" as const,
        value: pubkey,
        reason,
        private: false,
      };
    });

    setMuteList({
      ...muteList,
      pubkeys: [...muteList.pubkeys, ...newPubkeys],
    });
    setHasUnsavedChanges(true);

    alert(
      `Added ${toMute.length} user${toMute.length === 1 ? "" : "s"} to your mute list.\n\nRemember to publish your changes!`,
    );
  };

  const formatLastSeen = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffDays = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-start gap-3 mb-4">
          <Flame
            className="text-orange-600 dark:text-orange-500 mt-1"
            size={24}
          />
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Purgatory
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Find follows engaging in destructive behavior like mass-tagging
              hellthreads or using spam apps, then bulk mute them
            </p>
          </div>
        </div>

        {/* Mode Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
          <button
            onClick={() => handleModeChange("client")}
            disabled={searching}
            className={`flex items-center gap-2 px-4 py-3 font-medium text-sm border-b-2 transition-colors ${
              searchMode === "client"
                ? "border-orange-600 text-orange-600 dark:border-orange-500 dark:text-orange-500"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            } ${searching ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <Users size={16} />
            Client Search
          </button>
          <button
            onClick={() => handleModeChange("hellthread")}
            disabled={searching}
            className={`flex items-center gap-2 px-4 py-3 font-medium text-sm border-b-2 transition-colors ${
              searchMode === "hellthread"
                ? "border-orange-600 text-orange-600 dark:border-orange-500 dark:text-orange-500"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            } ${searching ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <PitchforkIcon size={16} />
            Hellthread Search
          </button>
        </div>

        {/* Client Search Panel */}
        {searchMode === "client" && (
          <>
            {/* Info Box */}
            <div className="mb-6 p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
              <p className="text-sm text-orange-800 dark:text-orange-200">
                <strong>How it works:</strong> Enter a client identifier (from
                the &quot;client&quot; tag in Nostr events) and Purgatory will
                search through everyone you follow to find users publishing with
                that client.
              </p>
              <p className="text-sm text-orange-700 dark:text-orange-300 mt-2">
                <strong>Note:</strong> This only detects clients that include a
                &quot;client&quot; tag in their events. Not all Nostr apps add
                this tag.
              </p>
            </div>

            {/* Client Input */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Client Identifier
              </label>
              <input
                type="text"
                value={clientString}
                onChange={(e) => setClientString(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="e.g., hellthread.shakespeare.wtf"
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                disabled={searching}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Presets:
                </span>
                <button
                  onClick={() => setClientString("hellthread.shakespeare.wtf")}
                  disabled={searching}
                  className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
                >
                  hellthread.shakespeare.wtf
                </button>
              </div>
            </div>
          </>
        )}

        {/* Hellthread Search Panel */}
        {searchMode === "hellthread" && (
          <>
            {/* Info Box */}
            <div className="mb-6 p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
              <p className="text-sm text-orange-800 dark:text-orange-200">
                <strong>How it works:</strong> Find users who have posted
                top-level notes (not replies) that tag an excessive number of
                users. These &quot;hellthreads&quot; can overwhelm relays and
                clients.
              </p>
              <p className="text-sm text-orange-700 dark:text-orange-300 mt-2">
                <strong>Threshold:</strong> Only top-level posts with this many
                or more unique tagged users will be detected.
              </p>
            </div>

            {/* Threshold Input */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Minimum Tagged Users
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="number"
                  value={threshold}
                  onChange={(e) =>
                    setThreshold(
                      Math.max(
                        10,
                        Math.min(500, parseInt(e.target.value) || 25),
                      ),
                    )
                  }
                  min={10}
                  max={500}
                  className="w-32 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  disabled={searching}
                />
                <div className="flex flex-wrap gap-2">
                  {[25, 50, 100, 250].map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setThreshold(preset)}
                      disabled={searching}
                      className={`text-xs px-3 py-1.5 rounded transition-colors disabled:opacity-50 ${
                        threshold === preset
                          ? "bg-orange-600 text-white"
                          : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                      }`}
                    >
                      {preset}+
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Search Button */}
        <div className="flex gap-2">
          <button
            onClick={handleSearch}
            disabled={
              searching || (searchMode === "client" && !clientString.trim())
            }
            className={`flex-1 flex items-center justify-center space-x-2 px-4 py-3 rounded-lg font-medium transition-colors ${
              searching || (searchMode === "client" && !clientString.trim())
                ? "bg-gray-400 text-gray-600 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"
                : "bg-orange-600 text-white hover:bg-orange-700"
            }`}
          >
            {searching ? (
              <>
                <RefreshCw className="animate-spin" size={18} />
                <span>Searching...</span>
              </>
            ) : (
              <>
                <Flame size={18} />
                <span>Search Follows</span>
              </>
            )}
          </button>

          {searching && (
            <button
              onClick={handleStopScan}
              className="px-4 py-3 bg-gray-600 text-white hover:bg-gray-700 dark:bg-gray-500 dark:hover:bg-gray-600 rounded-lg font-medium transition-colors flex items-center space-x-2"
              title="Stop scan"
            >
              <X size={18} />
              <span>Stop</span>
            </button>
          )}
        </div>

        {/* Progress Display */}
        {searching && progress && (
          <div className="mt-4 p-6 bg-gradient-to-br from-orange-50 to-red-50 dark:from-orange-900/20 dark:to-red-900/20 border-2 border-orange-200 dark:border-orange-700 rounded-lg">
            <div className="flex flex-col space-y-4">
              {/* Progress bar */}
              <div className="w-full bg-orange-200 dark:bg-orange-800 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-orange-600 dark:bg-orange-500 h-3 rounded-full transition-all duration-300 ease-out"
                  style={{
                    width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <RefreshCw
                    className="animate-spin text-orange-600 dark:text-orange-400"
                    size={20}
                  />
                  <div>
                    <div className="text-lg font-bold text-orange-900 dark:text-orange-100">
                      Checking follows... {progress.current} of {progress.total}
                    </div>
                    <div className="text-sm text-orange-700 dark:text-orange-300">
                      Using NIP-65 relay discovery for better coverage
                    </div>
                  </div>
                </div>

                {/* Results counter - prominent */}
                <div className="text-right">
                  <div
                    className={`text-2xl font-bold ${results.length > 0 ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"}`}
                  >
                    {results.length}
                  </div>
                  <div className="text-xs text-orange-700 dark:text-orange-300">
                    {results.length === 1 ? "match" : "matches"} found
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && !searching && (
          <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 rounded text-red-700 dark:text-red-200 text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Results Section - show during and after search */}
      {results.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                {searching && (
                  <RefreshCw
                    className="animate-spin text-orange-500"
                    size={18}
                  />
                )}
                Found {results.length} user{results.length === 1 ? "" : "s"}
                {searchMode === "client"
                  ? ` using: ${clientString}`
                  : ` posting hellthreads (${threshold}+ tags)`}
                {searching && (
                  <span className="text-sm font-normal text-orange-600 dark:text-orange-400">
                    (searching...)
                  </span>
                )}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {searching
                  ? "Results appear in real-time as they're found"
                  : "Select users to add to your mute list"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={selectAll}
                className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              >
                Select All
              </button>
              <button
                onClick={selectNone}
                className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              >
                Select None
              </button>
              <button
                onClick={handleMuteSelected}
                disabled={selectedPubkeys.size === 0}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                  selectedPubkeys.size === 0
                    ? "bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"
                    : "bg-red-600 text-white hover:bg-red-700"
                }`}
              >
                <VolumeX size={18} />
                <span>Mute Selected ({selectedPubkeys.size})</span>
              </button>
            </div>
          </div>

          {/* Results Grid */}
          <div className="space-y-3">
            {searchMode === "client"
              ? clientResults.map((result) => (
                  <ClientResultCard
                    key={result.pubkey}
                    result={result}
                    clientString={clientString}
                    isAlreadyMuted={muteList.pubkeys.some(
                      (m) => m.value === result.pubkey,
                    )}
                    isProtected={protectionService.isProtected(result.pubkey)}
                    isSelected={selectedPubkeys.has(result.pubkey)}
                    copiedNpub={copiedNpub}
                    onToggleSelection={() => toggleSelection(result.pubkey)}
                    onCopyNpub={handleCopyNpub}
                    onViewProfile={() =>
                      handleViewProfile(result.profile, result.pubkey)
                    }
                    onMuteToggle={() =>
                      handleMuteToggle(
                        result.pubkey,
                        `Uses client: ${clientString}`,
                      )
                    }
                    formatLastSeen={formatLastSeen}
                  />
                ))
              : hellthreadResults.map((result) => (
                  <HellthreadResultCard
                    key={result.pubkey}
                    result={result}
                    threshold={threshold}
                    isAlreadyMuted={muteList.pubkeys.some(
                      (m) => m.value === result.pubkey,
                    )}
                    isProtected={protectionService.isProtected(result.pubkey)}
                    isSelected={selectedPubkeys.has(result.pubkey)}
                    copiedNpub={copiedNpub}
                    onToggleSelection={() => toggleSelection(result.pubkey)}
                    onCopyNpub={handleCopyNpub}
                    onViewProfile={() =>
                      handleViewProfile(result.profile, result.pubkey)
                    }
                    onMuteToggle={() =>
                      handleMuteToggle(
                        result.pubkey,
                        `Posted hellthread with ${result.maxTagCount} tagged users`,
                      )
                    }
                    formatLastSeen={formatLastSeen}
                  />
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
    </div>
  );
}

// Client Result Card Component
function ClientResultCard({
  result,
  clientString,
  isAlreadyMuted,
  isProtected,
  isSelected,
  copiedNpub,
  onToggleSelection,
  onCopyNpub,
  onViewProfile,
  onMuteToggle,
  formatLastSeen,
}: {
  result: ClientFilterResult;
  clientString: string;
  isAlreadyMuted: boolean;
  isProtected: boolean;
  isSelected: boolean;
  copiedNpub: string | null;
  onToggleSelection: () => void;
  onCopyNpub: (npub: string) => void;
  onViewProfile: () => void;
  onMuteToggle: () => void;
  formatLastSeen: (ts: number) => string;
}) {
  const npub = hexToNpub(result.pubkey);

  return (
    <div
      className={`border rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
        isProtected
          ? "border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-900/10"
          : isSelected
            ? "border-orange-400 dark:border-orange-600 bg-orange-50 dark:bg-orange-900/10"
            : "border-gray-200 dark:border-gray-700"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Selection Checkbox */}
        <button
          onClick={onToggleSelection}
          disabled={isProtected}
          className={`mt-1 flex-shrink-0 ${
            isProtected ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
          }`}
          title={isProtected ? "Protected user" : "Toggle selection"}
        >
          {isSelected ? (
            <CheckSquare
              className="text-orange-600 dark:text-orange-400"
              size={20}
            />
          ) : (
            <Square className="text-gray-400 dark:text-gray-500" size={20} />
          )}
        </button>

        {/* User Info */}
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {result.profile?.picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={result.profile.picture}
              alt={getDisplayName(result.profile, "User")}
              className="w-12 h-12 rounded-full flex-shrink-0 object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).src =
                  `https://api.dicebear.com/7.x/bottts/svg?seed=${result.pubkey}`;
              }}
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center flex-shrink-0">
              <User className="text-white" size={24} />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <button
                onClick={onViewProfile}
                className="font-semibold text-gray-900 dark:text-white hover:text-orange-600 dark:hover:text-orange-400 transition-colors truncate"
              >
                {getDisplayName(result.profile)}
              </button>
              {isProtected && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 rounded text-xs font-medium"
                  title="Protected from mass operations"
                >
                  <Shield size={12} />
                  Protected
                </span>
              )}
              {isAlreadyMuted && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 rounded text-xs font-medium">
                  <VolumeX size={12} />
                  Muted
                </span>
              )}
            </div>

            {result.profile?.nip05 && (
              <div className="text-sm text-green-600 dark:text-green-400 mb-1 truncate">
                ✓ {result.profile.nip05}
              </div>
            )}

            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              Client: <span className="font-mono">{result.clientTag}</span>
            </div>

            <div className="text-xs text-gray-500 dark:text-gray-500">
              {result.eventCount} event{result.eventCount === 1 ? "" : "s"}{" "}
              found
              {" · "}Last seen: {formatLastSeen(result.lastSeen)}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => onCopyNpub(npub)}
            className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            title="Copy npub"
          >
            {copiedNpub === npub ? (
              <Check className="text-green-600 dark:text-green-400" size={18} />
            ) : (
              <Copy size={18} />
            )}
          </button>

          <a
            href={`https://njump.me/${npub}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            title="View on njump"
          >
            <ExternalLink size={18} />
          </a>

          <button
            onClick={onMuteToggle}
            className={`p-2 rounded transition-colors ${
              isAlreadyMuted
                ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
            title={isAlreadyMuted ? "Unmute" : "Mute"}
          >
            {isAlreadyMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// Hellthread Result Card Component
function HellthreadResultCard({
  result,
  threshold,
  isAlreadyMuted,
  isProtected,
  isSelected,
  copiedNpub,
  onToggleSelection,
  onCopyNpub,
  onViewProfile,
  onMuteToggle,
  formatLastSeen,
}: {
  result: HellthreadResult;
  threshold: number;
  isAlreadyMuted: boolean;
  isProtected: boolean;
  isSelected: boolean;
  copiedNpub: string | null;
  onToggleSelection: () => void;
  onCopyNpub: (npub: string) => void;
  onViewProfile: () => void;
  onMuteToggle: () => void;
  formatLastSeen: (ts: number) => string;
}) {
  const npub = hexToNpub(result.pubkey);
  const nevent = hexToNevent(result.worstEventId);

  return (
    <div
      className={`border rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
        isProtected
          ? "border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-900/10"
          : isSelected
            ? "border-orange-400 dark:border-orange-600 bg-orange-50 dark:bg-orange-900/10"
            : "border-gray-200 dark:border-gray-700"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Selection Checkbox */}
        <button
          onClick={onToggleSelection}
          disabled={isProtected}
          className={`mt-1 flex-shrink-0 ${
            isProtected ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
          }`}
          title={isProtected ? "Protected user" : "Toggle selection"}
        >
          {isSelected ? (
            <CheckSquare
              className="text-orange-600 dark:text-orange-400"
              size={20}
            />
          ) : (
            <Square className="text-gray-400 dark:text-gray-500" size={20} />
          )}
        </button>

        {/* User Info */}
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {result.profile?.picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={result.profile.picture}
              alt={getDisplayName(result.profile, "User")}
              className="w-12 h-12 rounded-full flex-shrink-0 object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).src =
                  `https://api.dicebear.com/7.x/bottts/svg?seed=${result.pubkey}`;
              }}
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center flex-shrink-0">
              <User className="text-white" size={24} />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <button
                onClick={onViewProfile}
                className="font-semibold text-gray-900 dark:text-white hover:text-orange-600 dark:hover:text-orange-400 transition-colors truncate"
              >
                {getDisplayName(result.profile)}
              </button>
              {isProtected && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 rounded text-xs font-medium"
                  title="Protected from mass operations"
                >
                  <Shield size={12} />
                  Protected
                </span>
              )}
              {isAlreadyMuted && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 rounded text-xs font-medium">
                  <VolumeX size={12} />
                  Muted
                </span>
              )}
            </div>

            {result.profile?.nip05 && (
              <div className="text-sm text-green-600 dark:text-green-400 mb-1 truncate">
                ✓ {result.profile.nip05}
              </div>
            )}

            {/* Hellthread-specific info */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded font-medium">
                <Users size={12} />
                {result.maxTagCount} tags (worst)
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                {result.hellthreadCount} hellthread
                {result.hellthreadCount === 1 ? "" : "s"} found
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                Last: {formatLastSeen(result.lastSeen)}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => onCopyNpub(npub)}
            className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            title="Copy npub"
          >
            {copiedNpub === npub ? (
              <Check className="text-green-600 dark:text-green-400" size={18} />
            ) : (
              <Copy size={18} />
            )}
          </button>

          {/* View worst hellthread */}
          <a
            href={`https://njump.me/${nevent}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 hover:bg-orange-100 dark:hover:bg-orange-900/30 rounded transition-colors"
            title="View worst hellthread on njump"
          >
            <ExternalLink size={18} />
          </a>

          <button
            onClick={onMuteToggle}
            className={`p-2 rounded transition-colors ${
              isAlreadyMuted
                ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
            title={isAlreadyMuted ? "Unmute" : "Mute"}
          >
            {isAlreadyMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
