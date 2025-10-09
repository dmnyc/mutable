'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useStore } from '@/lib/store';
import {
  searchPublicListsByAuthor,
  searchPublicListsByName,
  parsePublicListEvent,
  npubToHex
} from '@/lib/nostr';
import { Search, Plus, RefreshCw } from 'lucide-react';
import PublicListCard from './PublicListCard';
import CreatePublicList from './CreatePublicList';

export default function PublicLists() {
  const { session } = useAuth();
  const { publicLists, setPublicLists, setPublicListsLoading, publicListsLoading } = useStore();

  const [searchType, setSearchType] = useState<'author' | 'name'>('name');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleSearch = async () => {
    if (!session || !searchQuery.trim()) return;

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
      } else {
        events = await searchPublicListsByName(searchQuery.trim(), session.relays);
      }

      const parsedLists = events.map(parsePublicListEvent);
      setPublicLists(parsedLists);

      if (parsedLists.length === 0) {
        setSearchError('No public lists found');
      }
    } catch (error) {
      setSearchError(
        error instanceof Error ? error.message : 'Failed to search public lists'
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
              Public Mute Lists
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Discover and subscribe to community mute lists
            </p>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
          >
            <Plus size={16} />
            <span>Create List</span>
          </button>
        </div>

        {/* Search Interface */}
        <div className="space-y-3">
          <div className="flex gap-2">
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

          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={
                searchType === 'name'
                  ? 'Enter list name (e.g., "spam-bots")'
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
            Found {publicLists.length} {publicLists.length === 1 ? 'list' : 'lists'}
          </p>
          {publicLists.map((list) => (
            <PublicListCard key={list.id} list={list} />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!publicListsLoading && publicLists.length === 0 && !searchError && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-12 text-center">
          <Search className="mx-auto mb-3 text-gray-400" size={48} />
          <p className="text-gray-600 dark:text-gray-400 mb-2">
            Search for public mute lists
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500">
            Enter a list name or author to discover community mute lists
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
