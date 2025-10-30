'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useStore } from '@/lib/store';
import {
  searchPublicListsByAuthor,
  searchPublicListsByName,
  fetchAllPublicPacks,
  parsePublicListEvent,
  npubToHex,
  PACK_CATEGORIES,
  PackCategory
} from '@/lib/nostr';
import { Search, Plus, RefreshCw, Package } from 'lucide-react';
import PublicListCard from './PublicListCard';
import CreatePublicList from './CreatePublicList';

export default function PublicLists() {
  const { session } = useAuth();
  const { publicLists, setPublicLists, setPublicListsLoading, publicListsLoading } = useStore();

  const [searchType, setSearchType] = useState<'author' | 'name' | 'browse'>('browse');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<PackCategory | 'all'>('all');
  const [includeNostrguard, setIncludeNostrguard] = useState(true);

  const handleSearch = async () => {
    if (!session) return;
    if (searchType !== 'browse' && !searchQuery.trim()) return;

    try {
      setPublicListsLoading(true);
      setSearchError(null);

      let events;
      if (searchType === 'author') {
        // Convert npub to hex if needed
        let authorPubkey = searchQuery.trim();
        if (authorPubkey.startsWith('npub')) {
          authorPubkey = npubToHex(authorPubkey);
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

      // Filter out test packs - by name containing 'test' or known test user pubkeys
      const TEST_USER_PUBKEYS = [
        '84dee6e676e5bb67b4ad4e042cf70cbd8681155db535942fcc6a0533858a7240',
        'faeb29828b98fbffdb127bea32203da2275f9223eff9a4ec95851cc9b1d3a262', // test user
      ];

      const filteredLists = parsedLists.filter(pack => {
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
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Community Packs
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

        {/* Search Interface */}
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
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={
                  searchType === 'name'
                    ? 'Enter pack name (e.g., "spam-bots")'
                    : 'Enter author npub or pubkey'
                }
                className="flex-1 px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
              />
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
      </div>

      {/* Loading State */}
      {publicListsLoading && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-12 text-center">
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
          {publicLists.map((list) => (
            <PublicListCard key={list.id} list={list} />
          ))}
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

      {/* Create List Modal */}
      {showCreateModal && (
        <CreatePublicList onClose={() => setShowCreateModal(false)} />
      )}
    </div>
  );
}
