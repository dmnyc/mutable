"use client";

import { useState, useEffect, useRef, useMemo } from "react";
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
  Check,
  Share2,
  Bot,
  Send,
  Fingerprint,
  FileJson,
  FileText,
} from "lucide-react";
import { Profile, ReportResult, ReportFiledResult, ReportFeedEntry } from "@/types";
import UserProfileModal from "./UserProfileModal";
import ReportScoreModal from "./ReportScoreModal";
import ReportableShareModal from "./ReportableShareModal";
import ReportDetailModal from "./ReportDetailModal";
import ReportTypeBadge from "./ReportTypeBadge";
import GlobalUserSearch from "./GlobalUserSearch";
import Footer from "./Footer";
import DashboardNav from "./DashboardNav";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import {
  searchReportsNetworkWide,
  searchReportsFiledBy,
  enrichReportsWithProfiles,
  enrichReportsFiledWithProfiles,
  fetchRecentReportsFeed,
  enrichReportsFeedWithProfiles,
  hexToNpub,
  npubToHex,
  searchProfiles,
  fetchProfile,
  getExpandedRelayList,
  DEFAULT_RELAYS,
} from "@/lib/nostr";
import { getDisplayName, getErrorMessage } from "@/lib/utils/format";
import { getReportEventLink } from "@/lib/utils/links";
import { copyToClipboard } from "@/lib/utils/clipboard";
import {
  getReportScore,
  isAutomatedContent,
  isAutomatedReporter,
  findAutomatedReportIds,
} from "@/lib/utils/reportScore";

const INITIAL_LOAD_COUNT = 20;
const LOAD_MORE_COUNT = 20;

type Tab = "lookup" | "feed";
type ResultView = "received" | "filed";


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
  const [
    detailReport,
    setDetailReport,
  ] = useState<ReportResult | ReportFiledResult | ReportFeedEntry | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);

  // Lookup tab state
  const [searchQuery, setSearchQuery] = useState("");
  const [targetPubkey, setTargetPubkey] = useState<string | null>(null);
  const [targetProfile, setTargetProfile] = useState<Profile | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchCompleted, setSearchCompleted] = useState(false);
  const [allResults, setAllResults] = useState<ReportResult[]>([]);
  const [displayedResults, setDisplayedResults] = useState<ReportResult[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  // Reports the target has FILED against others (second results view)
  const [filedResults, setFiledResults] = useState<ReportFiledResult[]>([]);
  const [filedDisplayed, setFiledDisplayed] = useState<ReportFiledResult[]>(
    [],
  );
  const [filedLoading, setFiledLoading] = useState(false);
  const [filedSearchDone, setFiledSearchDone] = useState(false);
  const [resultView, setResultView] = useState<ResultView>("received");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [copiedNpub, setCopiedNpub] = useState<string | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
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
  const [feedEnriching, setFeedEnriching] = useState(false);
  // Bulk reporters (anti-spam bots) bury human reports — hide by default.
  const [hideAutomatedReporters, setHideAutomatedReporters] = useState(true);
  const [hideAutomatedReceived, setHideAutomatedReceived] = useState(true);

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

  // Auto-populate from URL parameter. Guarded against re-triggering: the
  // URL gains ?npub= on every search (see handleSearch), and replaceState
  // updates useSearchParams, so without the guards this effect would
  // restart the search in a loop.
  useEffect(() => {
    const npub = searchParams.get("npub");
    if (
      npub &&
      (npub.startsWith("npub") || npub.startsWith("nprofile")) &&
      !targetPubkey &&
      !searching
    ) {
      setSearchQuery(npub);
      setTimeout(() => {
        const searchButton = document.querySelector(
          "[data-report-search-button]",
        ) as HTMLButtonElement;
        if (searchButton) searchButton.click();
      }, 100);
    }
  }, [searchParams]);

  // Deep links: ?tab=feed opens on the feed, ?view=filed opens lookup
  // results on the filed view. Mount-only — handleSearch re-applies the
  // view param once results land.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "feed") setActiveTab("feed");
    if (params.get("view") === "filed") setResultView("filed");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Infinite scroll for lookup results — whichever view is active
  useEffect(() => {
    const trigger = loadMoreTriggerRef.current;
    if (!trigger) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        const hasMore =
          resultView === "received"
            ? allResults.length > displayedResults.length
            : filedResults.length > filedDisplayed.length;
        if (entry.isIntersecting && hasMore && !loadingMore) {
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
  }, [
    allResults.length,
    displayedResults.length,
    filedResults.length,
    filedDisplayed.length,
    resultView,
    loadingMore,
  ]);

  // Reports the target has filed against others — runs in parallel with the
  // received-reports scan so neither view waits on the other.
  const loadFiledReports = async (pubkey: string) => {
    setFiledLoading(true);
    setFiledSearchDone(false);
    setFiledResults([]);
    setFiledDisplayed([]);
    try {
      const raw = await searchReportsFiledBy(pubkey, relays);
      setFiledResults(raw);
      setFiledDisplayed(raw.slice(0, INITIAL_LOAD_COUNT));
      setFiledSearchDone(true);
      if (raw.length === 0) return;

      // Same progressive pattern as the received view: render raw rows
      // first, patch target profiles in as enrichment lands.
      const initialBatch = raw.slice(0, INITIAL_LOAD_COUNT);
      const enriched = await enrichReportsFiledWithProfiles(
        initialBatch,
        relays,
      );
      setFiledDisplayed((prev) =>
        prev.map((r) => enriched.find((e) => e.eventId === r.eventId) || r),
      );
    } catch (err) {
      console.error("Failed to load filed reports:", err);
      setFiledSearchDone(true);
    } finally {
      setFiledLoading(false);
    }
  };

  // overridePubkey lets callers (e.g. "Check my Reports") search a known pubkey
  // immediately, without waiting for the searchQuery state to flush.
  const handleSearch = async (overridePubkey?: string) => {
    if (!overridePubkey && !searchQuery.trim()) return;

    try {
      setSearching(true);
      setSearchCompleted(false);
      setError(null);
      setAllResults([]);
      setDisplayedResults([]);
      setFiledResults([]);
      setFiledDisplayed([]);
      setFiledLoading(false);
      setFiledSearchDone(false);
      setResultView("received");
      setProgress("Starting search...");

      let pubkey = overridePubkey || targetPubkey || searchQuery.trim();

      if (!targetPubkey && !overridePubkey) {
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
      } else if (overridePubkey && !targetProfile) {
        setProgress("Loading profile...");
        const profile = await fetchProfile(overridePubkey, relays);
        setTargetProfile(profile);
        if (profile) {
          setSearchQuery(
            profile.display_name || profile.name || profile.nip05 || "",
          );
        }
      }

      setTargetPubkey(pubkey);

      // Keep the URL shareable: reflect the searched npub. Honor a
      // ?view=filed deep link only when it names this same npub, so a
      // stale param can't force the filed view onto a different search.
      const searchedNpub = hexToNpub(pubkey);
      const urlParams = new URLSearchParams(window.location.search);
      const deepLinkedFiled =
        urlParams.get("view") === "filed" &&
        urlParams.get("npub") === searchedNpub;
      urlParams.set("npub", searchedNpub);
      urlParams.delete("tab");
      if (deepLinkedFiled) urlParams.set("view", "filed");
      else urlParams.delete("view");
      window.history.replaceState(
        null,
        "",
        `/reportable?${urlParams.toString()}`,
      );
      if (deepLinkedFiled) setResultView("filed");

      setProgress("Searching network for public reports...");

      // Received scan below; filed scan alongside it.
      void loadFiledReports(pubkey);

      const rawResults = await searchReportsNetworkWide(
        pubkey,
        getExpandedRelayList(relays),
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

      // Render immediately with raw pubkeys — rows show a "Loading
      // profile…" state — then patch profiles in as enrichment lands.
      setAllResults(rawResults);
      setDisplayedResults(rawResults.slice(0, INITIAL_LOAD_COUNT));
      setProgress("");
      setSearchCompleted(true);

      const initialBatch = rawResults.slice(0, INITIAL_LOAD_COUNT);
      const enriched = await enrichReportsWithProfiles(
        initialBatch,
        relays,
        (current, total) => {
          setProgress(`Loading profiles... ${current}/${total}`);
        },
      );
      setDisplayedResults((prev) =>
        prev.map(
          (r) => enriched.find((e) => e.eventId === r.eventId) || r,
        ),
      );
      setProgress("");
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

  // Each results view is directly linkable — keep ?view= in sync on toggle.
  const handleViewChange = (view: ResultView) => {
    setResultView(view);
    const params = new URLSearchParams(window.location.search);
    if (targetPubkey) params.set("npub", hexToNpub(targetPubkey));
    if (view === "filed") params.set("view", "filed");
    else params.delete("view");
    params.delete("tab");
    window.history.replaceState(null, "", `/reportable?${params.toString()}`);
  };

  // Same for the main lookup/feed tabs.
  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    if (tab === "feed") params.set("tab", "feed");
    else params.delete("tab");
    window.history.replaceState(null, "", `/reportable?${params.toString()}`);
  };

  const handleLoadMore = async () => {
    if (loadingMore) return;

    if (resultView === "filed") {
      const currentCount = filedDisplayed.length;
      const nextBatch = filedResults.slice(
        currentCount,
        currentCount + LOAD_MORE_COUNT,
      );
      if (nextBatch.length === 0) return;

      setFiledDisplayed((prev) => [...prev, ...nextBatch]);
      setLoadingMore(true);
      try {
        const enriched = await enrichReportsFiledWithProfiles(
          nextBatch,
          relays,
          (current, total) => {
            setProgress(`Loading more profiles... ${current}/${total}`);
          },
        );
        setFiledDisplayed((prev) =>
          prev.map(
            (r) => enriched.find((e) => e.eventId === r.eventId) || r,
          ),
        );
        setProgress("");
      } catch (err) {
        console.error("Failed to load more:", err);
      } finally {
        setLoadingMore(false);
      }
      return;
    }

    const currentCount = displayedResults.length;
    const nextBatch = allResults.slice(
      currentCount,
      currentCount + LOAD_MORE_COUNT,
    );
    if (nextBatch.length === 0) return;

    // Append the raw batch right away, then patch profiles in.
    setDisplayedResults((prev) => [...prev, ...nextBatch]);
    setLoadingMore(true);
    try {
      const enriched = await enrichReportsWithProfiles(
        nextBatch,
        relays,
        (current, total) => {
          setProgress(`Loading more profiles... ${current}/${total}`);
        },
      );
      setDisplayedResults((prev) =>
        prev.map(
          (r) => enriched.find((e) => e.eventId === r.eventId) || r,
        ),
      );
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

  // Copy an arbitrary value (event ID, event JSON) with a per-key flash
  const handleCopyValue = async (value: string, key: string) => {
    const success = await copyToClipboard(value);
    if (success) {
      setCopiedValue(key);
      setTimeout(() => setCopiedValue(null), 2000);
    }
  };

  const handleReset = () => {
    window.history.replaceState(null, "", "/reportable");
    setSearchQuery("");
    setTargetPubkey(null);
    setTargetProfile(null);
    setAllResults([]);
    setDisplayedResults([]);
    setFiledResults([]);
    setFiledDisplayed([]);
    setFiledLoading(false);
    setFiledSearchDone(false);
    setResultView("received");
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

  const handleReportMyself = () => {
    if (!session?.pubkey) return;
    setTargetPubkey(session.pubkey);
    setSearchQuery(session.pubkey);
    handleSearch(session.pubkey);
  };

  const handleUserSelect = (profile: Profile) => {
    setSelectedProfile(profile);
  };

  const loadFeed = async (refresh = false) => {
    setFeedLoading(true);
    setFeedError(null);
    try {
      // Render raw entries immediately — profiles patch in below, so a slow
      // archive lookup can never blank the feed.
      const raw = await fetchRecentReportsFeed(relays, 100, 30);
      setFeedEntries(raw);
      setFeedLoaded(true);
      setFeedLoading(false);

      setFeedEnriching(true);
      const enriched = await enrichReportsFeedWithProfiles(raw, relays);
      setFeedEntries((prev) =>
        prev.map(
          (e) => enriched.find((n) => n.eventId === e.eventId) || e,
        ),
      );
    } catch (err) {
      console.error("Failed to load reports feed:", err);
      setFeedError(getErrorMessage(err, "Failed to load reports feed"));
    } finally {
      setFeedLoading(false);
      setFeedEnriching(false);
    }
  };

  useEffect(() => {
    if (activeTab === "feed" && !feedLoaded && !feedLoading) {
      loadFeed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const uniqueReporters = new Set(allResults.map((r) => r.reportedBy)).size;

  // Received reports judged automated: self-declared bots and coordinated
  // same-type empty-content swarms. They collapse behind a toggle and never
  // count toward the Report Score — automation is not independent judgment.
  const automatedReceivedIds = useMemo(
    () => findAutomatedReportIds(allResults),
    [allResults],
  );
  const humanResults = useMemo(
    () => allResults.filter((r) => !automatedReceivedIds.has(r.eventId)),
    [allResults, automatedReceivedIds],
  );
  const uniqueHumanReporters = new Set(
    humanResults.map((r) => r.reportedBy),
  ).size;
  const hiddenReceivedCount = allResults.length - humanResults.length;
  const visibleReceivedTotal = hideAutomatedReceived
    ? humanResults.length
    : allResults.length;
  const visibleUniqueReporters = hideAutomatedReceived
    ? uniqueHumanReporters
    : uniqueReporters;
  const visibleReceivedResults = hideAutomatedReceived
    ? displayedResults.filter((r) => !automatedReceivedIds.has(r.eventId))
    : displayedResults;

  // Report score breakdown by type for the active lookup view
  const activeForCounts =
    resultView === "received"
      ? hideAutomatedReceived
        ? humanResults
        : allResults
      : filedResults;
  const reportTypeCounts = activeForCounts.reduce<Record<string, number>>(
    (acc, r) => {
      const key = (r.reportType || "other").toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    {},
  );
  const filedUniqueTargets = new Set(
    filedResults.flatMap((r) => r.reportedPubkeys),
  ).size;

  // Load-more + counter helpers for whichever view is active
  const activeTotalCount = resultView === "received" ? allResults.length : filedResults.length;
  const activeShownCount = resultView === "received" ? displayedResults.length : filedDisplayed.length;

  // Reporters whose volume marks them as automated (anti-spam bots and
  // similar bulk reporters) — their entries bury every human report.
  const automatedReporterSet = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of feedEntries) {
      counts.set(entry.reportedBy, (counts.get(entry.reportedBy) ?? 0) + 1);
    }
    const automated = new Set<string>();
    for (const [reporter, count] of counts) {
      if (isAutomatedReporter(count, feedEntries.length)) {
        automated.add(reporter);
      }
    }
    return automated;
  }, [feedEntries]);

  // Feed entries whose content self-identifies as bot-generated collapse
  // behind the same toggle, even when the bot's in-feed volume is low —
  // its bulk is spread across targets and invisible to per-feed counting.
  const automatedFeedEventIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of feedEntries) {
      if (isAutomatedContent(entry.content)) ids.add(entry.eventId);
    }
    return ids;
  }, [feedEntries]);

  const visibleFeedEntries = hideAutomatedReporters
    ? feedEntries.filter(
        (e) =>
          !automatedReporterSet.has(e.reportedBy) &&
          !automatedFeedEventIds.has(e.eventId),
      )
    : feedEntries;
  const hiddenFeedCount = feedEntries.length - visibleFeedEntries.length;

  const targetNpub = targetPubkey ? hexToNpub(targetPubkey) : null;

  // Identity header for the results cards — mirrors Mute-o-Scope so a
  // screenshot of the header alone tells the whole story of who was
  // searched and with what tool.
  const targetIdentityHeader = targetPubkey ? (
    <div className="flex items-start justify-between gap-3 sm:gap-4 mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-4 min-w-0 flex-1">
        {targetProfile?.picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={targetProfile.picture}
            alt={getDisplayName(targetProfile, "Unknown profile")}
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover flex-shrink-0 ring-2 ring-gray-100 dark:ring-gray-600 bg-gray-100 dark:bg-gray-600"
            onError={(e) => {
              (e.target as HTMLImageElement).src =
                'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/%3E%3Cpath d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/%3E%3C/svg%3E';
            }}
          />
        ) : (
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
            <User size={32} className="text-gray-500 dark:text-gray-400" />
          </div>
        )}

        <div className="min-w-0">
          <h3 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white break-words line-clamp-2 leading-tight">
            {targetProfile
              ? getDisplayName(targetProfile, "Unknown profile")
              : "Unknown profile"}
          </h3>
          {targetProfile?.nip05 && (
            <p className="text-sm text-green-600 dark:text-green-400 mt-0.5 truncate">
              ✓ {targetProfile.nip05}
            </p>
          )}
          {targetNpub && (
            <button
              onClick={() => handleCopyNpub(targetNpub)}
              className="mt-1 inline-flex items-center gap-1.5 text-xs font-mono text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors min-w-0 max-w-full"
              title={copiedNpub === targetNpub ? "Copied!" : "Copy npub"}
            >
              <span className="truncate">
                {targetNpub.slice(0, 20)}…{targetNpub.slice(-8)}
              </span>
              {copiedNpub === targetNpub ? (
                <Check size={12} className="text-green-500 flex-shrink-0" />
              ) : (
                <Copy size={12} className="flex-shrink-0" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Brand lockup — plain wordmark styling (no chip container, so it
          doesn't read as a button), wordmark swaps for light/dark cards. */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-gray-700 dark:text-gray-200 whitespace-nowrap leading-none">
            Reportable
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400 dark:text-gray-500">by</span>
          <Image
            src="/mutable_logo.svg"
            alt="Mutable"
            width={18}
            height={18}
          />
          <Image
            src="/mutable_text_dark.svg"
            alt=""
            width={74}
            height={14}
            className="hidden sm:block dark:hidden"
          />
          <Image
            src="/mutable_text.svg"
            alt=""
            width={74}
            height={14}
            className="hidden sm:dark:block"
          />
        </div>
      </div>
    </div>
  ) : null;

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
                    src="/mutable_text_dark.svg"
                    alt="Mutable"
                    width={120}
                    height={24}
                    className="hidden sm:block dark:hidden"
                  />
                  <Image
                    src="/mutable_text.svg"
                    alt="Mutable"
                    width={120}
                    height={24}
                    className="hidden sm:dark:block"
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
                  src="/mutable_text_dark.svg"
                  alt="Mutable"
                  width={120}
                  height={24}
                  className="hidden sm:block dark:hidden"
                />
                <Image
                  src="/mutable_text.svg"
                  alt="Mutable"
                  width={120}
                  height={24}
                  className="hidden sm:dark:block"
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
                🚩 NIP-56 public reports · kind:1984
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
                onClick={() => handleTabChange("lookup")}
                className={`flex-1 px-6 py-4 text-sm font-semibold transition-colors border-b-2 ${
                  activeTab === "lookup"
                    ? "border-red-600 text-red-600 dark:border-red-500 dark:text-red-500"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                }`}
              >
                Look Up a User
              </button>
              <button
                onClick={() => handleTabChange("feed")}
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
                    {session && !searching && (
                      <button
                        onClick={handleReportMyself}
                        className="px-4 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg font-medium transition-colors flex items-center gap-2"
                        title="Check your own public report history"
                      >
                        <User size={20} />
                        <span className="hidden sm:inline">Check my Reports</span>
                      </button>
                    )}
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

              {/* Zero reports (clean) — waits on the filed scan too, so a
                  user with no received reports but filed ones gets the
                  toggle instead of a bare "clean" card. */}
              {!searching &&
                searchCompleted &&
                allResults.length === 0 &&
                filedResults.length === 0 &&
                !filedLoading &&
                targetPubkey &&
                !error && (
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                    {targetIdentityHeader}
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

              {(displayedResults.length > 0 || filedDisplayed.length > 0) && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                  {targetIdentityHeader}

                  {/* Received vs Filed — primary tabs, full width, each
                      view directly linkable via ?view= */}
                  <div className="grid grid-cols-2 gap-2 p-2 bg-gray-100 dark:bg-gray-700/50 rounded-xl mb-5">
                    <button
                      onClick={() => handleViewChange("received")}
                      className={`flex items-center justify-center gap-2.5 px-5 py-3 rounded-lg text-base font-bold transition-colors ${
                        resultView === "received"
                          ? "bg-white dark:bg-gray-800 text-red-600 dark:text-red-400 shadow-sm"
                          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/40"
                      }`}
                    >
                      <Flag size={18} />
                      Received
                      <span
                        className={`min-w-[1.75rem] text-center px-2 py-0.5 rounded-full text-sm font-bold ${
                          resultView === "received"
                            ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
                            : "bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300"
                        }`}
                      >
                        {allResults.length}
                      </span>
                    </button>
                    <button
                      onClick={() => handleViewChange("filed")}
                      className={`flex items-center justify-center gap-2.5 px-5 py-3 rounded-lg text-base font-bold transition-colors ${
                        resultView === "filed"
                          ? "bg-white dark:bg-gray-800 text-red-600 dark:text-red-400 shadow-sm"
                          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/40"
                      }`}
                    >
                      <Send size={18} />
                      Filed
                      <span
                        className={`min-w-[1.75rem] text-center px-2 py-0.5 rounded-full text-sm font-bold ${
                          resultView === "filed"
                            ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
                            : "bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300"
                        }`}
                      >
                        {filedLoading ? "…" : filedResults.length}
                      </span>
                    </button>
                  </div>

                  {resultView === "received" && (
                  <>
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                      Found {visibleReceivedTotal} Public Report
                      {visibleReceivedTotal === 1 ? "" : "s"} from {visibleUniqueReporters} Unique
                      Reporter{visibleUniqueReporters === 1 ? "" : "s"}
                    </h3>

                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <button
                        onClick={() => setShowReportScoreModal(true)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                        title="Click to view all Report Score levels"
                      >
                        <span className="text-2xl">
                          {getReportScore(uniqueHumanReporters).emoji}
                        </span>
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                          Report Score: {getReportScore(uniqueHumanReporters).label}
                          {hiddenReceivedCount > 0 && (
                            <span className="font-normal text-gray-500 dark:text-gray-400">
                              {" "}
                              ({hiddenReceivedCount} automated hidden)
                            </span>
                          )}
                        </span>
                        <Info size={16} className="text-gray-500 dark:text-gray-400" />
                      </button>

                      {visibleReceivedResults.length < visibleReceivedTotal && (
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Showing {visibleReceivedResults.length} of {visibleReceivedTotal}
                        </p>
                      )}
                      {targetProfile && (
                        <button
                          onClick={() => setShowShareModal(true)}
                          className="inline-flex items-center gap-2 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                          title="Share these results on Nostr"
                        >
                          <Share2 size={16} />
                          Share
                        </button>
                      )}
                    </div>

                    {/* Automated-report filter — bots and coordinated swarms
                        never count toward the score; collapse behind this. */}
                    {hiddenReceivedCount > 0 && (
                      <button
                        onClick={() =>
                          setHideAutomatedReceived((prev) => !prev)
                        }
                        className={`w-full mt-3 p-3 rounded-lg border text-sm font-medium transition-colors text-left flex items-center gap-2 ${
                          hideAutomatedReceived
                            ? "bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                            : "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 hover:bg-yellow-100 dark:hover:bg-yellow-900/30"
                        }`}
                      >
                        <Bot size={16} className="flex-shrink-0" />
                        {hideAutomatedReceived ? (
                          <span>
                            {hiddenReceivedCount} automated report
                            {hiddenReceivedCount === 1 ? "" : "s"} (bots and
                            swarms) hidden — excluded from score — click to
                            show
                          </span>
                        ) : (
                          <span>
                            Showing automated reports — they do not affect the
                            score — click to hide
                          </span>
                        )}
                      </button>
                    )}

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
                    {allResults.length === 0 && (
                      <div className="text-center p-6">
                        <Flag className="mx-auto mb-3 text-green-500" size={40} />
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          No one has publicly reported this user on the scanned
                          relays.
                        </p>
                      </div>
                    )}
                    {visibleReceivedResults.map((report) => {
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
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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

                            <div className="flex flex-wrap items-center justify-end gap-3">
                              <button
                                onClick={() => setDetailReport(report)}
                                className="inline-flex items-center gap-1.5 h-10 px-3 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                                title="View the full report"
                              >
                                <FileText size={16} />
                                Full report
                              </button>
                              <div className="flex items-center gap-1 h-10 p-0.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/40">
                                <span className="pl-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                                  Evidence
                                </span>
                                <button
                                  onClick={() => handleCopyNpub(npub)}
                                  className={`p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors ${
                                    copiedNpub === npub
                                      ? "text-green-600 dark:text-green-400"
                                      : "text-gray-600 dark:text-gray-400"
                                  }`}
                                  title={copiedNpub === npub ? "Copied!" : "Copy npub"}
                                >
                                  <Fingerprint size={16} />
                                </button>
                                <button
                                  onClick={() =>
                                    handleCopyValue(report.eventId, `id:${report.eventId}`)
                                  }
                                  className={`p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors ${
                                    copiedValue === `id:${report.eventId}`
                                      ? "text-green-600 dark:text-green-400"
                                      : "text-gray-600 dark:text-gray-400"
                                  }`}
                                  title={
                                    copiedValue === `id:${report.eventId}`
                                      ? "Copied!"
                                      : "Copy event ID"
                                  }
                                >
                                  {copiedValue === `id:${report.eventId}` ? (
                                    <Check size={16} />
                                  ) : (
                                    <Copy size={16} />
                                  )}
                                </button>
                                {report.rawEvent && (
                                  <button
                                    onClick={() =>
                                      handleCopyValue(
                                        JSON.stringify(report.rawEvent, null, 2),
                                        `json:${report.eventId}`,
                                      )
                                    }
                                    className={`p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors ${
                                      copiedValue === `json:${report.eventId}`
                                        ? "text-green-600 dark:text-green-400"
                                        : "text-gray-600 dark:text-gray-400"
                                    }`}
                                    title={
                                      copiedValue === `json:${report.eventId}`
                                        ? "Copied!"
                                        : "Copy event JSON"
                                    }
                                  >
                                    {copiedValue === `json:${report.eventId}` ? (
                                      <Check size={16} />
                                    ) : (
                                      <FileJson size={16} />
                                    )}
                                  </button>
                                )}
                                <a
                                  href={getReportEventLink(report.eventId)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                                  title="View report on njump"
                                >
                                  <ExternalLink size={16} />
                                </a>
                              </div>
                            </div>
                          </div>

                          {report.content && (
                            <p className="mt-2 pl-[52px] text-sm text-gray-600 dark:text-gray-400 italic break-words">
                              &ldquo;{report.content}&rdquo;
                            </p>
                          )}
                        </div>
                      );
                    })}
                    </div>
                  </>
                  )}

                  {/* Filed-by view — reports this user submitted */}
                  {resultView === "filed" && (
                  <>
                    <div className="mb-4">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                        Filed {filedResults.length} Public Report
                        {filedResults.length === 1 ? "" : "s"} against{" "}
                        {filedUniqueTargets} Unique Target
                        {filedUniqueTargets === 1 ? "" : "s"}
                      </h3>

                      {filedResults.length > filedDisplayed.length && (
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Showing {filedDisplayed.length} of {filedResults.length}
                        </p>
                      )}

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
                      {filedLoading && filedDisplayed.length === 0 && (
                        <div className="flex items-center justify-center gap-3 p-6 text-gray-500 dark:text-gray-400">
                          <Loader2 size={18} className="animate-spin" />
                          Searching for reports this user has filed...
                        </div>
                      )}
                      {!filedLoading && filedDisplayed.length === 0 && (
                        <div className="text-center p-6">
                          <Flag className="mx-auto mb-3 text-green-500" size={40} />
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            This user has not publicly reported anyone on the
                            scanned relays.
                          </p>
                        </div>
                      )}
                      {filedDisplayed.map((entry) => (
                        <div
                          key={entry.eventId}
                          className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            {/* Target chips — one per reported pubkey.
                                Bulk-report events can name dozens, so cap
                                the row at five plus a "+N more" count. */}
                            <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                              {entry.reportedPubkeys
                                .slice(0, 5)
                                .map((pk, idx) => {
                                  const profile = entry.targetProfiles?.[idx];
                                  const displayName = profile
                                    ? getDisplayName(profile)
                                    : "Loading profile...";
                                  return (
                                    <button
                                      key={pk}
                                      onClick={() =>
                                        setSelectedProfile(
                                          profile || { pubkey: pk },
                                        )
                                      }
                                      className="flex items-center gap-2 pl-1 pr-2.5 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full hover:border-red-300 dark:hover:border-red-500 transition-colors min-w-0"
                                      title={profile?.nip05 || hexToNpub(pk)}
                                    >
                                      {profile?.picture ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          src={profile.picture}
                                          alt={displayName}
                                          className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                                        />
                                      ) : (
                                        <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
                                          {profile ? (
                                            <User
                                              size={14}
                                              className="text-gray-500 dark:text-gray-300"
                                            />
                                          ) : (
                                            <Loader2
                                              size={14}
                                              className="text-gray-500 dark:text-gray-300 animate-spin"
                                            />
                                          )}
                                        </div>
                                      )}
                                      <span
                                        className={`text-sm font-medium truncate max-w-[180px] ${
                                          profile
                                            ? "text-gray-900 dark:text-white"
                                            : "text-gray-500 dark:text-gray-400 italic"
                                        }`}
                                      >
                                        {displayName}
                                      </span>
                                    </button>
                                  );
                                })}
                              {entry.reportedPubkeys.length > 5 && (
                                <span className="text-sm text-gray-500 dark:text-gray-400">
                                  +{entry.reportedPubkeys.length - 5} more
                                </span>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-3">
                              <button
                                onClick={() => setDetailReport(entry)}
                                className="inline-flex items-center gap-1.5 h-10 px-3 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                                title="View the full report"
                              >
                                <FileText size={16} />
                                Full report
                              </button>
                              <div className="flex items-center gap-1 h-10 p-0.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/40">
                                <span className="pl-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                                  Evidence
                                </span>
                                <button
                                  onClick={() =>
                                    handleCopyValue(entry.eventId, `id:${entry.eventId}`)
                                  }
                                  className={`p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors ${
                                    copiedValue === `id:${entry.eventId}`
                                      ? "text-green-600 dark:text-green-400"
                                      : "text-gray-600 dark:text-gray-400"
                                  }`}
                                  title={
                                    copiedValue === `id:${entry.eventId}`
                                      ? "Copied!"
                                      : "Copy event ID"
                                  }
                                >
                                  {copiedValue === `id:${entry.eventId}` ? (
                                    <Check size={16} />
                                  ) : (
                                    <Copy size={16} />
                                  )}
                                </button>
                                {entry.rawEvent && (
                                  <button
                                    onClick={() =>
                                      handleCopyValue(
                                        JSON.stringify(entry.rawEvent, null, 2),
                                        `json:${entry.eventId}`,
                                      )
                                    }
                                    className={`p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors ${
                                      copiedValue === `json:${entry.eventId}`
                                        ? "text-green-600 dark:text-green-400"
                                        : "text-gray-600 dark:text-gray-400"
                                    }`}
                                    title={
                                      copiedValue === `json:${entry.eventId}`
                                        ? "Copied!"
                                        : "Copy event JSON"
                                    }
                                  >
                                    {copiedValue === `json:${entry.eventId}` ? (
                                      <Check size={16} />
                                    ) : (
                                      <FileJson size={16} />
                                    )}
                                  </button>
                                )}
                                <a
                                  href={getReportEventLink(entry.eventId)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                                  title="View report event on njump"
                                >
                                  <ExternalLink size={16} />
                                </a>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                            <ReportTypeBadge type={entry.reportType} />
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              Filed {formatRelativeDate(entry.reportedAt)}
                            </span>
                          </div>

                          {entry.content && (
                            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 italic break-words">
                              &ldquo;{entry.content}&rdquo;
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                  )}

                  {/* Shared load-more — counts track the active view */}
                  {activeTotalCount > activeShownCount && (
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
                            {activeTotalCount - activeShownCount} remaining
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

              {/* Automated-reporter filter — bulk reporters bury human
                  reports, so their entries collapse behind this toggle. */}
              {automatedReporterSet.size > 0 && (
                <button
                  onClick={() =>
                    setHideAutomatedReporters((prev) => !prev)
                  }
                  className={`w-full mb-4 p-3 rounded-lg border text-sm font-medium transition-colors text-left flex items-center gap-2 ${
                    hideAutomatedReporters
                      ? "bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      : "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 hover:bg-yellow-100 dark:hover:bg-yellow-900/30"
                  }`}
                >
                  <Bot size={16} className="flex-shrink-0" />
                  {hideAutomatedReporters ? (
                    <span>
                      {hiddenFeedCount} automated report
                      {hiddenFeedCount === 1 ? "" : "s"} from{" "}
                      {automatedReporterSet.size} bulk reporter
                      {automatedReporterSet.size === 1 ? "" : "s"} hidden —
                      click to show
                    </span>
                  ) : (
                    <span>
                      Showing automated reports — click to hide
                    </span>
                  )}
                </button>
              )}

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

              {!feedLoading && feedLoaded && visibleFeedEntries.length === 0 && !feedError && (
                <div className="text-center p-8">
                  <Flag className="mx-auto mb-3 text-green-500" size={48} />
                  <p className="text-gray-600 dark:text-gray-400">
                    No recent reports found on the scanned relays.
                  </p>
                </div>
              )}

              {feedEnriching && (
                <div className="flex items-center justify-center gap-2 py-2 text-sm text-gray-500 dark:text-gray-400">
                  <Loader2 size={14} className="animate-spin" />
                  Loading profiles…
                </div>
              )}

              <div className="space-y-3">
                {visibleFeedEntries.map((entry) => {
                  const reporterName = entry.reporterProfile
                    ? getDisplayName(entry.reporterProfile)
                    : `${entry.reportedBy.substring(0, 8)}...`;

                  return (
                    <div
                      key={entry.eventId}
                      className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="flex items-center gap-2 flex-wrap text-sm min-w-0">
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
                          <span className="text-gray-500 dark:text-gray-400">
                            reported
                          </span>
                          {/* Target chips — clickable, capped like the filed
                              view since bulk events can name dozens. */}
                          {entry.reportedPubkeys.slice(0, 5).map((pk, idx) => {
                            const profile = entry.targetProfiles?.[idx];
                            const displayName = profile
                              ? getDisplayName(profile)
                              : `${pk.substring(0, 8)}...`;
                            return (
                              <button
                                key={pk}
                                onClick={() =>
                                  setSelectedProfile(profile || { pubkey: pk })
                                }
                                className="flex items-center gap-2 pl-1 pr-2.5 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full hover:border-red-300 dark:hover:border-red-500 transition-colors min-w-0"
                                title={profile?.nip05 || hexToNpub(pk)}
                              >
                                {profile?.picture ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={profile.picture}
                                    alt={displayName}
                                    className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                                  />
                                ) : (
                                  <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
                                    <User
                                      size={14}
                                      className="text-gray-500 dark:text-gray-300"
                                    />
                                  </div>
                                )}
                                <span className="font-medium text-gray-900 dark:text-white truncate max-w-[160px]">
                                  {displayName}
                                </span>
                              </button>
                            );
                          })}
                          {entry.reportedPubkeys.length > 5 && (
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                              +{entry.reportedPubkeys.length - 5} more
                            </span>
                          )}
                          <ReportTypeBadge type={entry.reportType} />
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-3">
                          <button
                            onClick={() => setDetailReport(entry)}
                            className="inline-flex items-center gap-1.5 h-10 px-3 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                            title="View the full report"
                          >
                            <FileText size={16} />
                            Full report
                          </button>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {formatRelativeDate(entry.reportedAt)}
                          </span>
                          <div className="flex items-center gap-1 h-10 p-0.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/40">
                            <span className="pl-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                              Evidence
                            </span>
                            <button
                              onClick={() =>
                                handleCopyValue(entry.eventId, `id:${entry.eventId}`)
                              }
                              className={`p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors ${
                                copiedValue === `id:${entry.eventId}`
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-gray-600 dark:text-gray-400"
                              }`}
                              title={
                                copiedValue === `id:${entry.eventId}`
                                  ? "Copied!"
                                  : "Copy event ID"
                              }
                            >
                              {copiedValue === `id:${entry.eventId}` ? (
                                <Check size={16} />
                              ) : (
                                <Copy size={16} />
                              )}
                            </button>
                            {entry.rawEvent && (
                              <button
                                onClick={() =>
                                  handleCopyValue(
                                    JSON.stringify(entry.rawEvent, null, 2),
                                    `json:${entry.eventId}`,
                                  )
                                }
                                className={`p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors ${
                                  copiedValue === `json:${entry.eventId}`
                                    ? "text-green-600 dark:text-green-400"
                                    : "text-gray-600 dark:text-gray-400"
                                }`}
                                title={
                                  copiedValue === `json:${entry.eventId}`
                                    ? "Copied!"
                                    : "Copy event JSON"
                                }
                              >
                                {copiedValue === `json:${entry.eventId}` ? (
                                  <Check size={16} />
                                ) : (
                                  <FileJson size={16} />
                                )}
                              </button>
                            )}
                            <a
                              href={getReportEventLink(entry.eventId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                              title="View report event on njump"
                            >
                              <ExternalLink size={16} />
                            </a>
                          </div>
                        </div>
                      </div>
                      {entry.content && (
                        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 italic break-words">
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

          {detailReport && (
            <ReportDetailModal
              report={detailReport}
              onClose={() => setDetailReport(null)}
            />
          )}

          {showShareModal && targetProfile && (
            <ReportableShareModal
              targetProfile={targetProfile}
              resultCount={humanResults.length}
              uniqueReporterCount={uniqueHumanReporters}
              filedCount={filedResults.length}
              onClose={() => setShowShareModal(false)}
            />
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}
