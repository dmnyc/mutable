'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useStore } from '@/lib/store';
import {
  searchPublicListsByAuthor,
  searchPublicListsByName,
  fetchAllPublicPacks,
  fetchUserPublicPacks,
  parsePublicListEvent,
  npubToHex,
  searchProfiles,
  PACK_CATEGORIES,
  PackCategory
} from '@/lib/nostr';
import { Search, Plus, RefreshCw, Package, User, Loader2 } from 'lucide-react';
import PublicListCard from './PublicListCard';
import CreatePublicList from './CreatePublicList';
import { PublicMuteList, Profile } from '@/types';

export default function PublicLists() {
  const { session } = useAuth();
  const { publicLists, setPublicLists, setPublicListsLoading, publicListsLoading } = useStore();

  const [viewMode, setViewMode] = useState<'browse' | 'my-packs'>('my-packs');
  const [searchType, setSearchType] = useState<'author' | 'name' | 'browse'>('browse');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPack, setEditingPack] = useState<PublicMuteList | undefined>(undefined);
  const [selectedCategory, setSelectedCategory] = useState<PackCategory | 'all'>('all');
  const [includeNostrguard, setIncludeNostrguard] = useState(true);
  const [userPacks, setUserPacks] = useState<PublicMuteList[]>([]);
  const [loadingUserPacks, setLoadingUserPacks] = useState(false);
  const [hasCheckedForPacks, setHasCheckedForPacks] = useState(false);

  // Profile search states for author search
  const [profileSearchResults, setProfileSearchResults] = useState<Profile[]>([]);
  const [isSearchingProfiles, setIsSearchingProfiles] = useState(false);
  const [showProfileResults, setShowProfileResults] = useState(false);
  const searchDropdownRef = useRef<HTMLDivElement>(null);

  const handleSearch = async () => {
    if (!session) return;
    if (searchType !== 'browse' && !searchQuery.trim()) return;

    try {
      setPublicListsLoading(true);
      setSearchError(null);

      let events;
      if (searchType === 'author') {
        // Try to resolve username/NIP-05 to pubkey
        let authorPubkey = searchQuery.trim();

        // If it's already an npub, convert to hex
        if (authorPubkey.startsWith('npub')) {
          authorPubkey = npubToHex(authorPubkey);
        }
        // If it's not a hex pubkey, try to search for profiles by username/NIP-05
        else if (!authorPubkey.match(/^[0-9a-f]{64}$/i)) {
          console.log(`Searching for user by username/NIP-05: ${authorPubkey}`);
          const profiles = await searchProfiles(authorPubkey, session.relays, 10);

          if (profiles.length === 0) {
            setSearchError(`No user found with username or NIP-05: "${authorPubkey}"`);
            setPublicListsLoading(false);
            return;
          }

          // If multiple matches, use the first one (you could add UI to let user select)
          authorPubkey = profiles[0].pubkey;
          console.log(`Resolved "${searchQuery}" to pubkey: ${authorPubkey}`);

          // Show which user we're searching for
          const displayName = profiles[0].display_name || profiles[0].name || profiles[0].nip05;
          if (profiles.length > 1) {
            setSearchError(`Found ${profiles.length} users matching "${searchQuery}". Showing packs from: ${displayName}`);
          } else {
            setSearchError(`Searching packs from: ${displayName}`);
          }
        }

        events = await searchPublicListsByAuthor(authorPubkey, session.relays);
      } else if (searchType === 'name') {
        events = await searchPublicListsByName(searchQuery.trim(), session.relays);
      } else {
        // Browse all packs
        const category = selectedCategory === 'all' ? undefined : selectedCategory;
        events = await fetchAllPublicPacks(session.relays, 100, category, false, includeNostrguard);
      }

      const parsedLists = await Promise.all(events.map(parsePublicListEvent));

      // Deduplicate packs by author+dTag, keeping only the latest version
      // This handles cases where relays return multiple versions of the same pack
      const packsMap = new Map<string, PublicMuteList>();
      for (const pack of parsedLists) {
        const key = `${pack.author}:${pack.dTag}`;
        const existing = packsMap.get(key);
        // Keep the pack with the latest createdAt timestamp
        if (!existing || pack.createdAt > existing.createdAt) {
          packsMap.set(key, pack);
        }
      }
      const deduplicatedLists = Array.from(packsMap.values());

      // Filter out test packs - by name containing 'test' or known test user pubkeys
      const TEST_USER_PUBKEYS = [
        '84dee6e676e5bb67b4ad4e042cf70cbd8681155db535942fcc6a0533858a7240',
        'faeb29828b98fbffdb127bea32203da2275f9223eff9a4ec95851cc9b1d3a262', // test user
      ];

      const filteredLists = deduplicatedLists.filter(pack => {
        // Skip packs where the pack name contains 'test' (case-insensitive)
        if (pack.name.toLowerCase().includes('test')) return false;

        // Skip packs from known test user accounts
        if (TEST_USER_PUBKEYS.includes(pack.author)) return false;

        return true;
      });

      setPublicLists(filteredLists);

      if (filteredLists.length === 0) {
        setSearchError('No community packs found');
      }
    } catch (error) {
      setSearchError(
        error instanceof Error ? error.message : 'Failed to search community packs'
      );
    } finally {
      setPublicListsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
      setShowProfileResults(false);
    }
  };

  // Real-time profile search for author search
  useEffect(() => {
    const searchUserProfiles = async () => {
      // Only search when in author search mode
      if (searchType !== 'author' || !searchQuery.trim() || !session) {
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
        const results = await searchProfiles(searchQuery, session.relays, 10);
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
  }, [searchQuery, searchType, session]);

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

  // Handle selecting a profile from search results
  const handleSelectProfile = async (profile: Profile) => {
    setSearchQuery(profile.display_name || profile.name || profile.nip05 || '');
    setShowProfileResults(false);

    // Immediately search for packs from this user
    try {
      setPublicListsLoading(true);
      setSearchError(null);

      const events = await searchPublicListsByAuthor(profile.pubkey, session!.relays);
      const parsedLists = await Promise.all(events.map(parsePublicListEvent));

      // Deduplicate packs by author+dTag
      const packsMap = new Map<string, PublicMuteList>();
      for (const pack of parsedLists) {
        const key = `${pack.author}:${pack.dTag}`;
        const existing = packsMap.get(key);
        if (!existing || pack.createdAt > existing.createdAt) {
          packsMap.set(key, pack);
        }
      }
      const deduplicatedLists = Array.from(packsMap.values());

      // Filter out test packs
      const TEST_USER_PUBKEYS = [
        '84dee6e676e5bb67b4ad4e042cf70cbd8681155db535942fcc6a0533858a7240',
        'faeb29828b98fbffdb127bea32203da2275f9223eff9a4ec95851cc9b1d3a262',
      ];

      const filteredLists = deduplicatedLists.filter(pack => {
        if (pack.name.toLowerCase().includes('test')) return false;
        if (TEST_USER_PUBKEYS.includes(pack.author)) return false;
        return true;
      });

      setPublicLists(filteredLists);

      if (filteredLists.length === 0) {
        setSearchError('No community packs found');
      }
    } catch (error) {
      setSearchError(
        error instanceof Error ? error.message : 'Failed to search community packs'
      );
    } finally {
      setPublicListsLoading(false);
    }
  };

  // Load user's own packs
  const loadUserPacks = async () => {
    if (!session) return;

    try {
      setLoadingUserPacks(true);
      setSearchError(null);

      const events = await fetchUserPublicPacks(session.pubkey, session.relays);
      const parsedPacks = await Promise.all(events.map(parsePublicListEvent));

      // Deduplicate packs by dTag, keeping only the latest version
      const packsMap = new Map<string, PublicMuteList>();
      for (const pack of parsedPacks) {
        const key = pack.dTag;
        const existing = packsMap.get(key);
        // Keep the pack with the latest createdAt timestamp
        if (!existing || pack.createdAt > existing.createdAt) {
          packsMap.set(key, pack);
        }
      }
      const deduplicatedPacks = Array.from(packsMap.values());

      setUserPacks(deduplicatedPacks);
    } catch (error) {
      setSearchError(
        error instanceof Error ? error.message : 'Failed to load your packs'
      );
    } finally {
      setLoadingUserPacks(false);
    }
  };

  // Load user packs on initial load since we default to my-packs view
  useEffect(() => {
    if (session && !hasCheckedForPacks) {
      setHasCheckedForPacks(true);
      loadUserPacks();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, hasCheckedForPacks]);

  // Load user packs when switching to my-packs view
  useEffect(() => {
    if (viewMode === 'my-packs' && userPacks.length === 0 && hasCheckedForPacks) {
      loadUserPacks();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  const handleCreateModalClose = () => {
    setShowCreateModal(false);
    setEditingPack(undefined);
    // Reload user packs if we're in my-packs view
    if (viewMode === 'my-packs') {
      loadUserPacks();
    }
  };

  const handleEditPack = (pack: PublicMuteList) => {
    setEditingPack(pack);
    setShowCreateModal(true);
  };

  return (
    <div className="space-y-6 block">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 block">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Public Mute Lists
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Discover and subscribe to community mute packs
            </p>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
          >
            <Plus size={16} />
            <span>Create Pack</span>
          </button>
        </div>

        {/* View Mode Tabs */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setViewMode('my-packs')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              viewMode === 'my-packs'
                ? 'bg-red-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            <User size={16} />
            My Packs
          </button>
          <button
            onClick={() => setViewMode('browse')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              viewMode === 'browse'
                ? 'bg-red-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            <Package size={16} />
            Browse Packs
          </button>
        </div>

        {/* Search Interface (only show in browse mode) */}
        {viewMode === 'browse' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSearchType('browse')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                searchType === 'browse'
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              <Package size={16} className="inline mr-1" />
              Browse All
            </button>
            <button
              onClick={() => setSearchType('name')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                searchType === 'name'
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              Search by Name
            </button>
            <button
              onClick={() => setSearchType('author')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                searchType === 'author'
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              Search by Author
            </button>
          </div>

          {/* Category Filter for Browse Mode */}
          {searchType === 'browse' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSelectedCategory('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    selectedCategory === 'all'
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  All
                </button>
                {Object.values(PACK_CATEGORIES).map((category) => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                      selectedCategory === category
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>

              {/* Source Filter */}
              <div className="flex items-center gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                <span className="text-xs text-gray-600 dark:text-gray-400">Pack Source:</span>
                <button
                  onClick={() => setIncludeNostrguard(false)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    !includeNostrguard
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  {!includeNostrguard ? '✓ ' : ''}Mutable Only
                </button>
                <button
                  onClick={() => setIncludeNostrguard(true)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    includeNostrguard
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  {includeNostrguard ? '✓ ' : ''}Mutable + Nostrguard
                </button>
              </div>
            </div>
          )}

          {searchType !== 'browse' && (
            <div className="relative flex gap-2">
              <div className="relative flex-1" ref={searchDropdownRef}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={handleKeyPress}
                  onFocus={() => {
                    if (searchType === 'author' && profileSearchResults.length > 0) {
                      setShowProfileResults(true);
                    }
                  }}
                  placeholder={
                    searchType === 'name'
                      ? 'Enter pack name (e.g., "spam-bots")'
                      : 'Enter username, NIP-05, npub, or pubkey'
                  }
                  className="w-full px-4 py-2 pr-10 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
                />
                {searchType === 'author' && isSearchingProfiles && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Loader2 size={16} className="animate-spin text-gray-400" />
                  </div>
                )}

                {/* Profile search results dropdown */}
                {searchType === 'author' && showProfileResults && profileSearchResults.length > 0 && (
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
                onClick={handleSearch}
                disabled={publicListsLoading || !searchQuery.trim()}
                className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {publicListsLoading ? (
                  <RefreshCw className="animate-spin" size={20} />
                ) : (
                  <Search size={20} />
                )}
              </button>
            </div>
          )}

          {searchType === 'browse' && (
            <button
              onClick={handleSearch}
              disabled={publicListsLoading}
              className="w-full px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {publicListsLoading ? (
                <>
                  <RefreshCw className="animate-spin" size={20} />
                  <span>Loading Packs...</span>
                </>
              ) : (
                <>
                  <Package size={20} />
                  <span>Load Community Packs</span>
                </>
              )}
            </button>
          )}

          {searchError && (
            <div className="p-3 bg-amber-100 dark:bg-amber-900 border border-amber-400 dark:border-amber-700 rounded text-amber-700 dark:text-amber-200 text-sm">
              {searchError}
            </div>
          )}
        </div>
        )}
      </div>

      {/* My Packs View */}
      {viewMode === 'my-packs' && (
        <>
          {/* Loading State */}
          {loadingUserPacks && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-12 text-center block">
              <RefreshCw className="animate-spin mx-auto mb-3 text-gray-400" size={32} />
              <p className="text-gray-600 dark:text-gray-400">Loading your packs...</p>
            </div>
          )}

          {/* Results */}
          {!loadingUserPacks && userPacks.length > 0 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                You have {userPacks.length} {userPacks.length === 1 ? 'pack' : 'packs'}
              </p>
              {userPacks.map((list) => (
                <PublicListCard
                  key={list.id}
                  list={list}
                  isOwner={true}
                  onEdit={handleEditPack}
                  onDelete={loadUserPacks}
                />
              ))}
            </div>
          )}

          {/* Empty State */}
          {!loadingUserPacks && userPacks.length === 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-12 text-center">
              <Package className="mx-auto mb-3 text-gray-400" size={48} />
              <p className="text-gray-600 dark:text-gray-400 mb-2">
                You haven&apos;t created any packs yet
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-500 mb-4">
                Create your first community pack to share with others
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                <Plus size={16} />
                Create Your First Pack
              </button>
            </div>
          )}
        </>
      )}

      {/* Browse View */}
      {viewMode === 'browse' && (
        <>
          {/* Loading State */}
          {publicListsLoading && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-12 text-center block">
              <RefreshCw className="animate-spin mx-auto mb-3 text-gray-400" size={32} />
              <p className="text-gray-600 dark:text-gray-400">Searching...</p>
            </div>
          )}

          {/* Results */}
          {!publicListsLoading && publicLists.length > 0 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Found {publicLists.length} {publicLists.length === 1 ? 'pack' : 'packs'}
              </p>
              {publicLists.map((list) => {
                const isOwner = session?.pubkey === list.author;
                return (
                  <PublicListCard
                    key={list.id}
                    list={list}
                    isOwner={isOwner}
                    onEdit={isOwner ? handleEditPack : undefined}
                    onDelete={isOwner ? handleSearch : undefined}
                  />
                );
              })}
            </div>
          )}

          {/* Empty State */}
          {!publicListsLoading && publicLists.length === 0 && !searchError && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-12 text-center">
              <Package className="mx-auto mb-3 text-gray-400" size={48} />
              <p className="text-gray-600 dark:text-gray-400 mb-2">
                {searchType === 'browse' ? 'Click "Load Community Packs" to get started' : 'Search for community packs'}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-500">
                {searchType === 'browse'
                  ? 'Browse all community packs or filter by category'
                  : 'Enter a pack name or author to discover community packs'}
              </p>
            </div>
          )}
        </>
      )}

      {/* Create/Edit List Modal */}
      {showCreateModal && (
        <CreatePublicList
          onClose={handleCreateModalClose}
          editingPack={editingPack}
        />
      )}
    </div>
  );
}
