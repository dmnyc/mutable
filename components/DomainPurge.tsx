"use client";

import { useState, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store";
import {
  RefreshCw,
  Globe,
  User,
  Volume2,
  VolumeX,
  ExternalLink,
  UserMinus,
  AlertCircle,
  X,
  Copy,
  Trash2,
  Shield,
} from "lucide-react";
import { DomainPurgeResult, Profile } from "@/types";
import UserProfileModal from "./UserProfileModal";
import {
  searchFollowsByNip05Domain,
  massMuteAndUnfollowDomain,
  hexToNpub,
  unfollowUser,
  getFollowListPubkeys,
} from "@/lib/nostr";
import { getDisplayName, getErrorMessage } from "@/lib/utils/format";
import { copyToClipboard } from "@/lib/utils/clipboard";
import { backupService } from "@/lib/backupService";
import { protectionService } from "@/lib/protectionService";

export default function DomainPurge() {
  const { session } = useAuth();
  const { muteList, setMuteList, addMutedItem, removeMutedItem } = useStore();
  const [domain, setDomain] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DomainPurgeResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [copiedNpub, setCopiedNpub] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleSearch = async () => {
    if (!session || !domain.trim()) return;

    // If already searching, don't start another search
    if (searching) return;

    // Validate domain format
    const domainPattern = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i;
    if (!domainPattern.test(domain.trim())) {
      setError(
        'Invalid domain format. Please enter a valid domain like "example.com" or "site.co.uk"',
      );
      return;
    }

    // Create new abort controller for this search
    abortControllerRef.current = new AbortController();

    try {
      setSearching(true);
      setError(null);
      setResults([]);
      setProgress("Starting domain search...");

      const domainResults = await searchFollowsByNip05Domain(
        domain,
        session.pubkey,
        session.relays,
        (current, total) => {
          setProgress(`Checking follows... ${current} of ${total}`);
        },
        abortControllerRef.current?.signal,
      );

      setResults(domainResults);
      setProgress("");

      if (domainResults.length === 0) {
        setError(
          `No users found with NIP-05 domain "${domain}" in your follow list.`,
        );
      }
    } catch (err) {
      console.error("Search error:", err);
      if (err instanceof Error && err.name === "AbortError") {
        if (results.length === 0) {
          setError("Search was cancelled");
        }
      } else {
        setError(getErrorMessage(err, "Failed to search for domain"));
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
        { type: "pubkey", value: pubkey, reason: `Domain purge: ${domain}` },
        "pubkeys",
      );
    }
  };

  const handleUnfollow = async (pubkey: string) => {
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
          "Auto-backup before unfollowing via Domain Purge",
        );
        backupService.saveBackup(backup);

        await unfollowUser(pubkey, session.relays);
        // Update the result to reflect they're no longer followed
        setResults(
          results.map((r) =>
            r.pubkey === pubkey ? { ...r, isFollowing: false } : r,
          ),
        );
      } catch (error) {
        console.error("Failed to unfollow user:", error);
      }
    }
  };

  const handleCopyNpub = async (npub: string) => {
    const success = await copyToClipboard(npub);
    if (success) {
      setCopiedNpub(npub);
      setTimeout(() => setCopiedNpub(null), 2000);
    }
  };

  const handleViewProfile = (result: DomainPurgeResult) => {
    setSelectedProfile(result.profile || { pubkey: result.pubkey });
  };

  const handlePurgeAll = async () => {
    if (!session || results.length === 0) return;

    // Filter out protected users
    const protectedPubkeys = protectionService.loadProtectedUsers();
    const unprotectedResults = results.filter(
      (r) => !protectedPubkeys.has(r.pubkey),
    );
    const protectedCount = results.length - unprotectedResults.length;

    if (unprotectedResults.length === 0) {
      alert(
        "⚠️ All users in this search are protected.\n\nYou can manage protected users in the Decimator tab.",
      );
      return;
    }

    const userCount = unprotectedResults.length;
    const userText = userCount === 1 ? "user" : "users";

    let confirmMsg =
      `DOMAIN PURGE: Mass mute and unfollow ${userCount === 1 ? "this" : `all ${userCount}`} ${userText}?\n\n` +
      `Domain: ${domain}\n\n`;

    if (protectedCount > 0) {
      confirmMsg += `⚠️ ${protectedCount} ${protectedCount === 1 ? "user is" : "users are"} protected and will be skipped.\n\n`;
    }

    confirmMsg +=
      `This will:\n` +
      `1. Add ${userCount === 1 ? "this" : `all ${userCount}`} ${userText} to your mute list\n` +
      `2. Remove ${userCount === 1 ? "this" : `all ${userCount}`} ${userText} from your follow list\n` +
      `3. Create automatic backups of your current mute list and follow list\n` +
      `4. Immediately publish changes to relays\n\n` +
      `Are you sure you want to continue?`;

    if (!confirm(confirmMsg)) {
      return;
    }

    try {
      setSearching(true);
      setProgress("Creating backups...");

      // Step 1a: Create backup of current mute list
      const muteBackup = backupService.createMuteListBackup(
        session.pubkey,
        muteList,
        `Auto-backup before domain purge: ${domain}`,
      );
      backupService.saveBackup(muteBackup);

      // Step 1b: Create backup of current follow list
      const currentFollows = await getFollowListPubkeys(
        session.pubkey,
        session.relays,
      );
      const followBackup = backupService.createFollowListBackup(
        session.pubkey,
        currentFollows,
        `Auto-backup before domain purge: ${domain}`,
      );
      backupService.saveBackup(followBackup);

      setProgress(`Muting and unfollowing ${userCount} ${userText}...`);

      // Step 2: Mass mute and unfollow (only unprotected users)
      const pubkeys = unprotectedResults.map((r) => r.pubkey);
      const { muteEvent, followEvent } = await massMuteAndUnfollowDomain(
        pubkeys,
        session.pubkey,
        session.relays,
        muteList,
        `Domain purge: ${domain}`,
      );

      // Step 3: Update local state
      const updatedMuteList = await import("@/lib/nostr").then((m) =>
        m.parseMuteListEvent(muteEvent),
      );
      setMuteList(updatedMuteList);

      // Update results to show they're no longer followed
      setResults(results.map((r) => ({ ...r, isFollowing: false })));

      setProgress("");
      alert(
        `✅ Domain Purge Complete!\n\n` +
          `• Backups created (mute list + follow list with ${currentFollows.length} follows)\n` +
          `• Muted ${userCount} ${userText} with domain "${domain}"\n` +
          `• Unfollowed ${userCount} ${userText}\n` +
          `• Changes published to relays\n\n` +
          `You can restore from the Backups tab if needed.`,
      );
    } catch (error) {
      console.error("Failed to purge domain:", error);
      setError(
        `Error during domain purge: ${getErrorMessage(error, "Unknown error")}`,
      );
      setProgress("");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-start gap-3 mb-4">
          <Globe className="text-red-600 dark:text-red-500 mt-1" size={24} />
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Domain Purge
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Find and remove all users with a specific NIP-05 domain from your
              follow list
            </p>
          </div>
        </div>

        {/* Info Box */}
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            <strong>How it works:</strong> Enter a NIP-05 domain (e.g.,
            &quot;example.com&quot;) and Mutable will search through everyone
            you follow to find users with that domain in their profile. You can
            then mass-mute and unfollow them.
          </p>
        </div>

        {/* Domain Input */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            NIP-05 Domain
          </label>
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="example.com"
            className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-red-500 focus:border-transparent"
            disabled={searching}
          />
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Enter just the domain (e.g., &quot;mostr.pub&quot;,
            &quot;primal.net&quot;, &quot;example.com&quot;)
          </p>
        </div>

        {/* Search Button */}
        <div className="flex gap-2">
          <button
            onClick={handleSearch}
            disabled={searching || !domain.trim()}
            className={`flex-1 flex items-center justify-center space-x-2 px-4 py-3 rounded-lg font-medium transition-colors ${
              searching || !domain.trim()
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
                <Globe size={18} />
                <span>Search Domain</span>
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
        {error && !searching && (
          <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 rounded text-red-700 dark:text-red-200 text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Results Section */}
      {!searching && results.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Found {results.length} user{results.length === 1 ? "" : "s"}{" "}
                with domain: {domain}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Review and manage users with this NIP-05 domain
              </p>
            </div>
            <button
              onClick={handlePurgeAll}
              className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-lg font-medium transition-colors"
            >
              <Trash2 size={18} />
              <span>Purge All ({results.length})</span>
            </button>
          </div>

          {/* Results Grid */}
          <div className="space-y-3">
            {results.map((result) => {
              const npub = hexToNpub(result.pubkey);
              const isAlreadyMuted = muteList.pubkeys.some(
                (m) => m.value === result.pubkey,
              );
              const isProtected = protectionService.isProtected(result.pubkey);

              return (
                <div
                  key={result.pubkey}
                  className={`border rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                    isProtected
                      ? "border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-900/10"
                      : "border-gray-200 dark:border-gray-700"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* User Info */}
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      {result.profile?.picture ? (
                        <img
                          src={result.profile.picture}
                          alt={getDisplayName(result.profile, "User")}
                          className="w-12 h-12 rounded-full flex-shrink-0 object-cover"
                          onError={(e) => {
                            e.currentTarget.src = `https://api.dicebear.com/7.x/bottts/svg?seed=${result.pubkey}`;
                          }}
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                          <User className="text-white" size={24} />
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <button
                            onClick={() => handleViewProfile(result)}
                            className="font-semibold text-gray-900 dark:text-white hover:text-red-600 dark:hover:text-red-400 transition-colors truncate"
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
                          {result.profile?.nip05 && (
                            <span
                              className="text-green-600 dark:text-green-400 text-xs"
                              title="NIP-05 verified"
                            >
                              ✓
                            </span>
                          )}
                        </div>

                        {result.profile?.nip05 && (
                          <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                            {result.profile.nip05}
                          </div>
                        )}

                        <div className="text-xs text-gray-500 dark:text-gray-500 font-mono truncate">
                          {npub.substring(0, 16)}...
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Copy npub */}
                      <button
                        onClick={() => handleCopyNpub(npub)}
                        className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                        title="Copy npub"
                      >
                        {copiedNpub === npub ? (
                          <span className="text-green-600 dark:text-green-400 text-xs font-medium">
                            Copied!
                          </span>
                        ) : (
                          <Copy size={18} />
                        )}
                      </button>

                      {/* External link */}
                      <a
                        href={`https://primal.net/p/${npub}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                        title="View on Primal"
                      >
                        <ExternalLink size={18} />
                      </a>

                      {/* Mute toggle */}
                      <button
                        onClick={() => handleMuteToggle(result.pubkey)}
                        className={`p-2 rounded transition-colors ${
                          isAlreadyMuted
                            ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50"
                            : "text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                        }`}
                        title={
                          isAlreadyMuted
                            ? "Remove from mute list"
                            : "Add to mute list"
                        }
                      >
                        {isAlreadyMuted ? (
                          <VolumeX size={18} />
                        ) : (
                          <Volume2 size={18} />
                        )}
                      </button>

                      {/* Unfollow */}
                      {result.isFollowing && (
                        <button
                          onClick={() => handleUnfollow(result.pubkey)}
                          className="p-2 text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 hover:bg-orange-100 dark:hover:bg-orange-900/30 rounded transition-colors"
                          title="Unfollow"
                        >
                          <UserMinus size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
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
