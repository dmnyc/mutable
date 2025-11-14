'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { RefreshCw, Search, Users, User, Copy, ExternalLink, AlertCircle, Loader2, Lock, LogOut, X, Share } from 'lucide-react';
import { MutealResult, Profile } from '@/types';
import UserProfileModal from './UserProfileModal';
import ShareResultsModal from './ShareResultsModal';
import GlobalUserSearch from './GlobalUserSearch';
import Footer from './Footer';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import {
  searchMutealsNetworkWide,
  enrichMutealsWithProfiles,
  hexToNpub,
  npubToHex,
  searchProfiles,
  getExpandedRelayList,
  fetchProfile
} from '@/lib/nostr';

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.wine',
  'wss://relay.snort.social'
];

const INITIAL_LOAD_COUNT = 20;
const LOAD_MORE_COUNT = 20;

export default function MuteOScope() {
  const searchParams = useSearchParams();
  const { session, disconnect } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [targetPubkey, setTargetPubkey] = useState<string | null>(null);
  const [targetProfile, setTargetProfile] = useState<Profile | null>(null);
  const [searching, setSearching] = useState(false);
  const [allResults, setAllResults] = useState<MutealResult[]>([]); // All search results
  const [displayedResults, setDisplayedResults] = useState<MutealResult[]>([]); // Currently displayed results
  const [displayCount, setDisplayCount] = useState(INITIAL_LOAD_COUNT);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [copiedNpub, setCopiedNpub] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [userProfile, setUserProfile] = useState<Profile | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);

  // Profile search dropdown states
  const [profileSearchResults, setProfileSearchResults] = useState<Profile[]>([]);
  const [isSearchingProfiles, setIsSearchingProfiles] = useState(false);
  const [showProfileResults, setShowProfileResults] = useState(false);
  const searchDropdownRef = useRef<HTMLDivElement>(null);

  // Use session relays if authenticated, otherwise use default relays
  const relays = session?.relays || DEFAULT_RELAYS;

  // Load user profile when signed in
  useEffect(() => {
    const loadUserProfile = async () => {
      if (session?.pubkey) {
        try {
          const profile = await fetchProfile(session.pubkey, session.relays);
          setUserProfile(profile);
        } catch (error) {
          console.error('Failed to load user profile:', error);
        }
      } else {
        setUserProfile(null);
      }
    };

    loadUserProfile();
  }, [session]);

  // Auto-populate from URL parameter and trigger search
  useEffect(() => {
    const npub = searchParams.get('npub');
    if (npub && npub.startsWith('npub')) {
      setSearchQuery(npub);
      // Auto-trigger search after a brief delay to allow component to mount
      setTimeout(() => {
        const searchButton = document.querySelector('[data-search-button]') as HTMLButtonElement;
        if (searchButton) {
          searchButton.click();
        }
      }, 100);
    }
  }, [searchParams]);

  // Real-time profile search
  useEffect(() => {
    const searchUserProfiles = async () => {
      if (!searchQuery.trim()) {
        setProfileSearchResults([]);
        setShowProfileResults(false);
        return;
      }

      // Don't search if it's already a valid npub or hex pubkey
      if (searchQuery.startsWith('npub') || searchQuery.match(/^[0-9a-f]{64}$/i)) {
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
        console.error('Profile search failed:', error);
        setProfileSearchResults([]);
      } finally {
        setIsSearchingProfiles(false);
      }
    };

    // Debounce search - wait 300ms after user stops typing
    const timeoutId = setTimeout(searchUserProfiles, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, relays]);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchDropdownRef.current && !searchDropdownRef.current.contains(event.target as Node)) {
        setShowProfileResults(false);
      }
    };

    if (showProfileResults) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showProfileResults]);

  // Infinite scroll - automatically load more when trigger comes into view
  useEffect(() => {
    const trigger = loadMoreTriggerRef.current;
    if (!trigger) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        // If trigger is visible and we have more results to load and not already loading
        if (entry.isIntersecting && allResults.length > displayedResults.length && !loadingMore) {
          handleLoadMore();
        }
      },
      { threshold: 0.1 } // Trigger when 10% of the element is visible
    );

    observer.observe(trigger);

    return () => {
      if (trigger) {
        observer.unobserve(trigger);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allResults.length, displayedResults.length, loadingMore]); // handleLoadMore intentionally not included to avoid recreation

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    try {
      setSearching(true);
      setError(null);
      setAllResults([]);
      setDisplayedResults([]);
      setDisplayCount(INITIAL_LOAD_COUNT);
      setProgress('Starting search...');

      // Convert to hex pubkey
      // If we already have a targetPubkey from profile selection, use it
      let pubkey = targetPubkey || searchQuery.trim();

      // Only do conversion if we don't already have a valid pubkey
      if (!targetPubkey) {
        try {
          if (pubkey.startsWith('npub')) {
            pubkey = npubToHex(pubkey);
          } else if (!pubkey.match(/^[0-9a-f]{64}$/i)) {
            // Try to resolve username
            setProgress('Searching for user...');
            const profiles = await searchProfiles(pubkey, relays, 10);
            if (profiles.length === 0) {
              setError(`No user found with username or NIP-05: "${pubkey}"`);
              setSearching(false);
              return;
            }
            pubkey = profiles[0].pubkey;
            setTargetProfile(profiles[0]);
          }
        } catch (conversionError) {
          console.error('Failed to convert npub:', conversionError);
          setError(`Invalid npub format. Please check the npub and try again.`);
          setSearching(false);
          return;
        }
      }

      setTargetPubkey(pubkey);
      setProgress('Searching network for public mute lists...');

      // Use expanded relay list for better coverage
      const expandedRelays = getExpandedRelayList(relays);

      // Collect all results first (don't stream)
      const rawResults = await searchMutealsNetworkWide(
        pubkey,
        expandedRelays,
        (count) => {
          setProgress(`Scanning relays... ${count} event${count === 1 ? '' : 's'} collected`);
        }
        // No streaming callback - collect all first
      );

      if (rawResults.length === 0) {
        setAllResults([]);
        setDisplayedResults([]);
        setProgress('');
        setSearching(false);
        return;
      }

      // Store all results (already deduplicated by searchMutealsNetworkWide)
      setAllResults(rawResults);

      // Show final count before loading profiles
      setProgress(`Found on ${rawResults.length} public mute list${rawResults.length === 1 ? '' : 's'} - loading profiles...`);

      // Only enrich the first batch for initial display
      const initialBatch = rawResults.slice(0, INITIAL_LOAD_COUNT);

      // Small delay to let the "Found on X" message show before profile loading
      await new Promise(resolve => setTimeout(resolve, 500));

      const enriched = await enrichMutealsWithProfiles(
        initialBatch,
        relays,
        (current, total) => {
          setProgress(`Loading profiles... ${current}/${total}`);
        }
      );

      // Display initial results
      setDisplayedResults(enriched);
      setDisplayCount(INITIAL_LOAD_COUNT);
      setProgress('');
    } catch (err) {
      console.error('Search error:', err);
      setError(err instanceof Error ? err.message : 'Failed to search for public mute lists');
      setProgress('');
    } finally {
      setSearching(false);
    }
  };

  const handleSelectProfile = (profile: Profile) => {
    setSearchQuery(profile.display_name || profile.name || profile.nip05 || '');
    setShowProfileResults(false);
    setTargetProfile(profile);
    setTargetPubkey(profile.pubkey); // Store the pubkey so we don't need to search again
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
      setShowProfileResults(false);
    }
  };

  const handleLoadMore = async () => {
    if (loadingMore) return;

    const relays = session?.relays || DEFAULT_RELAYS;
    const currentCount = displayedResults.length;
    const nextBatch = allResults.slice(currentCount, currentCount + LOAD_MORE_COUNT);

    if (nextBatch.length === 0) return;

    setLoadingMore(true);
    try {
      const enriched = await enrichMutealsWithProfiles(
        nextBatch,
        relays,
        (current, total) => {
          setProgress(`Loading more profiles... ${current}/${total}`);
        }
      );

      setDisplayedResults(prev => [...prev, ...enriched]);
      setDisplayCount(prev => prev + LOAD_MORE_COUNT);
      setProgress('');
    } catch (err) {
      console.error('Failed to load more:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleCopyNpub = async (npub: string) => {
    try {
      await navigator.clipboard.writeText(npub);
      setCopiedNpub(npub);
      setTimeout(() => setCopiedNpub(null), 2000);
    } catch (error) {
      console.error('Failed to copy npub:', error);
    }
  };

  const handleViewProfile = (muteal: MutealResult) => {
    setSelectedProfile(muteal.profile || { pubkey: muteal.mutedBy });
  };

  const handleDisconnect = () => {
    disconnect();
    window.location.href = '/';
  };

  const handleUserSelect = (profile: Profile) => {
    setSelectedProfile(profile);
  };

  const handleReset = () => {
    setSearchQuery('');
    setTargetPubkey(null);
    setTargetProfile(null);
    setAllResults([]);
    setDisplayedResults([]);
    setDisplayCount(INITIAL_LOAD_COUNT);
    setError(null);
    setProgress('');
    setProfileSearchResults([]);
    setShowProfileResults(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {session ? (
        <>
          {/* Signed-in Header - matches dashboard exactly */}
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

                {/* Global Search */}
                <GlobalUserSearch onSelectUser={handleUserSelect} />

                <div className="flex items-center space-x-4 flex-shrink-0">
                  {/* User Profile Display - Desktop */}
                  <div className="hidden md:flex items-center space-x-3">
                    {userProfile?.picture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={userProfile.picture}
                        alt={userProfile.display_name || userProfile.name || 'User'}
                        className="w-8 h-8 rounded-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/%3E%3Cpath d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/%3E%3C/svg%3E';
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
                            {userProfile.display_name || userProfile.name || 'Anonymous'}
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

                  {/* User Avatar - Mobile */}
                  <div className="md:hidden">
                    {userProfile?.picture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={userProfile.picture}
                        alt={userProfile.display_name || userProfile.name || 'User'}
                        className="w-8 h-8 rounded-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/%3E%3Cpath d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/%3E%3C/svg%3E';
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

          {/* Tab Navigation */}
          <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              {/* Desktop Navigation */}
              <div className="hidden lg:flex space-x-8">
                <Link
                  href="/dashboard"
                  className="py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300 font-semibold text-base transition-colors"
                >
                  My Mute List
                </Link>
                <Link
                  href="/dashboard"
                  className="py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300 font-semibold text-base transition-colors"
                >
                  Community Packs
                </Link>
                <Link
                  href="/dashboard"
                  className="py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300 font-semibold text-base transition-colors"
                >
                  Muteuals
                </Link>
                <div className="py-4 px-1 border-b-2 border-red-600 text-red-600 dark:border-red-500 dark:text-red-500 font-semibold text-base">
                  Mute-o-Scope
                </div>
                <Link
                  href="/dashboard"
                  className="py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300 font-semibold text-base transition-colors"
                >
                  Backups
                </Link>
                <Link
                  href="/dashboard"
                  className="py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300 font-semibold text-base transition-colors"
                >
                  List Cleaner
                </Link>
                <Link
                  href="/dashboard"
                  className="py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300 font-semibold text-base transition-colors"
                >
                  Settings
                </Link>
              </div>

              {/* Mobile Navigation */}
              <div className="lg:hidden">
                <div className="flex items-center justify-between w-full py-4">
                  <span className="font-semibold text-base text-gray-900 dark:text-white">
                    Mute-o-Scope
                  </span>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Anonymous Header */}
          <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center h-16 gap-4">
                <Link
                  href="/"
                  className="flex items-center space-x-3 flex-shrink-0 hover:opacity-80 transition-opacity"
                  title="Go to Home"
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
        </>
      )}

      <div className="flex-1 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <div className="container mx-auto px-4 py-8 max-w-6xl">
          {/* Page Header */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <div className="flex items-start gap-4 mb-4">
              <Image
                src="/mute_o_scope_icon_white.svg"
                alt="Mute-o-Scope"
                width={40}
                height={40}
                className="flex-shrink-0 mt-1"
              />
              <div className="flex-1">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                  Mute-o-Scope
                </h1>
                <p className="text-gray-600 dark:text-gray-400 mb-3">
                  Search any npub to see who is publicly muting them
                </p>
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
                    👁️ Public lists only
                  </span>
                </div>
              </div>
            </div>

          {/* Info Banner */}
          <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <strong>Note:</strong> This tool only shows public (unencrypted) mute lists. Many users keep their mute lists private, which cannot be scanned.
            </p>
          </div>

          {/* Mobile Performance Warning */}
          <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg md:hidden">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              <strong>Mobile Notice:</strong> Low bandwidth mobile connections may result in incomplete search results. For best performance, we recommend using a desktop browser with a stable connection.
            </p>
          </div>
        </div>

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
                    // Clear stored pubkey when user types something new
                    if (targetPubkey) {
                      setTargetPubkey(null);
                      setTargetProfile(null);
                    }
                  }}
                  onKeyPress={handleKeyPress}
                  onFocus={() => {
                    if (profileSearchResults.length > 0) {
                      setShowProfileResults(true);
                    }
                  }}
                  placeholder="Enter username, NIP-05, npub, or pubkey..."
                  className="w-full px-4 py-3 pr-10 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-lg"
                  disabled={searching}
                />
                {isSearchingProfiles && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Loader2 size={20} className="animate-spin text-gray-400" />
                  </div>
                )}

                {/* Profile search results dropdown */}
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
                            alt={profile.display_name || profile.name || 'User'}
                            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
                            <User size={20} className="text-gray-600 dark:text-gray-300" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 dark:text-white truncate">
                            {profile.display_name || profile.name || 'Anonymous'}
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
                data-search-button
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

          {/* Progress Display */}
          {searching && (
            <div className="mt-4 p-4 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-2 border-blue-200 dark:border-blue-700 rounded-lg">
              <div className="flex flex-col items-center space-y-2">
                {allResults.length > 0 && (
                  <div className="text-lg font-semibold text-blue-900 dark:text-blue-100">
                    Found on {allResults.length} Public Mute List{allResults.length === 1 ? '' : 's'}
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

          {/* Error Display */}
          {error && (
            <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 rounded text-red-700 dark:text-red-200 text-sm flex items-start gap-2">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Results Section */}
        {!searching && allResults.length === 0 && targetPubkey && !error && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8">
            <div className="text-center">
              <Users className="mx-auto mb-3 text-green-500" size={48} />
              <p className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                No Public Mute Lists Found
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                This user is not publicly muted by anyone on the scanned relays, or their mute lists are encrypted.
              </p>
            </div>
          </div>
        )}

        {displayedResults.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Found on {allResults.length} Public Mute List{allResults.length === 1 ? '' : 's'}
                </h3>
                {allResults.length > displayedResults.length && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Showing {displayedResults.length} of {allResults.length}
                  </p>
                )}
              </div>
              {targetProfile && (
                <button
                  onClick={() => setShowShareModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium flex-shrink-0"
                  title="Share these results"
                >
                  <Share size={20} />
                  <span className="hidden sm:inline">Share</span>
                </button>
              )}
            </div>

            <div className="space-y-3">
              {displayedResults.map((muteal) => {
                const profile = muteal.profile;
                const displayName = profile?.display_name || profile?.name || (profile ? 'Anonymous' : 'Loading profile...');
                const npub = hexToNpub(muteal.mutedBy);
                const isLoading = !profile;

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
                            (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/%3E%3Cpath d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/%3E%3C/svg%3E';
                          }}
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
                          <User size={20} className="text-gray-600 dark:text-gray-300" />
                        </div>
                      )}

                      <div className="flex-1 min-w-0 overflow-hidden">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-medium truncate ${isLoading ? 'text-gray-500 dark:text-gray-400 italic' : 'text-gray-900 dark:text-white'}`}>
                            {displayName}
                          </span>
                        </div>
                        {profile?.nip05 && (
                          <div className="text-xs text-green-600 dark:text-green-400 truncate">
                            ✓ {profile.nip05}
                          </div>
                        )}
                        {muteal.listName && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                            List: {muteal.listName}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Copy npub Button */}
                      <button
                        onClick={() => handleCopyNpub(npub)}
                        className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors ${
                          copiedNpub === npub
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-gray-600 dark:text-gray-400'
                        }`}
                        title={copiedNpub === npub ? 'Copied!' : 'Copy npub'}
                      >
                        <Copy size={16} />
                      </button>

                      {/* View on npub.world */}
                      <a
                        href={`https://npub.world/${npub}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 text-blue-600 dark:text-blue-400 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                        title="View on npub.world"
                      >
                        <ExternalLink size={16} />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Infinite Scroll Trigger */}
            {allResults.length > displayedResults.length && (
              <div className="mt-6">
                {/* Invisible trigger element for intersection observer */}
                <div ref={loadMoreTriggerRef} className="h-4" />

                {/* Loading indicator or scroll prompt */}
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
                      Scroll down or click to load more • {allResults.length - displayedResults.length} remaining
                    </p>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

          {/* User Profile Modal */}
          {selectedProfile && (
            <UserProfileModal
              profile={selectedProfile}
              onClose={() => setSelectedProfile(null)}
            />
          )}

          {/* Share Results Modal */}
          {showShareModal && targetProfile && (
            <ShareResultsModal
              targetProfile={targetProfile}
              resultCount={allResults.length}
              onClose={() => setShowShareModal(false)}
            />
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}
