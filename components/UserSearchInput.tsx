"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { Profile } from "@/types";
import { searchProfiles, npubToHex } from "@/lib/nostr";
import { useAuth } from "@/hooks/useAuth";
import { Search, Loader2 } from "lucide-react";

interface UserSearchInputProps {
  onSelect: (profile: Profile) => void;
  onCancel?: () => void;
  placeholder?: string;
}

export default function UserSearchInput({
  onSelect,
  onCancel,
  placeholder = "Search by name, npub, or NIP-05",
}: UserSearchInputProps) {
  const { session } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
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

    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Set new timeout for debounced search
    searchTimeoutRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const profiles = await searchProfiles(
          query.trim(),
          session?.relays,
          20,
        );
        setResults(profiles);
        setShowDropdown(profiles.length > 0);
        setSelectedIndex(0);
      } catch (error) {
        console.error("Search error:", error);
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

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setShowDropdown(false);
      if (onCancel) {
        onCancel();
      }
      return;
    }

    // If no results but valid npub/hex entered, allow Enter to add it
    if ((!showDropdown || results.length === 0) && e.key === "Enter") {
      if (isValidPubkeyFormat(query)) {
        e.preventDefault();
        handleAddWithoutProfile();
      }
      return;
    }

    if (!showDropdown || results.length === 0) {
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % results.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex(
          (prev) => (prev - 1 + results.length) % results.length,
        );
        break;
      case "Enter":
        e.preventDefault();
        if (results[selectedIndex]) {
          handleSelect(results[selectedIndex]);
        }
        break;
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    if (showDropdown && dropdownRef.current) {
      const selectedElement = dropdownRef.current.querySelector(
        `[data-index="${selectedIndex}"]`,
      );
      if (selectedElement) {
        selectedElement.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      }
    }
  }, [selectedIndex, showDropdown]);

  const handleSelect = (profile: Profile) => {
    onSelect(profile);
    setQuery("");
    setResults([]);
    setShowDropdown(false);
  };

  // Check if query is a valid npub/nprofile/hex pubkey
  const isValidPubkeyFormat = (value: string): boolean => {
    const trimmed = value.trim();
    if (trimmed.startsWith("npub1") || trimmed.startsWith("nprofile1")) {
      try {
        npubToHex(trimmed);
        return true;
      } catch {
        return false;
      }
    }
    // Check if it's a valid hex pubkey (64 hex chars)
    if (/^[a-f0-9]{64}$/i.test(trimmed)) {
      return true;
    }
    return false;
  };

  // Create a minimal profile from npub/hex when no profile found
  const handleAddWithoutProfile = () => {
    const trimmed = query.trim();
    let pubkey: string;

    try {
      if (trimmed.startsWith("npub1") || trimmed.startsWith("nprofile1")) {
        pubkey = npubToHex(trimmed);
      } else if (/^[a-f0-9]{64}$/i.test(trimmed)) {
        pubkey = trimmed;
      } else {
        return; // Not a valid format
      }

      // Create minimal profile with just the pubkey
      const minimalProfile: Profile = {
        pubkey,
        name: undefined,
        display_name: undefined,
        about: undefined,
        picture: undefined,
        nip05: undefined,
      };

      handleSelect(minimalProfile);
    } catch {
      // Invalid format, do nothing
    }
  };

  const getDisplayName = (profile: Profile) => {
    return profile.display_name || profile.name || "Anonymous";
  };

  const getTruncatedPubkey = (pubkey: string) => {
    return `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`;
  };

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full pl-10 pr-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-900 dark:text-white"
          placeholder={placeholder}
          autoFocus
        />
        <Search
          className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
          size={16}
        />
        {loading && (
          <Loader2
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 animate-spin"
            size={16}
          />
        )}
      </div>

      {/* Dropdown with results */}
      {showDropdown && results.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-64 overflow-y-auto"
        >
          {results.map((profile, index) => (
            <button
              key={profile.pubkey}
              data-index={index}
              onClick={() => handleSelect(profile)}
              className={`w-full flex items-center space-x-3 px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                index === selectedIndex ? "bg-gray-100 dark:bg-gray-700" : ""
              }`}
            >
              {profile.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.picture}
                  alt={getDisplayName(profile)}
                  className="w-10 h-10 rounded-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src =
                      'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/%3E%3Cpath d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/%3E%3C/svg%3E';
                  }}
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
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
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {profile.nip05}
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
      {showDropdown &&
        query.trim().length >= 3 &&
        results.length === 0 &&
        !loading && (
          <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg p-4 text-center">
            {isValidPubkeyFormat(query) ? (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                  No profile found for this pubkey.
                </p>
                <button
                  onClick={handleAddWithoutProfile}
                  className="px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700 font-medium"
                >
                  Add Anyway
                </button>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                  Or press Enter
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No users found. Try a different search term.
              </p>
            )}
          </div>
        )}
    </div>
  );
}
