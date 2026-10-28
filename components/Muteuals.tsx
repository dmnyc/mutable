"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store";
import {
  RefreshCw,
  Users,
  User,
  Volume2,
  VolumeX,
  ExternalLink,
  UserMinus,
  AlertCircle,
  X,
  List,
  Copy,
  CheckCircle2,
  Archive,
} from "lucide-react";
import { MutealResult, Profile } from "@/types";
import UserProfileModal from "./UserProfileModal";
import PageHeader from "@/components/system/PageHeader";
import MuteualsHand from "./MuteualsHand";
import {
  searchMutealsFromFollows,
  searchMutealsNetworkWide,
  enrichMutealsWithProfiles,
  hexToNpub,
  unfollowUser,
  unfollowMultipleUsers,
  getExpandedRelayList,
  fetchMuteList,
  parseMuteListEvent,
  getFollowListPubkeys,
} from "@/lib/nostr";
import { backupService } from "@/lib/backupService";
import { getDisplayName, getErrorMessage } from "@/lib/utils/format";
import { copyToClipboard } from "@/lib/utils/clipboard";

type DiscoveryMethod = "follows" | "network";

type Featurette = "mutedBy" | "mutedFollows";

type ResultsSetter = (
  updater: (prev: MutealResult[]) => MutealResult[],
) => void;

interface ScanStats {
  totalChecked: number;
  withPublicLists: number;
  listsAnalyzed: number;
}

interface MutedFollowsStats {
  totalFollows: number;
}

export default function Muteuals({
  titleAs = "h1",
}: {
  /** h2 when rendered as a dashboard tab; h1 standalone. */
  titleAs?: "h1" | "h2";
}) {
  const { session } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { muteList, addMutedItem, removeMutedItem, setActiveTab } = useStore();
  const [featurette, setFeaturette] = useState<Featurette>("mutedBy");
  const [discoveryMethod, setDiscoveryMethod] =
    useState<DiscoveryMethod>("follows");
  const [searching, setSearching] = useState(false);
  const [muteualResults, setMuteualResults] = useState<MutealResult[]>([]);
  const [mutedFollowResults, setMutedFollowResults] = useState<
    MutealResult[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [scanStats, setScanStats] = useState<ScanStats | null>(null);
  const [mutedFollowsStats, setMutedFollowsStats] =
    useState<MutedFollowsStats | null>(null);
  const [purgeResult, setPurgeResult] = useState<{
    count: number;
    backupCount: number;
  } | null>(null);
  const [copiedNpub, setCopiedNpub] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Deep link from the mute list screen: ?method=muted opens the muted-follows featurette
  useEffect(() => {
    if (searchParams.get("method") === "muted") {
      setFeaturette("mutedFollows");
      const params = new URLSearchParams(searchParams.toString());
      params.delete("method");
      router.replace(
        `/dashboard${params.toString() ? `?${params.toString()}` : ""}`,
        { scroll: false },
      );
    }
  }, [searchParams, router]);

  const handleSearch = async () => {
    if (!session) return;

    // If already searching, don't start another search
    if (searching) return;

    // Create new abort controller for this search
    abortControllerRef.current = new AbortController();

    try {
      setSearching(true);
      setError(null);
      setMuteualResults([]);
      setScanStats(null);
      setProgress("Starting search...");

      let muteuals: MutealResult[] = [];
      const stats: ScanStats = {
        totalChecked: 0,
        withPublicLists: 0,
        listsAnalyzed: 0,
      };

      if (discoveryMethod === "follows") {
        setProgress("Searching through your follows...");

        // Use the proper function which has the stale event fix
        muteuals = await searchMutealsFromFollows(
          session.pubkey,
          session.relays,
          (current, total) => {
            stats.totalChecked = total;
            setProgress(`Checking follow ${current} of ${total}...`);
          },
          abortControllerRef.current?.signal,
        );
      } else {
        setProgress("Searching network-wide...");

        // Use expanded relay list for network-wide search
        const expandedRelays = getExpandedRelayList(session.relays);

        // Stream results as they're found and enrich each one immediately
        muteuals = await searchMutealsNetworkWide(
          session.pubkey,
          expandedRelays,
          (count) => {
            setProgress(`Found ${count} Muteual${count === 1 ? "" : "s"}...`);
          },
          abortControllerRef.current?.signal,
          async (result) => {
            // Add result immediately (shows as "Loading profile...")
            setMuteualResults((prev) => [...prev, result]);

            // Enrich this specific result with profile data
            try {
              const enriched = await enrichMutealsWithProfiles(
                [result],
                session.relays,
              );
              // Update just this result in the list
              setMuteualResults((prev) =>
                prev.map((r) =>
                  r.mutedBy === result.mutedBy ? enriched[0] : r,
                ),
              );
            } catch (err) {
              console.error("Failed to enrich profile:", err);
            }
          },
        );

        // For network-wide, we don't have detailed stats but we can show what we found
        stats.totalChecked = muteuals.length;
        stats.withPublicLists = muteuals.length;
        stats.listsAnalyzed = muteuals.length;
      }

      setMuteualResults(muteuals);
      setScanStats(stats);
      setProgress("");
    } catch (err) {
      console.error("Search error:", err);
      if (err instanceof Error && err.name === "AbortError") {
        // Don't clear error if we have partial results
        if (muteualResults.length === 0) {
          setError("Search was cancelled");
        }
      } else {
        setError(getErrorMessage(err, "Failed to search for Muteuals"));
      }
      setProgress("");
    } finally {
      setSearching(false);
      abortControllerRef.current = null;
    }
  };

  // Scan for accounts you follow that are on your own mute list. Your own
  // list can be decrypted locally, so private mutes are included here.
  const handleScanMutedFollows = async () => {
    if (!session) return;
    if (searching) return;

    abortControllerRef.current = new AbortController();

    try {
      setSearching(true);
      setError(null);
      setMutedFollowResults([]);
      setMutedFollowsStats(null);
      setPurgeResult(null);
      setProgress("Fetching your follow list...");

      const follows = await getFollowListPubkeys(
        session.pubkey,
        session.relays,
      );

      setProgress("Fetching your mute list...");
      const muteEvent = await fetchMuteList(
        session.pubkey,
        session.relays,
      ).catch((err) => {
        console.warn("Failed to fetch mute list from relays:", err);
        return null;
      });
      const list = muteEvent ? await parseMuteListEvent(muteEvent) : muteList;
      const mutedPubkeys = new Set(list.pubkeys.map((p) => p.value));

      const mutedFollows = follows.filter((pubkey) => mutedPubkeys.has(pubkey));
      setMutedFollowsStats({ totalFollows: follows.length });

      if (mutedFollows.length > 0) {
        setProgress(
          `Loading profiles for ${mutedFollows.length} muted follow${mutedFollows.length === 1 ? "" : "s"}...`,
        );
        let results: MutealResult[] = mutedFollows.map((pubkey) => ({
          mutedBy: pubkey,
          isFollowing: true,
          eventId: muteEvent?.id ?? "",
        }));
        results = await enrichMutealsWithProfiles(
          results,
          session.relays,
          undefined,
          abortControllerRef.current?.signal,
        );
        setMutedFollowResults(results);
      }

      setProgress("");
    } catch (err) {
      console.error("Muted follows scan error:", err);
      if (err instanceof Error && err.name === "AbortError") {
        setError("Scan was cancelled");
      } else {
        setError(getErrorMessage(err, "Failed to scan for muted follows"));
      }
      setProgress("");
    } finally {
      setSearching(false);
      abortControllerRef.current = null;
    }
  };

  const handleStopScan = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setProgress("Stopping...");
    }
  };

  const handleMuteToggle = (pubkey: string) => {
    const isAlreadyMuted = muteList.pubkeys.some((m) => m.value === pubkey);

    if (isAlreadyMuted) {
      removeMutedItem(pubkey, "pubkeys");
    } else {
      addMutedItem(
        { type: "pubkey", value: pubkey, reason: "Muted via Muteuals" },
        "pubkeys",
      );
    }
  };

  const handleUnfollow = async (
    pubkey: string,
    setList: ResultsSetter = setMuteualResults,
  ) => {
    if (!session) return;

    if (
      confirm(
        "Are you sure you want to unfollow this user?\n\nNote: A backup of your current follow list will be created automatically before unfollowing.",
      )
    ) {
      try {
        // Create backup before unfollowing
        const currentFollows = await getFollowListPubkeys(
          session.pubkey,
          session.relays,
        );
        const backup = backupService.createFollowListBackup(
          session.pubkey,
          currentFollows,
          "Auto-backup before unfollowing via Muteuals",
        );
        backupService.saveBackup(backup);

        await unfollowUser(pubkey, session.relays);
        // Update the result to reflect they're no longer followed
        setList((prev) =>
          prev.map((r) =>
            r.mutedBy === pubkey ? { ...r, isFollowing: false } : r,
          ),
        );
      } catch (error) {
        console.error("Failed to unfollow user:", error);
      }
    }
  };

  const handleVerifyMute = async (pubkey: string, npub: string) => {
    if (!session) return;

    console.log(`\n========== VERIFYING MUTE FOR ${npub} ==========`);
    console.log("Fetching their current mute list from relays...");

    try {
      const muteListEvent = await fetchMuteList(
        pubkey,
        getExpandedRelayList(session.relays),
      );

      if (!muteListEvent) {
        console.log("❌ No mute list found for this user");
        alert("No mute list found for this user on the relays.");
        return;
      }

      console.log("Mute list event found:", {
        id: muteListEvent.id,
        created_at: new Date(muteListEvent.created_at * 1000).toISOString(),
        tags: muteListEvent.tags,
      });

      const parsedList = await parseMuteListEvent(muteListEvent);
      const mutedPubkeys = parsedList.pubkeys.map((p) => p.value);

      console.log(
        `Found ${mutedPubkeys.length} muted pubkeys in their current list`,
      );
      console.log("Your pubkey:", session.pubkey);
      console.log(
        "Are you on their list?",
        mutedPubkeys.includes(session.pubkey),
      );

      if (mutedPubkeys.includes(session.pubkey)) {
        alert(
          `✅ CONFIRMED: You ARE on their current mute list.\n\nThey have ${mutedPubkeys.length} pubkeys muted.\nEvent ID: ${muteListEvent.id}`,
        );
      } else {
        alert(
          `❌ NOT FOUND: You are NOT on their current mute list.\n\nThis might be a stale event or they removed you.\nTheir current list has ${mutedPubkeys.length} pubkeys.\nEvent ID: ${muteListEvent.id}\n\nCheck console for details.`,
        );
      }
    } catch (error) {
      console.error("Failed to verify:", error);
      alert(
        `Error fetching their mute list: ${getErrorMessage(error, "Unknown error")}`,
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

  const handleViewProfile = (muteal: MutealResult) => {
    setSelectedProfile(muteal.profile || { pubkey: muteal.mutedBy });
  };

  const handleMuteAll = () => {
    if (
      !confirm(
        `Mute all ${muteualResults.length} muteuals?\n\nThis will add them to your mute list. Remember to click "Publish Changes" on the My Mute List tab to save to relays.`,
      )
    ) {
      return;
    }

    let addedCount = 0;
    muteualResults.forEach((muteal) => {
      const isAlreadyMuted = muteList.pubkeys.some(
        (m) => m.value === muteal.mutedBy,
      );
      if (!isAlreadyMuted) {
        addMutedItem(
          {
            type: "pubkey",
            value: muteal.mutedBy,
            reason: "Muted via Muteuals",
          },
          "pubkeys",
        );
        addedCount++;
      }
    });

    alert(
      `Added ${addedCount} muteuals to your mute list.\n\nGo to "My Mute List" and click "Publish Changes" to save to relays.`,
    );
  };

  const handleUnfollowAll = async () => {
    if (!session) return;

    const followingMuteuals = muteualResults.filter((r) => r.isFollowing);
    if (followingMuteuals.length === 0) {
      alert("None of the muteuals are in your follow list.");
      return;
    }

    if (
      !confirm(
        `Unfollow all ${followingMuteuals.length} muteuals that you're currently following?\n\nNote: This will:\n1. Create an automatic backup of your current follow list\n2. Immediately publish your updated follow list to relays`,
      )
    ) {
      return;
    }

    try {
      // Step 1: Create backup of current follow list
      console.log("Creating backup of follow list before unfollowing...");
      const currentFollows = await getFollowListPubkeys(
        session.pubkey,
        session.relays,
      );
      const backup = backupService.createFollowListBackup(
        session.pubkey,
        currentFollows,
        `Auto-backup before unfollowing ${followingMuteuals.length} muteuals`,
      );
      backupService.saveBackup(backup);
      console.log(`Backup created with ${currentFollows.length} follows`);

      // Step 2: Unfollow all muteuals
      for (const muteal of followingMuteuals) {
        await unfollowUser(muteal.mutedBy, session.relays);
      }

      // Update all results to reflect they're no longer followed
      setMuteualResults((prev) =>
        prev.map((r) => (r.isFollowing ? { ...r, isFollowing: false } : r)),
      );

      alert(
        `✅ Success!\n\n• Backup created with ${currentFollows.length} follows\n• Unfollowed ${followingMuteuals.length} muteuals\n• Changes published to relays\n\nYou can restore from the Backups tab if needed.`,
      );
    } catch (error) {
      console.error("Failed to unfollow all:", error);
      alert(
        `Error unfollowing users: ${getErrorMessage(error, "Unknown error")}`,
      );
    }
  };

  // Purge every muted follow in one shot: one backup, one published follow list
  const handlePurgeMutedFollows = async () => {
    if (!session) return;

    const toUnfollow = mutedFollowResults.filter((r) => r.isFollowing);
    if (toUnfollow.length === 0) {
      alert("Nothing left to unfollow.");
      return;
    }

    if (
      !confirm(
        `Unfollow all ${toUnfollow.length} muted follow${toUnfollow.length === 1 ? "" : "s"}?\n\nNote: This will:\n1. Create an automatic backup of your current follow list\n2. Immediately publish your updated follow list to relays (once)\n3. Keep them all muted — your mute list is not touched`,
      )
    ) {
      return;
    }

    try {
      setProgress("Creating backup of follow list...");
      const currentFollows = await getFollowListPubkeys(
        session.pubkey,
        session.relays,
      );
      const backup = backupService.createFollowListBackup(
        session.pubkey,
        currentFollows,
        `Auto-backup before unfollowing ${toUnfollow.length} muted follows`,
      );
      backupService.saveBackup(backup);

      setProgress(
        `Publishing updated follow list (unfollowing ${toUnfollow.length} account${toUnfollow.length === 1 ? "" : "s"})...`,
      );
      await unfollowMultipleUsers(
        toUnfollow.map((r) => r.mutedBy),
        session.relays,
      );
      setProgress("");

      // Update all results to reflect they're no longer followed
      setMutedFollowResults((prev) =>
        prev.map((r) => (r.isFollowing ? { ...r, isFollowing: false } : r)),
      );

      setPurgeResult({
        count: toUnfollow.length,
        backupCount: currentFollows.length,
      });
    } catch (error) {
      console.error("Failed to purge muted follows:", error);
      setProgress("");
      alert(
        `Error unfollowing users: ${getErrorMessage(error, "Unknown error")}`,
      );
    }
  };

  const renderResultRow = (muteal: MutealResult, setList: ResultsSetter) => {
    const isAlreadyMuted = muteList.pubkeys.some(
      (m) => m.value === muteal.mutedBy,
    );
    const profile = muteal.profile;
    const displayName = getDisplayName(profile);
    const npub = hexToNpub(muteal.mutedBy);

    // Format mute date for display
    const formatMuteDate = (timestamp?: number): string => {
      if (!timestamp) return "";

      const muteDate = new Date(timestamp * 1000);
      const now = new Date();
      const diffTime = Math.abs(now.getTime() - muteDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return "today";
      if (diffDays === 1) return "yesterday";
      if (diffDays < 7) {
        return diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;
      }
      if (diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
      }
      if (diffDays < 365) {
        const months = Math.floor(diffDays / 30);
        return months === 1 ? "1 month ago" : `${months} months ago`;
      }
      const years = Math.floor(diffDays / 365);
      return years === 1 ? "1 year ago" : `${years} years ago`;
    };

    return (
      <div
        key={muteal.mutedBy}
        className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <div
          className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden cursor-pointer"
          onClick={() => handleViewProfile(muteal)}
          title="View profile and mute list"
        >
          {profile?.picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.picture}
              alt={displayName}
              className="w-10 h-10 rounded-full object-cover flex-shrink-0"
              onError={(e) => {
                (e.target as HTMLImageElement).src =
                  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/%3E%3Cpath d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/%3E%3C/svg%3E';
              }}
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
              <User size={20} className="text-gray-600 dark:text-gray-300" />
            </div>
          )}

          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-gray-900 dark:text-white truncate">
                {displayName}
              </span>
              {muteal.isFollowing && (
                <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-2 py-0.5 rounded whitespace-nowrap flex-shrink-0">
                  Following
                </span>
              )}
            </div>
            {profile?.nip05 && (
              <div className="text-xs text-green-600 dark:text-green-400 truncate">
                ✓ {profile.nip05}
              </div>
            )}
            {muteal.mutedAt && (
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Updated {formatMuteDate(muteal.mutedAt)}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Verify Button - Hidden for production */}
          {/* <button
                      onClick={() => handleVerifyMute(muteal.mutedBy, npub)}
                      className="p-2 text-yellow-600 dark:text-yellow-400 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                      title="Verify if you're on their current mute list"
                    >
                      <AlertCircle size={16} />
                    </button> */}

          {/* Copy npub Button */}
          <button
            onClick={() => handleCopyNpub(npub)}
            className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors ${
              copiedNpub === npub
                ? "text-green-600 dark:text-green-400"
                : "text-gray-600 dark:text-gray-400"
            }`}
            title={copiedNpub === npub ? "Copied!" : "Copy npub"}
          >
            <Copy size={16} />
          </button>

          {/* Mute/Unmute Toggle */}
          <button
            onClick={() => handleMuteToggle(muteal.mutedBy)}
            className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors ${
              isAlreadyMuted
                ? "text-red-600 dark:text-red-500"
                : "text-gray-600 dark:text-gray-400"
            }`}
            title={
              isAlreadyMuted ? "Unmute this user" : "Mute this user back"
            }
          >
            {isAlreadyMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>

          {/* Unfollow Button */}
          {muteal.isFollowing && (
            <button
              onClick={() => handleUnfollow(muteal.mutedBy, setList)}
              className="p-2 text-orange-600 dark:text-orange-500 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
              title="Unfollow this user"
            >
              <UserMinus size={16} />
            </button>
          )}

          {/* View on listr.lol */}
          <a
            href={`https://listr.lol/${npub}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-purple-600 dark:text-purple-400 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
            title="View their lists on listr.lol"
          >
            <List size={16} />
          </a>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        as={titleAs}
        icon={<MuteualsHand size={28} />}
        iconBg="from-red-500 to-red-700"
        title="Muteuals"
        subtitle="Mute relationships in both directions: who muted you, and who you muted but still follow."
      />

      {/* Featurette Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700 overflow-x-auto scroll-mt-4">
        <nav className="flex space-x-6 sm:space-x-8 whitespace-nowrap">
          <button
            onClick={() => setFeaturette("mutedBy")}
            className={`py-3 px-1 border-b-2 font-semibold text-sm transition-colors ${
              featurette === "mutedBy"
                ? "border-red-600 text-red-600 dark:border-red-500 dark:text-red-500"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
            }`}
          >
            Who Muted You
          </button>
          <button
            onClick={() => setFeaturette("mutedFollows")}
            className={`py-3 px-1 border-b-2 font-semibold text-sm transition-colors ${
              featurette === "mutedFollows"
                ? "border-red-600 text-red-600 dark:border-red-500 dark:text-red-500"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
            }`}
          >
            Muted Follows
          </button>
        </nav>
      </div>

      {/* Featurette 1: Who Muted You */}
      {featurette === "mutedBy" && (
        <>
          {/* Search Panel */}
          <div className="panel relative rounded-xl border border-line shadow-panel p-6">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Discover users who have publicly muted you in their mute lists.
            </p>

            {/* Info Box */}
            <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>Note:</strong> Only public mute lists can be searched —
                private mutes are encrypted.
              </p>
            </div>

            {/* Discovery Method Selector */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Discovery Method
              </label>
              <div className="space-y-3">
                <label
                  className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                    discoveryMethod === "follows"
                      ? "border-red-600 bg-red-50 dark:bg-red-900/20"
                      : "border-gray-200 dark:border-gray-700"
                  }`}
                >
                  <input
                    type="radio"
                    name="discoveryMethod"
                    value="follows"
                    checked={discoveryMethod === "follows"}
                    onChange={(e) =>
                      setDiscoveryMethod(e.target.value as DiscoveryMethod)
                    }
                    className="mt-1 text-red-600 focus:ring-red-500"
                  />
                  <div className="ml-3 flex-1">
                    <div className="font-medium text-gray-900 dark:text-white">
                      Search Within My Follows
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      Check if any users you follow have publicly muted you.
                      More relevant but limited scope.
                    </div>
                  </div>
                </label>

                <label
                  className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                    discoveryMethod === "network"
                      ? "border-red-600 bg-red-50 dark:bg-red-900/20"
                      : "border-gray-200 dark:border-gray-700"
                  }`}
                >
                  <input
                    type="radio"
                    name="discoveryMethod"
                    value="network"
                    checked={discoveryMethod === "network"}
                    onChange={(e) =>
                      setDiscoveryMethod(e.target.value as DiscoveryMethod)
                    }
                    className="mt-1 text-red-600 focus:ring-red-500"
                  />
                  <div className="ml-3 flex-1">
                    <div className="font-medium text-gray-900 dark:text-white">
                      Network-Wide Search
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      Search all public mute lists across{" "}
                      {session
                        ? getExpandedRelayList(session.relays).length
                        : "14+"}{" "}
                      relays. Most comprehensive coverage.
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Search Button */}
            <div className="flex gap-2">
              <button
                onClick={handleSearch}
                disabled={searching}
                className={`flex-1 flex items-center justify-center space-x-2 px-4 py-3 rounded-lg font-medium transition-colors ${
                  searching
                    ? "bg-gray-400 text-gray-600 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"
                    : "bg-red-600 text-white hover:bg-red-700"
                }`}
              >
                {searching ? (
                  <>
                    <span>Searching...</span>
                  </>
                ) : (
                  <>
                    <Users size={18} />
                    <span>Search for Muteuals</span>
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

            {/* Progress Display - Large and Visible */}
            {searching && progress && (
              <div className="mt-4 p-6 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-2 border-blue-200 dark:border-blue-700 rounded-lg">
                <div className="flex items-center justify-center space-x-4">
                  <RefreshCw
                    className="animate-spin text-blue-600 dark:text-blue-400"
                    size={24}
                  />
                  <div>
                    <div className="text-xl font-bold text-blue-900 dark:text-blue-100">
                      {progress}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 rounded text-red-700 dark:text-red-200 text-sm">
                {error}
              </div>
            )}
          </div>

          {/* Results Section */}
          {!searching && muteualResults.length === 0 && scanStats ? (
            <div className="panel relative rounded-xl border border-line shadow-panel p-8">
              <div className="text-center mb-6">
                <Users className="mx-auto mb-3 text-green-500" size={48} />
                <p className="font-display font-semibold text-base tracking-tight text-hi mb-2">
                  No Muteuals Found
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Good news! None of the users you checked have publicly muted
                  you.
                </p>
              </div>

              {/* Scan Statistics */}
              {discoveryMethod === "follows" && (
                <>
                  <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                      Scan Statistics
                    </h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">
                          Total follows checked:
                        </span>
                        <span className="font-medium text-gray-900 dark:text-white">
                          {scanStats.totalChecked}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">
                          Users with public mute lists:
                        </span>
                        <span className="font-medium text-gray-900 dark:text-white">
                          {scanStats.withPublicLists}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">
                          Public lists analyzed:
                        </span>
                        <span className="font-medium text-gray-900 dark:text-white">
                          {scanStats.listsAnalyzed}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Explanation */}
                  <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <p className="text-xs text-blue-800 dark:text-blue-200">
                      <strong>What this means:</strong> Out of{" "}
                      {scanStats.totalChecked} follows, only{" "}
                      {scanStats.withPublicLists} (
                      {scanStats.totalChecked > 0
                        ? Math.round(
                            (scanStats.withPublicLists / scanStats.totalChecked) *
                              100,
                          )
                        : 0}
                      %) have public mute lists.
                      {scanStats.withPublicLists === 0 &&
                        " Most users keep their mute lists private (encrypted), which cannot be scanned."}
                      {scanStats.withPublicLists > 0 &&
                        scanStats.listsAnalyzed > 0 &&
                        " We checked all their public lists and you're not on any of them!"}
                    </p>
                  </div>
                </>
              )}

              {/* Network-wide explanation */}
              {discoveryMethod === "network" && (
                <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <p className="text-xs text-blue-800 dark:text-blue-200">
                    <strong>What this means:</strong> We queried{" "}
                    {session
                      ? getExpandedRelayList(session.relays).length
                      : "14+"}{" "}
                    relays (including major public relays like Damus, Primal,
                    and Nostr Band) for mute lists (kind 10000) with your pubkey
                    in the public tags. No matches found - no one has publicly
                    muted you on these relays! Note: People may have you in
                    their encrypted/private mutes which we cannot see.
                  </p>
                </div>
              )}
            </div>
          ) : muteualResults.length > 0 ? (
            <div className="panel relative rounded-xl border border-line shadow-panel p-6">
              {/* Info Banner */}
              <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <p className="text-xs text-blue-800 dark:text-blue-200">
                  <strong>Quick Actions:</strong> &ldquo;Mute All&rdquo; adds to
                  your local mute list (publish later). &ldquo;Unfollow
                  All&rdquo; publishes immediately to relays.
                </p>
              </div>

              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-semibold text-base tracking-tight text-hi">
                  Found {muteualResults.length}{" "}
                  {muteualResults.length === 1 ? "Muteual" : "Muteuals"}
                </h3>

                <div className="flex gap-2">
                  <button
                    onClick={handleUnfollowAll}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium"
                    title="Unfollow all muteuals you're currently following"
                  >
                    <UserMinus size={16} />
                    <span>Unfollow All</span>
                  </button>

                  <button
                    onClick={handleMuteAll}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
                    title="Mute all muteuals"
                  >
                    <VolumeX size={16} />
                    <span>Mute All</span>
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {muteualResults.map((muteal) =>
                  renderResultRow(muteal, setMuteualResults),
                )}
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* Featurette 2: Muted Follows */}
      {featurette === "mutedFollows" && (
        <>
          {/* Scan Panel */}
          <div className="panel relative rounded-xl border border-line shadow-panel p-6">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              See who you are muting (publicly or privately) and still follow —
              purge them all at once, or unfollow individually.
            </p>

            {/* Info Box */}
            <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>Note:</strong> Your own mute list is decrypted locally,
                so private (encrypted) mutes are included. Unfollowing never
                touches your mute list — everyone here stays muted.
              </p>
            </div>

            {/* Scan Button */}
            <div className="flex gap-2">
              <button
                onClick={handleScanMutedFollows}
                disabled={searching}
                className={`flex-1 flex items-center justify-center space-x-2 px-4 py-3 rounded-lg font-medium transition-colors ${
                  searching
                    ? "bg-gray-400 text-gray-600 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"
                    : "bg-red-600 text-white hover:bg-red-700"
                }`}
              >
                {searching ? (
                  <>
                    <span>Scanning...</span>
                  </>
                ) : (
                  <>
                    <VolumeX size={18} />
                    <span>Find Muted Follows</span>
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
              <div className="mt-4 p-6 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-2 border-blue-200 dark:border-blue-700 rounded-lg">
                <div className="flex items-center justify-center space-x-4">
                  <RefreshCw
                    className="animate-spin text-blue-600 dark:text-blue-400"
                    size={24}
                  />
                  <div>
                    <div className="text-xl font-bold text-blue-900 dark:text-blue-100">
                      {progress}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 rounded text-red-700 dark:text-red-200 text-sm">
                {error}
              </div>
            )}
          </div>

          {/* Results Section */}
          {purgeResult ? (
            <div className="panel relative rounded-xl border border-green-200 dark:border-green-800 shadow-panel p-8">
              <div className="flex flex-col items-center text-center gap-4">
                <CheckCircle2 className="text-green-500" size={48} />
                <div>
                  <h3 className="font-display font-semibold text-base tracking-tight text-hi mb-2">
                    Purged {purgeResult.count} muted follow
                    {purgeResult.count === 1 ? "" : "s"}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Unfollowed and published once to your relays — they all
                    stay muted. A backup of your {purgeResult.backupCount}{" "}
                    follow{purgeResult.backupCount === 1 ? "" : "s"} was saved
                    first.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => setActiveTab("backups")}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-600 text-white hover:bg-gray-700 rounded-lg font-medium text-sm transition-colors"
                  >
                    <Archive size={16} />
                    <span>Open Backups</span>
                  </button>
                  <button
                    onClick={handleScanMutedFollows}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-lg font-medium text-sm transition-colors"
                  >
                    <RefreshCw size={16} />
                    <span>Scan Again</span>
                  </button>
                </div>
              </div>
            </div>
          ) : !searching &&
          mutedFollowResults.length === 0 &&
          mutedFollowsStats ? (
            <div className="panel relative rounded-xl border border-line shadow-panel p-8">
              <div className="text-center mb-6">
                <VolumeX className="mx-auto mb-3 text-green-500" size={48} />
                <p className="font-display font-semibold text-base tracking-tight text-hi mb-2">
                  No Muted Follows
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Good news! None of your {mutedFollowsStats.totalFollows}{" "}
                  follow{mutedFollowsStats.totalFollows === 1 ? "" : "s"} are
                  on your mute list — public or private.
                </p>
              </div>
            </div>
          ) : mutedFollowResults.length > 0 ? (
            <div className="panel relative rounded-xl border border-line shadow-panel p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <h3 className="font-display font-semibold text-base tracking-tight text-hi">
                  Found {mutedFollowResults.length} muted follow
                  {mutedFollowResults.length === 1 ? "" : "s"}
                </h3>

                <button
                  onClick={handlePurgeMutedFollows}
                  disabled={searching}
                  className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:bg-gray-400 transition-colors text-sm font-medium"
                  title="Unfollow everyone listed — they stay muted"
                >
                  <UserMinus size={16} />
                  <span>Unfollow All, Keep Muted</span>
                </button>
              </div>

              <div className="space-y-3">
                {mutedFollowResults.map((muteal) =>
                  renderResultRow(muteal, setMutedFollowResults),
                )}
              </div>
            </div>
          ) : null}
        </>
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
