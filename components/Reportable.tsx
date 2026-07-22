"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  RefreshCw,
  Search,
  Flag,
  User,
  Copy,
  ExternalLink,
  AlertCircle,
  Loader2,
  Lock,
  LogOut,
  X,
  Info,
} from "lucide-react";
import { Profile, ReportResult, ReportFeedEntry } from "@/types";
import UserProfileModal from "./UserProfileModal";
import ReportScoreModal from "./ReportScoreModal";
import GlobalUserSearch from "./GlobalUserSearch";
import Footer from "./Footer";
import DashboardNav from "./DashboardNav";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import {
  searchReportsNetworkWide,
  enrichReportsWithProfiles,
  fetchRecentReportsFeed,
  enrichReportsFeedWithProfiles,
  hexToNpub,
  npubToHex,
  searchProfiles,
  getExpandedRelayList,
  fetchProfile,
  DEFAULT_RELAYS,
} from "@/lib/nostr";
import { getDisplayName, getErrorMessage } from "@/lib/utils/format";
import { getProfileLink } from "@/lib/utils/links";
import { copyToClipboard } from "@/lib/utils/clipboard";

const INITIAL_LOAD_COUNT = 20;
const LOAD_MORE_COUNT = 20;

type Tab = "lookup" | "feed";

// Get Report Score based on unique reporter count
const getReportScore = (count: number): { emoji: string; label: string } => {
  if (count === 0) return { emoji: "⬜", label: "Clean" };
  if (count <= 2) return { emoji: "🟦", label: "Flagged" };
  if (count <= 5) return { emoji: "🟩", label: "Noted" };
  if (count <= 10) return { emoji: "🟨", label: "Concerning" };
  if (count <= 20) return { emoji: "🟧", label: "Risky" };
  if (count <= 40) return { emoji: "🟥", label: "Dangerous" };
  if (count <= 75) return { emoji: "🟪", label: "Severe" };
  return { emoji: "⬛", label: "Critical" };
};

const REPORT_TYPE_LABELS: Record<string, string> = {
  nudity: "Nudity",
  malware: "Malware",
  profanity: "Profanity",
  illegal: "Illegal",
  spam: "Spam",
  impersonation: "Impersonation",
  other: "Other",
};

const REPORT_TYPE_COLORS: Record<string, string> = {
  nudity: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
  malware: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  profanity:
    "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  illegal: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  spam: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  impersonation:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  other: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
};

function ReportTypeBadge({ type }: { type?: string }) {
  const key = type?.toLowerCase() || "other";
  const label = REPORT_TYPE_LABELS[key] || type || "Other";
  const colors = REPORT_TYPE_COLORS[key] || REPORT_TYPE_COLORS.other;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors}`}
    >
      {label}
    </span>
  );
}

function formatRelativeDate(timestamp?: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - date.getTime());
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMinutes = Math.floor(diffTime / (1000 * 60));
      return diffMinutes <= 1 ? "just now" : `${diffMinutes}m ago`;
    }
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

export default function Reportable() {
  const searchParams = useSearchParams();
  const { session, disconnect } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("lookup");
  const [userProfile, setUserProfile] = useState<Profile | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [showReportScoreModal, setShowReportScoreModal] = useState(false);

  // Lookup tab state
  const [searchQuery, setSearchQuery] = useState("");
  const [targetPubkey, setTargetPubkey] = useState<string | null>(null);
  const [targetProfile, setTargetProfile] = useState<Profile | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchCompleted, setSearchCompleted] = useState(false);
  const [allResults, setAllResults] = useState<ReportResult[]>([]);
  const [displayedResults, setDisplayedResults] = useState<ReportResult[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [copiedNpub, setCopiedNpub] = useState<string | null>(null);
  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);

  const [profileSearchResults, setProfileSearchResults] = useState<Profile[]>(
    [],
  );
  const [isSearchingProfiles, setIsSearchingProfiles] = useState(false);
  const [showProfileResults, setShowProfileResults] = useState(false);
  const searchDropdownRef = useRef<HTMLDivElement>(null);

  // Feed tab state
  const [feedEntries, setFeedEntries] = useState<ReportFeedEntry[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedLoaded, setFeedLoaded] = useState(false);

  const relays = session?.relays || DEFAULT_RELAYS;

  useEffect(() => {
    const loadUserProfile = async () => {
      if (session?.pubkey) {
        try {
          const profile = await fetchProfile(session.pubkey, session.relays);
          setUserProfile(profile);
        } catch (error) {
          console.error("Failed to load user profile:", error);
        }
      } else {
        setUserProfile(null);
      }
    };
    loadUserProfile();
  }, [session]);

  // Auto-populate from URL parameter
  useEffect(() => {
    const npub = searchParams.get("npub");
    if (npub && (npub.startsWith("npub") || npub.startsWith("nprofile"))) {
      setSearchQuery(npub);
      setTimeout(() => {
        const searchButton = document.querySelector(
          "[data-report-search-button]",
        ) as HTMLButtonElement;
        if (searchButton) searchButton.click();
      }, 100);
    }
  }, [searchParams]);

  // Real-time profile search dropdown
  useEffect(() => {
    const searchUserProfiles = async () => {
      if (!searchQuery.trim()) {
        setProfileSearchResults([]);
        setShowProfileResults(false);
        return;
      }
      if (
        searchQuery.startsWith("npub") ||
        searchQuery.startsWith("nprofile") ||
        searchQuery.match(/^[0-9a-f]{64}$/i)
      ) {
        setProfileSearchResults([]);
        setShowProfileResults(false);
        return;
      }
      setIsSearchingProfiles(true);
      setShowProfileResults(true);
      try {
        const results = await searchProfiles(searchQuery, relays, 10);
        setProfileSearchResults(results);
      } catch (error) {
        console.error("Profile search failed:", error);
        setProfileSearchResults([]);
      } finally {
        setIsSearchingProfiles(false);
      }
    };
    const timeoutId = setTimeout(searchUserProfiles, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, relays]);

  useEffect(() => {
    const query = searchQuery.trim();
    const isCompleteNpub = query.startsWith("npub") && query.length === 63;
    const isCompleteNprofile = query.startsWith("nprofile");
    const isCompleteHex = query.match(/^[0-9a-f]{64}$/i);

    if (
      (isCompleteNpub || isCompleteNprofile || isCompleteHex) &&
      !searching &&
      !targetPubkey
    ) {
      const timeoutId = setTimeout(() => {
        handleSearch();
      }, 500);
      return () => clearTimeout(timeoutId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searching, targetPubkey]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchDropdownRef.current &&
        !searchDropdownRef.current.contains(event.target as Node)
      ) {
        setShowProfileResults(false);
      }
    };
    if (showProfileResults) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showProfileResults]);

  // Infinite scroll for lookup results
  useEffect(() => {
    const trigger = loadMoreTriggerRef.current;
    if (!trigger) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (
          entry.isIntersecting &&
          allResults.length > displayedResults.length &&
          !loadingMore
        ) {
          handleLoadMore();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(trigger);
    return () => {
      if (trigger) observer.unobserve(trigger);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allResults.length, displayedResults.length, loadingMore]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    try {
      setSearching(true);
      setSearchCompleted(false);
      setError(null);
      setAllResults([]);
      setDisplayedResults([]);
      setProgress("Starting search...");

      let pubkey = targetPubkey || searchQuery.trim();

      if (!targetPubkey) {
        try {
          if (pubkey.startsWith("npub") || pubkey.startsWith("nprofile")) {
            pubkey = npubToHex(pubkey);
            setProgress("Loading profile...");
            const profile = await fetchProfile(pubkey, relays);
            setTargetProfile(profile);
            if (profile) {
              setSearchQuery(
                profile.display_name ||
                  profile.name ||
                  profile.nip05 ||
                  searchQuery,
              );
            }
          } else if (!pubkey.match(/^[0-9a-f]{64}$/i)) {
            setProgress("Searching for user...");
            const profiles = await searchProfiles(pubkey, relays, 10);
            if (profiles.length === 0) {
              setError(`No user found with username or NIP-05: "${pubkey}"`);
              setSearching(false);
              return;
            }
            pubkey = profiles[0].pubkey;
            setTargetProfile(profiles[0]);
          } else {
            setProgress("Loading profile...");
            const profile = await fetchProfile(pubkey, relays);
            setTargetProfile(profile);
            if (profile) {
              setSearchQuery(
                profile.display_name ||
                  profile.name ||
                  profile.nip05 ||
                  searchQuery,
              );
            }
          }
        } catch (conversionError) {
          console.error("Failed to convert npub:", conversionError);
          setError(`Invalid npub format. Please check the npub and try again.`);
          setSearching(false);
          return;
        }
      }

      setTargetPubkey(pubkey);
      setProgress("Searching network for public reports...");

      const expandedRelays = getExpandedRelayList(relays);

      const rawResults = await searchReportsNetworkWide(
        pubkey,
        expandedRelays,
        (count) => {
          setProgress(
            `Scanning relays... ${count} report${count === 1 ? "" : "s"} collected`,
          );
        },
      );

      if (rawResults.length === 0) {
        setAllResults([]);
        setDisplayedResults([]);
        setProgress("");
        setSearchCompleted(true);
        setSearching(false);
        return;
      }

      setAllResults(rawResults);
      setProgress(
        `Found ${rawResults.length} public report${rawResults.length === 1 ? "" : "s"} - loading profiles...`,
      );

      const initialBatch = rawResults.slice(0, INITIAL_LOAD_COUNT);
      await new Promise((resolve) => setTimeout(resolve, 500));

      const enriched = await enrichReportsWithProfiles(
        initialBatch,
        relays,
        (current, total) => {
          setProgress(`Loading profiles... ${current}/${total}`);
        },
      );

      setDisplayedResults(enriched);
      setProgress("");
      setSearchCompleted(true);
    } catch (err) {
      console.error("Search error:", err);
      setError(getErrorMessage(err, "Failed to search for public reports"));
      setProgress("");
    } finally {
      setSearching(false);
    }
  };

  const handleSelectProfile = (profile: Profile) => {
    setSearchQuery(profile.display_name || profile.name || profile.nip05 || "");
    setShowProfileResults(false);
    setTargetProfile(profile);
    setTargetPubkey(profile.pubkey);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
      setShowProfileResults(false);
    }
  };

  const handleLoadMore = async () => {
    if (loadingMore) return;
    const currentCount = displayedResults.length;
    const nextBatch = allResults.slice(
      currentCount,
      currentCount + LOAD_MORE_COUNT,
    );
    if (nextBatch.length === 0) return;

    setLoadingMore(true);
    try {
      const enriched = await enrichReportsWithProfiles(
        nextBatch,
        relays,
        (current, total) => {
          setProgress(`Loading more profiles... ${current}/${total}`);
        },
      );
      setDisplayedResults((prev) => [...prev, ...enriched]);
      setProgress("");
    } catch (err) {
      console.error("Failed to load more:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleCopyNpub = async (npub: string) => {
    const success = await copyToClipboard(npub);
    if (success) {
      setCopiedNpub(npub);
      setTimeout(() => setCopiedNpub(null), 2000);
    }
  };

  const handleReset = () => {
    setSearchQuery("");
    setTargetPubkey(null);
    setTargetProfile(null);
    setAllResults([]);
    setDisplayedResults([]);
    setError(null);
    setProgress("");
    setSearchCompleted(false);
    setProfileSearchResults([]);
    setShowProfileResults(false);
  };

  const handleDisconnect = () => {
    disconnect();
    window.location.href = "/";
  };

  const handleUserSelect = (profile: Profile) => {
    setSelectedProfile(profile);
  };

  const loadFeed = async (refresh = false) => {
    setFeedLoading(true);
    setFeedError(null);
    try {
      const expandedRelays = getExpandedRelayList(relays, 10);
      const raw = await fetchRecentReportsFeed(expandedRelays, 100, 30);
      const enriched = await enrichReportsFeedWithProfiles(raw, relays);
      setFeedEntries(enriched);
      setFeedLoaded(true);
    } catch (err) {
      console.error("Failed to load reports feed:", err);
      setFeedError(getErrorMessage(err, "Failed to load reports feed"));
    } finally {
      setFeedLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "feed" && !feedLoaded && !feedLoading) {
      loadFeed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Report score breakdown by type for lookup results
  const reportTypeCounts = allResults.reduce<Record<string, number>>(
    (acc, r) => {
      const key = (r.reportType || "other").toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    {},
  );
  const uniqueReporters = new Set(allResults.map((r) => r.reportedBy)).size;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {session ? (
        <>
          <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center h-16 gap-4">
                <Link
                  href="/dashboard"
                  className="flex items-center space-x-3 flex-shrink-0 hover:opacity-80 transition-opacity"
                  title="Go to Dashboard"
                >
                  <Image
                    src="/mutable_logo.svg"
                    alt="Mutable"
                    width={40}
                    height={40}
                  />
                  <Image
                    src="/mutable_text.svg"
                    alt="Mutable"
                    width={120}
                    height={24}
                    className="hidden sm:block"
                  />
                </Link>

                <GlobalUserSearch onSelectUser={handleUserSelect} />

                <div className="flex items-center space-x-4 flex-shrink-0">
                  <div className="hidden md:flex items-center space-x-3">
                    {userProfile?.picture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={userProfile.picture}
                        alt={getDisplayName(userProfile, "User")}
                        className="w-8 h-8 rounded-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/%3E%3Cpath d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/%3E%3C/svg%3E';
                        }}
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                        <User size={16} className="text-gray-600 dark:text-gray-300" />
                      </div>
                    )}
                    <div className="flex flex-col">
                      {userProfile && (
                        <>
                          <span className="text-sm font-medium text-gray-900 dark:text-white">
                            {getDisplayName(userProfile)}
                          </span>
                          {userProfile.nip05 && (
                            <span className="text-xs text-gray-600 dark:text-gray-400">
                              {userProfile.nip05}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="md:hidden">
                    {userProfile?.picture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={userProfile.picture}
                        alt={getDisplayName(userProfile, "User")}
                        className="w-8 h-8 rounded-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/%3E%3Cpath d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/%3E%3C/svg%3E';
                        }}
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                        <User size={16} className="text-gray-600 dark:text-gray-300" />
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleDisconnect}
                    className="flex items-center space-x-2 px-4 py-2 text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
                    title="Disconnect"
                  >
                    <LogOut size={16} />
                  </button>
                </div>
              </div>
            </div>
          </header>

          <DashboardNav activePage="reportable" />
        </>
      ) : (
        <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16 gap-4">
              <Link
                href="/"
                className="flex items-center space-x-3 flex-shrink-0 hover:opacity-80 transition-opacity"
                title="Go to Home"
              >
                <Image src="/mutable_logo.svg" alt="Mutable" width={40} height={40} />
                <Image
                  src="/mutable_text.svg"
                  alt="Mutable"
                  width={120}
                  height={24}
                  className="hidden sm:block"
                />
              </Link>

              <div className="flex-1" />

              <div className="flex items-center gap-3">
                <span className="hidden md:inline text-sm text-gray-600 dark:text-gray-400">
                  Get the full experience!
                </span>
                <Link
                  href="/"
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium flex items-center gap-2"
                >
                  <Lock size={16} />
                  Connect with Nostr
                </Link>
              </div>
            </div>
          </div>
        </header>
      )}

      <div className="flex-1 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <div className="container mx-auto px-4 py-8 max-w-6xl">
          {/* Page Header */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <div className="flex items-start gap-4 mb-4">
              <div className="flex-shrink-0 mt-1 w-10 h-10 rounded-lg bg-red-600 flex items-center justify-center">
                <Flag className="text-white" size={22} />
              </div>
              <div className="flex-1">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                  Reportable
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  See who is publicly reporting whom on Nostr — look up a pubkey&apos;s
                  report history or browse the live feed
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {!session && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-sm font-medium border border-green-200 dark:border-green-700">
                  🔓 No sign-in required
                </span>
              )}
              {session && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full text-sm font-medium border border-purple-200 dark:border-purple-700">
                  ⚡ Using your relays
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm font-medium border border-blue-200 dark:border-blue-700">
                🚩 NIP-56 public reports only
              </span>
            </div>

            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>Note:</strong> Reports are self-published, unmoderated claims —
                anyone can report anyone for any reason. Treat this as a public signal to
                investigate further, not a verdict.
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 mb-6">
            <div className="flex border-b border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setActiveTab("lookup")}
                className={`flex-1 px-6 py-4 text-sm font-semibold transition-colors border-b-2 ${
                  activeTab === "lookup"
                    ? "border-red-600 text-red-600 dark:border-red-500 dark:text-red-500"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                }`}
              >
                Look Up a User
              </button>
              <button
                onClick={() => setActiveTab("feed")}
                className={`flex-1 px-6 py-4 text-sm font-semibold transition-colors border-b-2 ${
                  activeTab === "feed"
                    ? "border-red-600 text-red-600 dark:border-red-500 dark:text-red-500"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                }`}
              >
                Reports Feed
              </button>
            </div>
          </div>

          {activeTab === "lookup" && (
            <>
              {/* Search Section */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
                <div className="relative" ref={searchDropdownRef}>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          if (targetPubkey) {
                            setTargetPubkey(null);
                            setTargetProfile(null);
                            setSearchCompleted(false);
                          }
                        }}
                        onKeyPress={handleKeyPress}
                        onFocus={() => {
                          if (profileSearchResults.length > 0) {
                            setShowProfileResults(true);
                          }
                        }}
                        placeholder="Enter username, NIP-05, npub, nprofile, or pubkey..."
                        className="w-full px-4 py-3 pr-10 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-lg"
                        disabled={searching}
                      />
                      {isSearchingProfiles && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <Loader2 size={20} className="animate-spin text-gray-400" />
                        </div>
                      )}

                      {showProfileResults && profileSearchResults.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-80 overflow-y-auto z-50">
                          {profileSearchResults.map((profile) => (
                            <button
                              key={profile.pubkey}
                              onClick={() => handleSelectProfile(profile)}
                              className="w-full flex items-center gap-3 p-3 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
                            >
                              {profile.picture ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={profile.picture}
                                  alt={getDisplayName(profile, "User")}
                                  className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                  }}
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
                                  <User size={20} className="text-gray-600 dark:text-gray-300" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 dark:text-white truncate">
                                  {getDisplayName(profile)}
                                </p>
                                {profile.nip05 && (
                                  <p className="text-xs text-green-600 dark:text-green-400 truncate">
                                    ✓ {profile.nip05}
                                  </p>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      data-report-search-button
                      onClick={() => {
                        setShowProfileResults(false);
                        handleSearch();
                      }}
                      disabled={searching || !searchQuery.trim()}
                      className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {searching ? (
                        <>
                          <RefreshCw className="animate-spin" size={20} />
                          <span className="hidden sm:inline">Searching...</span>
                        </>
                      ) : (
                        <>
                          <Search size={20} />
                          <span className="hidden sm:inline">Search</span>
                        </>
                      )}
                    </button>
                    {(searchQuery || allResults.length > 0) && !searching && (
                      <button
                        onClick={handleReset}
                        className="px-4 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium flex items-center gap-2"
                        title="Reset search"
                      >
                        <X size={20} />
                        <span className="hidden sm:inline">Reset</span>
                      </button>
                    )}
                  </div>
                </div>

                {searching && (
                  <div className="mt-4 p-4 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-2 border-blue-200 dark:border-blue-700 rounded-lg">
                    <div className="flex flex-col items-center space-y-2">
                      {allResults.length > 0 && (
                        <div className="text-lg font-semibold text-blue-900 dark:text-blue-100">
                          Found {allResults.length} Public Report
                          {allResults.length === 1 ? "" : "s"}
                        </div>
                      )}
                      {progress && (
                        <div className="flex items-center space-x-3">
                          <RefreshCw className="animate-spin text-blue-600 dark:text-blue-400" size={20} />
                          <div className="text-blue-900 dark:text-blue-100 font-medium">
                            {progress}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {error && (
                  <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 rounded text-red-700 dark:text-red-200 text-sm flex items-start gap-2">
                    <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}
              </div>

              {/* Zero reports (clean) */}
              {!searching &&
                searchCompleted &&
                allResults.length === 0 &&
                targetPubkey &&
                !error && (
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                    <div className="mb-4">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                        Found 0 Public Reports
                      </h3>
                      <button
                        onClick={() => setShowReportScoreModal(true)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                        title="Click to view all Report Score levels"
                      >
                        <span className="text-2xl">{getReportScore(0).emoji}</span>
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                          Report Score: {getReportScore(0).label}
                        </span>
                        <Info size={16} className="text-gray-500 dark:text-gray-400" />
                      </button>
                    </div>
                    <div className="text-center p-8">
                      <Flag className="mx-auto mb-3 text-green-500" size={48} />
                      <p className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                        No Public Reports Found
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        No one has publicly reported this user on the scanned relays.
                      </p>
                    </div>
                  </div>
                )}

              {displayedResults.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                      Found {allResults.length} Public Report
                      {allResults.length === 1 ? "" : "s"} from {uniqueReporters} Unique
                      Reporter{uniqueReporters === 1 ? "" : "s"}
                    </h3>

                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <button
                        onClick={() => setShowReportScoreModal(true)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                        title="Click to view all Report Score levels"
                      >
                        <span className="text-2xl">
                          {getReportScore(uniqueReporters).emoji}
                        </span>
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                          Report Score: {getReportScore(uniqueReporters).label}
                        </span>
                        <Info size={16} className="text-gray-500 dark:text-gray-400" />
                      </button>

                      {allResults.length > displayedResults.length && (
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Showing {displayedResults.length} of {allResults.length}
                        </p>
                      )}
                    </div>

                    {/* Report type breakdown */}
                    <div className="flex flex-wrap gap-2 mt-3">
                      {Object.entries(reportTypeCounts)
                        .sort((a, b) => b[1] - a[1])
                        .map(([type, count]) => (
                          <div
                            key={type}
                            className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                          >
                            <ReportTypeBadge type={type} />
                            <span className="text-xs text-gray-600 dark:text-gray-400">
                              ×{count}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    {displayedResults.map((report) => {
                      const profile = report.profile;
                      const displayName = profile
                        ? getDisplayName(profile)
                        : "Loading profile...";
                      const npub = hexToNpub(report.reportedBy);
                      const isLoading = !profile;

                      return (
                        <div
                          key={report.eventId}
                          className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div
                              className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden cursor-pointer"
                              onClick={() =>
                                setSelectedProfile(profile || { pubkey: report.reportedBy })
                              }
                              title="View profile"
                            >
                              {isLoading ? (
                                <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
                                  <Loader2 size={20} className="text-gray-600 dark:text-gray-300 animate-spin" />
                                </div>
                              ) : profile?.picture ? (
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
                                  <span
                                    className={`font-medium truncate ${isLoading ? "text-gray-500 dark:text-gray-400 italic" : "text-gray-900 dark:text-white"}`}
                                  >
                                    {displayName}
                                  </span>
                                  <ReportTypeBadge type={report.reportType} />
                                </div>
                                {profile?.nip05 && (
                                  <div className="text-xs text-green-600 dark:text-green-400 truncate">
                                    ✓ {profile.nip05}
                                  </div>
                                )}
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                  Reported {formatRelativeDate(report.reportedAt)}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
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
                              <a
                                href={getProfileLink(report.reportedBy)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 text-blue-600 dark:text-blue-400 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                                title="View on npub.world"
                              >
                                <ExternalLink size={16} />
                              </a>
                            </div>
                          </div>

                          {report.content && (
                            <p className="mt-2 pl-[52px] text-sm text-gray-600 dark:text-gray-400 italic">
                              &ldquo;{report.content}&rdquo;
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {allResults.length > displayedResults.length && (
                    <div className="mt-6">
                      <div ref={loadMoreTriggerRef} className="h-4" />
                      {loadingMore && progress ? (
                        <div className="p-4 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-2 border-blue-200 dark:border-blue-700 rounded-lg">
                          <div className="flex items-center justify-center space-x-3">
                            <RefreshCw className="animate-spin text-blue-600 dark:text-blue-400" size={20} />
                            <div className="text-blue-900 dark:text-blue-100 font-medium">
                              {progress}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={handleLoadMore}
                          className="w-full p-3 bg-gray-50 dark:bg-gray-700/30 border border-gray-200 dark:border-gray-600 rounded-lg text-center hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:border-gray-300 dark:hover:border-gray-500 transition-colors cursor-pointer"
                        >
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            Scroll down or click to load more •{" "}
                            {allResults.length - displayedResults.length} remaining
                          </p>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {activeTab === "feed" && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <div className="flex items-center justify-between gap-4 mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Recent Public Reports
                </h3>
                <button
                  onClick={() => loadFeed(true)}
                  disabled={feedLoading}
                  className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm font-medium text-gray-700 dark:text-gray-300 disabled:opacity-50"
                >
                  <RefreshCw size={16} className={feedLoading ? "animate-spin" : ""} />
                  Refresh
                </button>
              </div>

              {feedError && (
                <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 rounded text-red-700 dark:text-red-200 text-sm flex items-start gap-2">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  <span>{feedError}</span>
                </div>
              )}

              {feedLoading && feedEntries.length === 0 && (
                <div className="flex items-center justify-center gap-3 p-8 text-gray-500 dark:text-gray-400">
                  <RefreshCw className="animate-spin" size={20} />
                  Loading recent reports...
                </div>
              )}

              {!feedLoading && feedLoaded && feedEntries.length === 0 && !feedError && (
                <div className="text-center p-8">
                  <Flag className="mx-auto mb-3 text-green-500" size={48} />
                  <p className="text-gray-600 dark:text-gray-400">
                    No recent reports found on the scanned relays.
                  </p>
                </div>
              )}

              <div className="space-y-3">
                {feedEntries.map((entry) => {
                  const reporterName = entry.reporterProfile
                    ? getDisplayName(entry.reporterProfile)
                    : `${entry.reportedBy.substring(0, 8)}...`;
                  const targetNames = entry.targetProfiles?.length
                    ? entry.targetProfiles.map((p) => getDisplayName(p)).join(", ")
                    : entry.reportedPubkeys.map((pk) => `${pk.substring(0, 8)}...`).join(", ");

                  return (
                    <div
                      key={entry.eventId}
                      className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                    >
                      <div className="flex items-center gap-2 flex-wrap text-sm">
                        <button
                          className="font-medium text-gray-900 dark:text-white hover:underline"
                          onClick={() =>
                            setSelectedProfile(
                              entry.reporterProfile || { pubkey: entry.reportedBy },
                            )
                          }
                        >
                          {reporterName}
                        </button>
                        <span className="text-gray-500 dark:text-gray-400">reported</span>
                        <span className="font-medium text-gray-900 dark:text-white">
                          {targetNames}
                        </span>
                        <ReportTypeBadge type={entry.reportType} />
                        <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">
                          {formatRelativeDate(entry.reportedAt)}
                        </span>
                      </div>
                      {entry.content && (
                        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 italic">
                          &ldquo;{entry.content}&rdquo;
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {selectedProfile && (
            <UserProfileModal
              profile={selectedProfile}
              onClose={() => setSelectedProfile(null)}
            />
          )}

          {showReportScoreModal && (
            <ReportScoreModal onClose={() => setShowReportScoreModal(false)} />
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}
