'use client';

import { useState, useEffect, useRef } from 'react';
import { Profile } from '@/types';
import { searchProfiles } from '@/lib/nostr';
import { useAuth } from '@/hooks/useAuth';
import { Search, Loader2, X } from 'lucide-react';

interface GlobalUserSearchProps {
  onSelectUser: (profile: Profile) => void;
}

export default function GlobalUserSearch({ onSelectUser }: GlobalUserSearchProps) {
  const { session } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const profiles = await searchProfiles(
          query.trim(),
          session?.relays,
          20
        );
        setResults(profiles);
        setShowDropdown(profiles.length > 0);
        setSelectedIndex(0);
      } catch (error) {
        console.error('Search error:', error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, session?.relays]);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        !inputRef.current?.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || results.length === 0) {
      if (e.key === 'Escape') {
        setQuery('');
        setShowDropdown(false);
        inputRef.current?.blur();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % results.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
        break;
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) {
          handleSelect(results[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setShowDropdown(false);
        setQuery('');
        inputRef.current?.blur();
        break;
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    if (showDropdown && dropdownRef.current) {
      const selectedElement = dropdownRef.current.querySelector(
        `[data-index="${selectedIndex}"]`
      );
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex, showDropdown]);

  const handleSelect = (profile: Profile) => {
    onSelectUser(profile);
    setQuery('');
    setResults([]);
    setShowDropdown(false);
    inputRef.current?.blur();
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setShowDropdown(false);
    inputRef.current?.focus();
  };

  const getDisplayName = (profile: Profile) => {
    return profile.display_name || profile.name || 'Anonymous';
  };

  const getTruncatedPubkey = (pubkey: string) => {
    return `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`;
  };

  return (
    <div className="relative flex-1 max-w-md">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className="w-full pl-9 pr-9 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
          placeholder="Search users by name, npub, or NIP-05..."
        />
        <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center">
          <Search
            className={`text-gray-400 transition-opacity absolute ${loading ? 'opacity-0' : 'opacity-100'}`}
            size={16}
          />
          <Loader2
            className={`text-gray-400 animate-spin transition-opacity absolute ${loading ? 'opacity-100' : 'opacity-0'}`}
            size={16}
          />
        </div>
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Dropdown with results */}
      {showDropdown && results.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-xl max-h-96 overflow-y-auto"
        >
          {results.map((profile, index) => (
            <button
              key={profile.pubkey}
              data-index={index}
              onClick={() => handleSelect(profile)}
              className={`w-full flex items-center space-x-3 px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                index === selectedIndex
                  ? 'bg-gray-100 dark:bg-gray-700'
                  : ''
              } ${index === 0 ? 'rounded-t-lg' : ''} ${
                index === results.length - 1 ? 'rounded-b-lg' : ''
              }`}
            >
              {profile.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.picture}
                  alt={getDisplayName(profile)}
                  className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/%3E%3Cpath d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/%3E%3C/svg%3E';
                  }}
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
                  <span className="text-gray-600 dark:text-gray-300 text-sm font-medium">
                    {getDisplayName(profile)[0].toUpperCase()}
                  </span>
                </div>
              )}

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {getDisplayName(profile)}
                </p>
                {profile.nip05 && (
                  <p className="text-xs text-green-600 dark:text-green-400 truncate">
                    ✓ {profile.nip05}
                  </p>
                )}
                <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">
                  {getTruncatedPubkey(profile.pubkey)}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* No results message */}
      {showDropdown && query.trim().length >= 3 && results.length === 0 && !loading && (
        <div className="absolute z-50 w-full mt-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-xl p-4 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No users found. Try a different search term.
          </p>
        </div>
      )}
    </div>
  );
}
