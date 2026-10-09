"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  Loader2,
  LockKeyhole,
  Medal,
  Plus,
  RefreshCw,
  PackageSearch,
  Share2,
  Search,
  User,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { hexToNpub } from "@/lib/nostr";
import { getDisplayName, getErrorMessage, truncateNpub } from "@/lib/utils/format";
import {
  FollowPack,
  matchPacks,
  packAddress,
  parsePackReference,
  referencePath,
  resolvePubkey,
} from "@/lib/draftable/pack";
import {
  draftableRelays,
  fetchAllPacks,
  fetchFollowing,
  fetchPacks,
} from "@/lib/draftable/service";
import { draftedShareMessage } from "@/lib/draftable/share";
import ProfileAvatar from "../ProfileAvatar";
import UserSearchInput from "../UserSearchInput";
import { useRequestSignIn } from "./DraftableShell";
import { NoExitIntro } from "./NoExit";
import PackCard, { PackGridSkeleton, PREVIEW_MEMBERS } from "./PackCard";
import ShareModal from "./ShareModal";
import { useProfiles } from "./useProfiles";

type View = "all" | "follows" | "drafted" | "mine";

const VIEWS: View[] = ["all", "follows", "drafted", "mine"];
const SIGNED_IN_VIEWS: View[] = ["follows", "drafted", "mine"];
const VIEW_STORAGE_KEY = "draftable-view";
// The grid runs 1, 2, or 3 columns; any multiple of 6 fills every row.
const ROW_MULTIPLE = 6;
// Search results shown per "Show more", a multiple of ROW_MULTIPLE.
const SEARCH_PAGE = 24;
const SEARCH_MIN_CHARS = 2;

function viewLabel(view: View, lookupName: string | null): string {
  if (lookupName) {
    return view === "mine" ? `Packs ${lookupName} made` : "Drafted into";
  }
  switch (view) {
    case "all":
      return "All packs";
    case "follows":
      return "From people I follow";
    case "drafted":
      return "Packs I've been drafted into";
    case "mine":
      return "Packs I made";
  }
}

export default function Draftable() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session } = useAuth();
  const requestSignIn = useRequestSignIn();

  const npubParam = searchParams.get("npub");
  const viewParam = searchParams.get("view") as View | null;
  const paramPubkey = resolvePubkey(npubParam);
  // Looking someone else up swaps "me" for them; looking yourself up is
  // just the signed-in views.
  const lookupPubkey =
    paramPubkey && paramPubkey !== session?.pubkey ? paramPubkey : null;
  const subjectPubkey = lookupPubkey ?? session?.pubkey ?? null;

  const [view, setView] = useState<View>(() => {
    if (viewParam && VIEWS.includes(viewParam)) return viewParam;
    return paramPubkey ? "drafted" : "all";
  });
  const [packs, setPacks] = useState<FollowPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  // Pack search: what's typed, and the debounced term that's searched.
  const [searchInput, setSearchInput] = useState(
    () => searchParams.get("q") ?? "",
  );
  const [searchTerm, setSearchTerm] = useState(() =>
    (searchParams.get("q") ?? "").trim(),
  );
  const [allPacks, setAllPacks] = useState<FollowPack[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchShown, setSearchShown] = useState(SEARCH_PAGE);
  const requestId = useRef(0);
  const followsCache = useRef<{ pubkey: string; follows: string[] } | null>(
    null,
  );

  const relays = useMemo(
    () => draftableRelays(session?.relays),
    [session?.relays],
  );

  // Restore the last view picked on this device (signed-in, no explicit URL).
  useEffect(() => {
    if (viewParam || paramPubkey) return;
    try {
      const stored = localStorage.getItem(VIEW_STORAGE_KEY) as View | null;
      if (stored && VIEWS.includes(stored)) setView(stored);
    } catch {
      // storage unavailable — keep the default
    }
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow in-app links that change ?view= while this page stays mounted.
  useEffect(() => {
    if (viewParam && VIEWS.includes(viewParam)) setView(viewParam);
  }, [viewParam]);

  // A pasted link or naddr opens a pack; anything else searches by name.
  const pastedRef = parsePackReference(searchInput);
  const searchActive =
    !parsePackReference(searchTerm) && searchTerm.length >= SEARCH_MIN_CHARS;

  // Debounce typing, and keep the term in ?q= so Back returns to results.
  useEffect(() => {
    const timer = setTimeout(() => {
      const term = searchInput.trim();
      setSearchTerm(term);
      setSearchShown(SEARCH_PAGE);
      const url = new URL(window.location.href);
      if (term && !parsePackReference(term)) url.searchParams.set("q", term);
      else url.searchParams.delete("q");
      if (url.href !== window.location.href) {
        window.history.replaceState(window.history.state, "", url);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Switching views or looking someone up ends a search.
  const navKey = `${npubParam ?? ""}|${viewParam ?? ""}`;
  const lastNavKey = useRef(navKey);
  useEffect(() => {
    if (lastNavKey.current === navKey) return;
    lastNavKey.current = navKey;
    setSearchInput("");
  }, [navKey]);

  useEffect(() => {
    if (!searchActive) return;
    let cancelled = false;
    setSearching(true);
    setSearchError(null);
    fetchAllPacks(relays)
      .then((result) => {
        if (!cancelled) setAllPacks(result);
      })
      .catch((err) => {
        if (!cancelled) setSearchError(getErrorMessage(err, "Search failed"));
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [searchActive, relays]);

  const searchResults = useMemo(
    () => (searchActive && allPacks ? matchPacks(allPacks, searchTerm) : []),
    [searchActive, allPacks, searchTerm],
  );

  // In lookup mode only "drafted into" and "made by" make sense.
  const effectiveView: View =
    lookupPubkey && (view === "all" || view === "follows") ? "drafted" : view;
  const needsSignIn =
    !subjectPubkey && SIGNED_IN_VIEWS.includes(effectiveView);

  const runQuery = useCallback(
    async (until?: number) => {
      if (effectiveView === "all") return fetchPacks({ until }, relays);
      if (!subjectPubkey) return { packs: [], hasMore: false };
      if (effectiveView === "drafted") {
        return fetchPacks({ drafted: subjectPubkey, until }, relays);
      }
      if (effectiveView === "mine") {
        return fetchPacks({ authors: [subjectPubkey], until }, relays);
      }
      // follows
      if (followsCache.current?.pubkey !== subjectPubkey) {
        const following = await fetchFollowing(
          subjectPubkey,
          session?.relays ?? relays,
        );
        followsCache.current = {
          pubkey: subjectPubkey,
          follows: following ? Array.from(following) : [],
        };
      }
      return fetchPacks(
        { authors: followsCache.current.follows, until },
        relays,
      );
    },
    [effectiveView, subjectPubkey, relays, session?.relays],
  );

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setPacks([]);
    setError(null);
    setHasMore(false);
    if (needsSignIn) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await runQuery();
      if (id !== requestId.current) return;
      setPacks(result.packs);
      setHasMore(result.hasMore);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(getErrorMessage(err, "Failed to load follow packs"));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [runQuery, needsSignIn]);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = async () => {
    if (loadingMore || packs.length === 0) return;
    const id = requestId.current;
    setLoadingMore(true);
    try {
      const until = packs[packs.length - 1].createdAt;
      const result = await runQuery(until);
      if (id !== requestId.current) return;
      // `until` is inclusive, so a page can repeat what's shown; stop paging
      // once nothing new comes back.
      const seen = new Set(packs.map(packAddress));
      const fresh = result.packs.filter((p) => !seen.has(packAddress(p)));
      setPacks([...packs, ...fresh]);
      setHasMore(result.hasMore && fresh.length > 0);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load more packs"));
    } finally {
      setLoadingMore(false);
    }
  };

  const selectView = (next: View) => {
    setSearchInput("");
    setView(next);
    if (!lookupPubkey) {
      try {
        localStorage.setItem(VIEW_STORAGE_KEY, next);
      } catch {
        // ignore
      }
    }
    const params = new URLSearchParams();
    if (npubParam) params.set("npub", npubParam);
    params.set("view", next);
    router.replace(`/draftable?${params.toString()}`, { scroll: false });
  };

  // While more pages remain, hold back the leftovers so the last row is
  // full. They're still loaded and lead the next page.
  const visiblePacks =
    hasMore && packs.length > ROW_MULTIPLE
      ? packs.slice(0, packs.length - (packs.length % ROW_MULTIPLE))
      : packs;
  const shownResults = searchResults.slice(0, searchShown);
  const displayedPacks = searchActive ? shownResults : visiblePacks;

  const profilePubkeys = useMemo(() => {
    const set = new Set<string>();
    if (lookupPubkey) set.add(lookupPubkey);
    for (const pack of displayedPacks) {
      set.add(pack.author);
      pack.members.slice(0, PREVIEW_MEMBERS).forEach((m) => set.add(m.pubkey));
    }
    return Array.from(set);
  }, [displayedPacks, lookupPubkey]);
  const profiles = useProfiles(profilePubkeys, relays);

  const lookupProfile = lookupPubkey ? profiles.get(lookupPubkey) : undefined;
  const lookupName = lookupPubkey
    ? getDisplayName(lookupProfile, truncateNpub(lookupPubkey, 12, 4))
    : null;

  const availableViews: View[] = lookupPubkey ? ["drafted", "mine"] : VIEWS;

  const openPastedPack = () => {
    if (pastedRef) router.push(referencePath(pastedRef));
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="flex items-start gap-4 flex-1">
            <div className="flex-shrink-0 mt-1 w-10 h-10 rounded-lg bg-[#4b5320] flex items-center justify-center">
              <Medal className="text-white" size={22} />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                Draftable
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                Nostr follow packs: curated lists of people you can follow in
                one click. Browse them, make your own, and see which ones
                you&apos;ve been drafted into.
              </p>
            </div>
          </div>
          <button
            onClick={() =>
              session ? router.push("/draftable/create") : requestSignIn()
            }
            className="flex-shrink-0 px-4 py-2 bg-[#4b5320] text-white rounded-lg hover:bg-[#3c4419] transition-colors font-medium flex items-center justify-center gap-2"
          >
            <Plus size={18} />
            Draft a new pack
          </button>
        </div>

        <div className="mt-5">
          <NoExitIntro />
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              <Search size={14} />
              See which packs someone has been drafted into
            </label>
            <UserSearchInput
              placeholder="Name, NIP-05, or npub"
              showFollowerCount
              onSelect={(profile) =>
                router.push(
                  `/draftable?npub=${encodeURIComponent(hexToNpub(profile.pubkey))}&view=drafted`,
                )
              }
            />
          </div>
          <div>
            <label
              htmlFor="pack-search"
              className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
            >
              <PackageSearch size={14} />
              Find a pack
            </label>
            <div className="relative">
              <input
                id="pack-search"
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openPastedPack();
                  if (e.key === "Escape") setSearchInput("");
                }}
                placeholder="Search by name, or paste a link or naddr"
                className="w-full pl-10 pr-9 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-900 dark:text-white"
              />
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                size={16}
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  aria-label="Clear search"
                >
                  <X size={16} />
                </button>
              )}
            </div>
            {pastedRef && (
              <button
                type="button"
                onClick={openPastedPack}
                className="mt-1.5 text-xs font-medium text-[#4b5320] dark:text-[#b9cc7f] hover:underline"
              >
                Open this pack (or press Enter)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Lookup subject */}
      {lookupPubkey && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 flex flex-wrap items-center gap-3">
          <ProfileAvatar
            src={lookupProfile?.picture}
            name={lookupName ?? undefined}
            size="lg"
          />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 dark:text-white truncate">
              {lookupName}
            </p>
            {lookupProfile?.nip05 && (
              <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                {lookupProfile.nip05}
              </p>
            )}
            <p className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate">
              {truncateNpub(lookupPubkey, 16, 8)}
            </p>
          </div>
          <div className="flex gap-2">
            {session && (
              <Link
                href="/draftable?view=drafted"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#4b5320] text-white rounded-lg text-xs font-medium hover:bg-[#3c4419] transition-colors"
              >
                <User size={12} />
                Look up yourself
              </Link>
            )}
            <Link
              href="/draftable?view=all"
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Clear
            </Link>
          </div>
        </div>
      )}

      {/* View tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {availableViews.map((option) => (
          <button
            key={option}
            onClick={() => selectView(option)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              effectiveView === option
                ? "bg-[#4b5320] text-white"
                : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
          >
            {viewLabel(option, lookupName)}
          </button>
        ))}
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto p-2 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Drafted-into summary: the point of the whole tool */}
      {!searchActive &&
        effectiveView === "drafted" &&
        !loading &&
        packs.length > 0 && (
          <div className="flex items-start gap-3 p-4 rounded-lg border-2 border-[#4b5320] bg-[#f0f0dc] dark:bg-[#4b5320]/25">
            <LockKeyhole
              size={20}
              className="text-[#4b5320] dark:text-[#c8d18e] flex-shrink-0 mt-0.5"
            />
            <p className="flex-1 text-sm text-[#33391a] dark:text-[#e6ead0]">
              <span className="font-bold">
                {lookupName ? `${lookupName} has` : "You've"} been drafted into{" "}
                {packs.length}
                {hasMore ? "+" : ""} {packs.length === 1 ? "pack" : "packs"}
                {lookupName ? "" : " so far"}.
              </span>{" "}
              {lookupName ? "They" : "You"} can&apos;t leave any of them. Only
              each pack&apos;s author can take {lookupName ? "them" : "you"}{" "}
              out.
            </p>
            <button
              onClick={() => setShareOpen(true)}
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#4b5320] text-white rounded-lg text-xs font-medium hover:bg-[#3c4419] transition-colors"
            >
              <Share2 size={12} />
              Share
            </button>
          </div>
        )}

      {/* Results */}
      {searchActive ? (
        searchError ? (
          <div className="flex items-center gap-2 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
            <AlertCircle size={16} />
            {searchError}
          </div>
        ) : !allPacks ? (
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <Loader2 size={14} className="animate-spin" />
              Gathering every follow pack from {relays.length} relays. Only the
              first search takes a moment.
            </p>
            <PackGridSkeleton />
          </div>
        ) : searchResults.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-600 dark:text-gray-400">
            No packs match &ldquo;{searchTerm}&rdquo;. Searched the names and
            descriptions of {allPacks.length} packs.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
              <span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {searchResults.length}
                </span>{" "}
                {searchResults.length === 1 ? "pack matches" : "packs match"}{" "}
                &ldquo;{searchTerm}&rdquo;, out of {allPacks.length}
              </span>
              {searching && <Loader2 size={14} className="animate-spin" />}
              <button
                onClick={() => setSearchInput("")}
                className="font-medium text-[#4b5320] dark:text-[#b9cc7f] hover:underline"
              >
                Clear search
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {shownResults.map((pack) => (
                <PackCard
                  key={packAddress(pack)}
                  pack={pack}
                  profiles={profiles}
                  viewerPubkey={session?.pubkey}
                />
              ))}
            </div>
            {searchResults.length > searchShown && (
              <div className="text-center">
                <button
                  onClick={() => setSearchShown((n) => n + SEARCH_PAGE)}
                  className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  Show more ({searchResults.length - searchShown} left)
                </button>
              </div>
            )}
          </>
        )
      ) : needsSignIn ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Connect with Nostr to see{" "}
            {effectiveView === "drafted"
              ? "the packs you've been drafted into"
              : effectiveView === "mine"
                ? "the packs you made"
                : "packs from people you follow"}
            .
          </p>
          <button
            onClick={requestSignIn}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
          >
            Connect with Nostr
          </button>
        </div>
      ) : loading ? (
        <PackGridSkeleton />
      ) : error ? (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      ) : packs.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-600 dark:text-gray-400">
          {effectiveView === "drafted"
            ? `No packs found with ${lookupName ?? "you"} in ${lookupName ? "them" : "them, yet"}. Anyone can draft ${lookupName ? "them" : "you"} at any time, without asking.`
            : effectiveView === "mine"
              ? lookupName
                ? `${lookupName} hasn't made any follow packs.`
                : "You haven't drafted anyone yet."
              : effectiveView === "follows"
                ? "Nobody you follow has made a follow pack."
                : "No follow packs found."}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {visiblePacks.map((pack) => (
              <PackCard
                key={packAddress(pack)}
                pack={pack}
                profiles={profiles}
                viewerPubkey={session?.pubkey}
              />
            ))}
          </div>
          {hasMore && (
            <div className="text-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {loadingMore && <Loader2 size={14} className="animate-spin" />}
                {loadingMore ? "Loading..." : "Discover more"}
              </button>
            </div>
          )}
        </>
      )}

      {shareOpen && subjectPubkey && (
        <ShareModal
          title={
            lookupName
              ? `Share ${lookupName}'s draft record`
              : "Share your draft record"
          }
          subtitle={
            lookupName
              ? "Let them know where they've been drafted."
              : "Let people know where you've been drafted."
          }
          message={draftedShareMessage({
            pubkey: subjectPubkey,
            name: lookupName ?? "",
            self: !lookupPubkey,
            count: packs.length,
            more: hasMore,
          })}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
