"use client";

import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store";
import {
  Search,
  RefreshCw,
  User,
  ExternalLink,
  Copy,
  Check,
  Eye,
  EyeOff,
  Share2,
  Link,
  MessageCircle,
  AlertTriangle,
} from "lucide-react";
import { DMAnalysis, DMContact, Profile } from "@/types";
import UserProfileModal from "./UserProfileModal";
import DMLeaderboard from "./DMLeaderboard";
import DMHeatmap from "./DMHeatmap";
import DMCircle from "./DMCircle";
import {
  analyzeDMMetadata,
  hexToNpub,
  npubToHex,
  searchProfiles,
  fetchProfile,
  publishTextNote,
} from "@/lib/nostr";

export default function Snoopable() {
  const { session } = useAuth();
  const searchParams = useSearchParams();

  // Search state
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Analysis state
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<DMAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progressPhase, setProgressPhase] = useState<string>("");
  const [progressCount, setProgressCount] = useState<number>(0);
  const [progressTotal, setProgressTotal] = useState<number | undefined>();

  // UI state
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedNote, setCopiedNote] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [activeTab, setActiveTab] = useState<
    "circle" | "leaderboard" | "heatmap"
  >("circle");
  const [showShareModal, setShowShareModal] = useState(false);
  const [includeNames, setIncludeNames] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Check for npub in URL params on mount
  useEffect(() => {
    const npubParam = searchParams.get("npub");
    if (npubParam && !analysis && !analyzing) {
      setSearchInput(npubParam);
      // Auto-trigger analysis
      handleAnalyze(npubParam);
    }
  }, [searchParams]);

  // Profile search with debounce
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (
      !searchInput.trim() ||
      searchInput.startsWith("npub") ||
      searchInput.match(/^[0-9a-f]{64}$/i)
    ) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchProfiles(searchInput, session?.relays, 10);
        setSearchResults(results);
        setShowDropdown(results.length > 0);
      } catch (err) {
        console.error("Profile search error:", err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchInput, session?.relays]);

  const handleAnalyze = async (input?: string) => {
    const targetInput = input || searchInput;
    if (!targetInput.trim()) return;
    if (analyzing) return;

    // Parse input to get pubkey
    let targetPubkey: string;
    try {
      if (
        targetInput.startsWith("npub") ||
        targetInput.startsWith("nprofile")
      ) {
        targetPubkey = npubToHex(targetInput);
      } else if (targetInput.match(/^[0-9a-f]{64}$/i)) {
        targetPubkey = targetInput.toLowerCase();
      } else {
        // Try to find profile by name
        const profiles = await searchProfiles(targetInput, session?.relays, 1);
        if (profiles.length === 0) {
          setError("Could not find a user matching that search.");
          return;
        }
        targetPubkey = profiles[0].pubkey;
      }
    } catch (err) {
      setError("Invalid npub or user identifier.");
      return;
    }

    abortControllerRef.current = new AbortController();

    try {
      setAnalyzing(true);
      setError(null);
      setAnalysis(null);
      setShowDropdown(false);

      const result = await analyzeDMMetadata(
        targetPubkey,
        session?.relays,
        (phase, current, total) => {
          setProgressPhase(phase);
          setProgressCount(current);
          setProgressTotal(total);
        },
        abortControllerRef.current.signal,
      );

      setAnalysis(result);
    } catch (err) {
      if (err instanceof Error && err.message === "Aborted") {
        // User cancelled
      } else {
        console.error("Analysis error:", err);
        setError(
          err instanceof Error ? err.message : "Failed to analyze DM metadata",
        );
      }
    } finally {
      setAnalyzing(false);
      setProgressPhase("");
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleSelectProfile = (profile: Profile) => {
    setSearchInput(hexToNpub(profile.pubkey));
    setShowDropdown(false);
    setSearchResults([]);
  };

  const handleCopyLink = async () => {
    if (!analysis) return;
    const npub = hexToNpub(analysis.targetPubkey);
    const url = `${window.location.origin}/snoopable?npub=${npub}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  };

  const generateNoteText = () => {
    if (!analysis) return "";

    const npub = hexToNpub(analysis.targetPubkey);
    let content = `🔍 Sn👀pable Report for nostr:${npub}\n\n`;
    content += `📊 DM Activity:\n`;
    content += `• ${analysis.totalSent} sent / ${analysis.totalReceived} received\n`;
    content += `• ${analysis.contacts.length} unique contacts\n`;

    if (analysis.oldestDM) {
      const oldestDate = new Date(analysis.oldestDM * 1000);
      content += `• Active since ${oldestDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}\n`;
    }

    content += `\n🏆 Top Contacts:\n`;
    const topContacts = analysis.contacts.slice(0, 3);
    topContacts.forEach((contact, i) => {
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
      content += `${medal} ${contact.title} (${contact.totalCount} exchanges)\n`;
    });

    content += `\nYour DMs aren't as private as you think!\nhttps://mutable.top/snoopable`;

    return content;
  };

  const handleCopyNote = async () => {
    if (!analysis) return;
    try {
      const noteText = generateNoteText();
      await navigator.clipboard.writeText(noteText);
      setCopiedNote(true);
      setTimeout(() => setCopiedNote(false), 2000);
    } catch (err) {
      console.error("Failed to copy note:", err);
    }
  };

  const handleShareAsNote = async () => {
    if (!analysis || !session) return;

    setIsPublishing(true);
    try {
      const npub = hexToNpub(analysis.targetPubkey);
      const isOwnAnalysis = analysis.targetPubkey === session.pubkey;

      // Build the note content - use nostr: link for the target
      let content = isOwnAnalysis
        ? `🔍 Sn👀pable Report for myself\n\n`
        : `🔍 Sn👀pable Report for nostr:${npub}\n\n`;

      content += `📊 DM Activity:\n`;
      content += `• ${analysis.totalSent} sent / ${analysis.totalReceived} received\n`;
      content += `• ${analysis.contacts.length} unique contacts\n`;

      if (analysis.oldestDM) {
        const oldestDate = new Date(analysis.oldestDM * 1000);
        content += `• Active since ${oldestDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}\n`;
      }

      content += `\n🏆 Top Contacts:\n`;
      const topContacts = analysis.contacts.slice(0, 3);
      topContacts.forEach((contact, i) => {
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
        if (includeNames && contact.profile) {
          const name =
            contact.profile.display_name ||
            contact.profile.name ||
            hexToNpub(contact.pubkey).slice(0, 12);
          content += `${medal} ${name} - ${contact.title} (${contact.totalCount} exchanges)\n`;
        } else {
          content += `${medal} ${contact.title} (${contact.totalCount} exchanges)\n`;
        }
      });

      content += `\nYour DMs aren't as private as you think!\nhttps://mutable.top/snoopable`;

      const result = await publishTextNote(content, [], session.relays);

      if (result.success) {
        setShowShareModal(false);
        alert("Note published successfully!");
      } else {
        alert(`Failed to publish note: ${result.error}`);
      }
    } catch (err) {
      console.error("Failed to publish note:", err);
      alert("Failed to publish note");
    } finally {
      setIsPublishing(false);
    }
  };

  const handleAnalyzeMe = () => {
    if (session?.pubkey) {
      const npub = hexToNpub(session.pubkey);
      setSearchInput(npub);
      handleAnalyze(npub);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-start gap-3 mb-4">
          <svg
            width="28"
            height="23"
            viewBox="0 0 459 374"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="text-purple-600 dark:text-purple-500 mt-1 flex-shrink-0"
          >
            <path
              d="M122.637 0.00931859C53.8791 0.00931859 0 81.967 0 186.615C0 291.263 53.8586 373.221 122.616 373.221C191.374 373.221 245.233 291.263 245.233 186.615C245.253 81.967 191.389 0.00931859 122.637 0.00931859ZM122.637 341.251C73.514 341.251 32.0091 270.431 32.0091 186.636C32.0091 102.82 73.5145 32.0205 122.637 32.0205C160.523 32.0205 193.769 74.1884 207.066 131.873C200.669 129.473 193.831 127.994 186.614 127.994C154.265 127.994 127.975 154.306 127.975 186.637C127.975 218.987 154.285 245.279 186.614 245.279C193.831 245.279 200.669 243.8 207.066 241.401C193.771 299.086 160.523 341.251 122.637 341.251ZM213.264 186.636C213.264 201.331 201.309 213.288 186.614 213.288C171.919 213.288 159.964 201.331 159.964 186.636C159.964 171.94 171.919 159.983 186.614 159.983C201.309 159.983 213.264 171.94 213.264 186.636ZM335.881 0.0297912C299.014 0.0297912 266.504 23.7429 244.214 61.754C250.552 74.4505 256.03 88.0862 260.308 102.722C276.682 60.5343 304.732 32.0047 335.883 32.0047C373.77 32.0047 407.016 74.1725 420.313 131.857C413.915 129.457 407.078 127.978 399.86 127.978C367.512 127.978 341.221 154.29 341.221 186.621C341.221 218.971 367.532 245.264 399.86 245.264C407.078 245.264 413.915 243.784 420.313 241.385C407.017 299.07 373.769 341.237 335.883 341.237C304.734 341.237 276.686 312.725 260.308 270.519C256.03 285.155 250.552 298.811 244.214 311.487C266.506 349.497 298.994 373.212 335.881 373.212C404.638 373.212 458.497 291.254 458.497 186.606C458.497 81.9577 404.638 0 335.881 0V0.0297912ZM399.858 213.308C385.163 213.308 373.208 201.352 373.208 186.656C373.208 171.96 385.163 160.004 399.858 160.004C414.553 160.004 426.508 171.96 426.508 186.656C426.508 201.352 414.553 213.308 399.858 213.308Z"
              fill="currentColor"
            />
          </svg>
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Snoopable
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              See how public your DM metadata really is. NIP-04 encrypts message
              content, but the envelope data is visible to anyone.
            </p>
          </div>
        </div>

        {/* Privacy Warning */}
        <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5"
              size={18}
            />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              NIP-04 encrypts message content, but metadata (who, when, how
              often) is public. Use <strong>NIP-17</strong> for true privacy.
            </p>
          </div>
        </div>

        {/* Results Disclaimer */}
        <p className="mb-6 text-xs text-gray-500 dark:text-gray-400">
          Results may vary based on relay availability and connection quality.
          We query the target user's NIP-65 relays when available.
        </p>

        {/* Search Input */}
        <div className="relative mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Search for any Nostr user or enter an npub to snoop.
          </label>
          <div className="relative h-[50px]">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
              onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
              placeholder="npub1... or username"
              className="absolute inset-0 w-full px-4 py-3 pl-10 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              disabled={analyzing}
            />
            <Search
              className="absolute left-3 top-[16px] text-gray-400 pointer-events-none"
              size={18}
            />
            {isSearching && (
              <RefreshCw
                className="absolute right-3 top-[16px] text-gray-400 animate-spin pointer-events-none"
                size={18}
              />
            )}
          </div>

          {/* Search Dropdown - outside the input container */}
          {showDropdown && searchResults.length > 0 && (
            <div
              className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-64 overflow-y-auto"
              style={{ top: "52px" }}
            >
              {searchResults.map((profile) => (
                <button
                  key={profile.pubkey}
                  onClick={() => handleSelectProfile(profile)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
                >
                  {profile.picture ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={profile.picture}
                      alt=""
                      className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          `https://api.dicebear.com/7.x/bottts/svg?seed=${profile.pubkey}`;
                      }}
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                      <User className="text-white" size={20} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 dark:text-white truncate">
                      {profile.display_name || profile.name || "Anonymous"}
                    </div>
                    {profile.nip05 && (
                      <div className="text-sm text-green-600 dark:text-green-400 truncate">
                        ✓ {profile.nip05}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => handleAnalyze()}
            disabled={analyzing || !searchInput.trim()}
            className={`flex-1 flex items-center justify-center space-x-2 px-4 py-3 rounded-lg font-medium transition-colors ${
              analyzing || !searchInput.trim()
                ? "bg-gray-400 text-gray-600 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"
                : "bg-purple-600 text-white hover:bg-purple-700"
            }`}
          >
            {analyzing ? (
              <>
                <RefreshCw className="animate-spin" size={18} />
                <span>Analyzing...</span>
              </>
            ) : (
              <>
                <Eye size={18} />
                <span>Snoop Anyone</span>
              </>
            )}
          </button>

          {session && !analyzing && (
            <button
              onClick={handleAnalyzeMe}
              disabled={analyzing}
              className="px-4 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <User size={18} />
              <span>Go Snoop Yourself</span>
            </button>
          )}

          {analyzing && (
            <button
              onClick={handleStop}
              className="px-4 py-3 bg-gray-600 text-white hover:bg-gray-700 dark:bg-gray-500 dark:hover:bg-gray-600 rounded-lg font-medium transition-colors"
            >
              Stop
            </button>
          )}
        </div>

        {/* Progress Display */}
        {analyzing && progressPhase && (
          <div className="mt-4 p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-lg">
            <div className="flex items-center gap-3">
              <RefreshCw
                className="animate-spin text-purple-600 dark:text-purple-400"
                size={20}
              />
              <div>
                <div className="font-medium text-purple-900 dark:text-purple-100">
                  {progressPhase}
                </div>
                {progressTotal ? (
                  <div className="text-sm text-purple-700 dark:text-purple-300">
                    {progressCount} of {progressTotal}
                  </div>
                ) : progressCount > 0 ? (
                  <div className="text-sm text-purple-700 dark:text-purple-300">
                    {progressCount} found
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && !analyzing && (
          <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 rounded text-red-700 dark:text-red-200 text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Results Section */}
      {analysis && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          {/* Results Header */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
            <div className="flex items-center gap-4">
              {analysis.targetProfile?.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={analysis.targetProfile.picture}
                  alt=""
                  className="w-16 h-16 rounded-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src =
                      `https://api.dicebear.com/7.x/bottts/svg?seed=${analysis.targetPubkey}`;
                  }}
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                  <User className="text-white" size={32} />
                </div>
              )}
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                  {analysis.targetProfile?.display_name ||
                    analysis.targetProfile?.name ||
                    hexToNpub(analysis.targetPubkey).slice(0, 16) + "..."}
                </h3>
                {analysis.targetProfile?.nip05 && (
                  <div className="text-sm text-green-600 dark:text-green-400">
                    ✓ {analysis.targetProfile.nip05}
                  </div>
                )}
              </div>
            </div>

            {/* Share Buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleCopyLink}
                className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                {copiedLink ? (
                  <>
                    <Check size={16} className="text-green-600" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Link size={16} />
                    <span>Copy Link</span>
                  </>
                )}
              </button>
              {!session && (
                <button
                  onClick={handleCopyNote}
                  className="flex items-center gap-2 px-3 py-2 text-sm bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/50 rounded-lg transition-colors"
                >
                  {copiedNote ? (
                    <>
                      <Check size={16} className="text-green-600" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={16} />
                      <span>Copy Note</span>
                    </>
                  )}
                </button>
              )}
              {session && (
                <button
                  onClick={() => setShowShareModal(true)}
                  className="flex items-center gap-2 px-3 py-2 text-sm bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/50 rounded-lg transition-colors"
                >
                  <Share2 size={16} />
                  <span>Share as Note</span>
                </button>
              )}
            </div>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                {analysis.totalSent}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Sent
              </div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-pink-600 dark:text-pink-400">
                {analysis.totalReceived}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Received
              </div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {analysis.contacts.length}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Contacts
              </div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {analysis.oldestDM
                  ? new Date(analysis.oldestDM * 1000).toLocaleDateString(
                      "en-US",
                      { month: "short", year: "numeric" },
                    )
                  : "N/A"}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Since
              </div>
            </div>
          </div>

          {/* View Tabs */}
          <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
            <button
              onClick={() => setActiveTab("circle")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "circle"
                  ? "border-purple-600 text-purple-600 dark:border-purple-500 dark:text-purple-500"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              DM Circle
            </button>
            <button
              onClick={() => setActiveTab("leaderboard")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "leaderboard"
                  ? "border-purple-600 text-purple-600 dark:border-purple-500 dark:text-purple-500"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              Leaderboard
            </button>
            <button
              onClick={() => setActiveTab("heatmap")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "heatmap"
                  ? "border-purple-600 text-purple-600 dark:border-purple-500 dark:text-purple-500"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              Heatmap
            </button>
          </div>

          {/* Tab Content */}
          {activeTab === "leaderboard" && (
            <DMLeaderboard
              contacts={analysis.contacts.filter((c) => c && c.pubkey)}
              onSelectContact={(contact) =>
                setSelectedProfile(
                  contact.profile || { pubkey: contact.pubkey },
                )
              }
            />
          )}

          {activeTab === "heatmap" && <DMHeatmap data={analysis.heatmapData} />}

          {activeTab === "circle" && (
            <DMCircle
              targetProfile={analysis.targetProfile}
              targetPubkey={analysis.targetPubkey}
              contacts={analysis.contacts}
            />
          )}
        </div>
      )}

      {/* Share Modal */}
      {showShareModal && analysis && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              Share as Nostr Note
            </h3>

            <div className="mb-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeNames}
                  onChange={(e) => setIncludeNames(e.target.checked)}
                  className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Include contact names (default: titles only)
                </span>
              </label>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 mb-4 text-sm font-mono whitespace-pre-wrap text-gray-800 dark:text-gray-200">
              {`🔍 Sn👀pable Report for ${analysis.targetPubkey === session?.pubkey ? "myself" : `@${analysis.targetProfile?.display_name || analysis.targetProfile?.name || hexToNpub(analysis.targetPubkey).slice(0, 16) + "..."}`}

📊 DM Activity:
• ${analysis.totalSent} sent / ${analysis.totalReceived} received
• ${analysis.contacts.length} unique contacts

🏆 Top Contacts:
${analysis.contacts
  .slice(0, 3)
  .map((c, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
    const name =
      includeNames && c.profile
        ? c.profile.display_name || c.profile.name || "Anonymous"
        : c.title;
    return `${medal} ${name} (${c.totalCount} exchanges)`;
  })
  .join("\n")}

Your DMs aren't as private as you think!
https://mutable.top/snoopable`}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowShareModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleShareAsNote}
                disabled={isPublishing}
                className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isPublishing ? (
                  <>
                    <RefreshCw className="animate-spin" size={16} />
                    Publishing...
                  </>
                ) : (
                  <>
                    <MessageCircle size={16} />
                    Publish Note
                  </>
                )}
              </button>
            </div>
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
