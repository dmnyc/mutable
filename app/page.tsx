"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import AuthModal from "@/components/AuthModal";
import { Lock, Unlock, User, Loader2 } from "lucide-react";
import { searchProfiles, hexToNpub, DEFAULT_RELAYS } from "@/lib/nostr";
import { Profile } from "@/types";

export default function Home() {
  const router = useRouter();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [snoopQuery, setSnoopQuery] = useState("");
  const [profileSearchResults, setProfileSearchResults] = useState<Profile[]>(
    [],
  );
  const [isSearchingProfiles, setIsSearchingProfiles] = useState(false);
  const [showProfileResults, setShowProfileResults] = useState(false);
  const [snoopSearchResults, setSnoopSearchResults] = useState<Profile[]>([]);
  const [isSearchingSnoopProfiles, setIsSearchingSnoopProfiles] =
    useState(false);
  const [showSnoopProfileResults, setShowSnoopProfileResults] = useState(false);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const snoopSearchDropdownRef = useRef<HTMLDivElement>(null);
  const { isConnected } = useAuth();

  useEffect(() => {
    if (isConnected) {
      router.push("/dashboard");
    }
  }, [isConnected, router]);

  // Real-time profile search
  useEffect(() => {
    const searchUserProfiles = async () => {
      if (!searchQuery.trim()) {
        setProfileSearchResults([]);
        setShowProfileResults(false);
        return;
      }

      // Don't search if it's already a valid npub, nprofile, or hex pubkey
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
        const results = await searchProfiles(searchQuery, DEFAULT_RELAYS, 10);
        setProfileSearchResults(results);
      } catch (error) {
        console.error("Profile search failed:", error);
        setProfileSearchResults([]);
      } finally {
        setIsSearchingProfiles(false);
      }
    };

    // Debounce search - wait 300ms after user stops typing
    const timeoutId = setTimeout(searchUserProfiles, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  // Real-time profile search for Snoopable
  useEffect(() => {
    const searchSnoopProfiles = async () => {
      if (!snoopQuery.trim()) {
        setSnoopSearchResults([]);
        setShowSnoopProfileResults(false);
        return;
      }

      if (
        snoopQuery.startsWith("npub") ||
        snoopQuery.startsWith("nprofile") ||
        snoopQuery.match(/^[0-9a-f]{64}$/i)
      ) {
        setSnoopSearchResults([]);
        setShowSnoopProfileResults(false);
        return;
      }

      setIsSearchingSnoopProfiles(true);
      setShowSnoopProfileResults(true);
      try {
        const results = await searchProfiles(snoopQuery, DEFAULT_RELAYS, 10);
        setSnoopSearchResults(results);
      } catch (error) {
        console.error("Snoopable profile search failed:", error);
        setSnoopSearchResults([]);
      } finally {
        setIsSearchingSnoopProfiles(false);
      }
    };

    const timeoutId = setTimeout(searchSnoopProfiles, 300);
    return () => clearTimeout(timeoutId);
  }, [snoopQuery]);

  // Handle click outside to close dropdown
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

  // Handle click outside to close snoop dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        snoopSearchDropdownRef.current &&
        !snoopSearchDropdownRef.current.contains(event.target as Node)
      ) {
        setShowSnoopProfileResults(false);
      }
    };

    if (showSnoopProfileResults) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showSnoopProfileResults]);

  const handleSearch = () => {
    if (searchQuery.trim()) {
      router.push(
        `/mute-o-scope?npub=${encodeURIComponent(searchQuery.trim())}`,
      );
    }
  };

  const handleSnoopSearch = () => {
    if (snoopQuery.trim()) {
      router.push(`/snoopable?npub=${encodeURIComponent(snoopQuery.trim())}`);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
      setShowProfileResults(false);
    }
  };

  const handleSelectProfile = (profile: Profile) => {
    const displayName =
      profile.display_name || profile.name || profile.nip05 || "";
    setSearchQuery(displayName);
    setShowProfileResults(false);
    // Navigate immediately when profile is selected - convert hex to npub
    const npub = hexToNpub(profile.pubkey);
    router.push(`/mute-o-scope?npub=${encodeURIComponent(npub)}`);
  };

  const handleSelectSnoopProfile = (profile: Profile) => {
    const displayName =
      profile.display_name || profile.name || profile.nip05 || "";
    setSnoopQuery(displayName);
    setShowSnoopProfileResults(false);
    const npub = hexToNpub(profile.pubkey);
    router.push(`/snoopable?npub=${encodeURIComponent(npub)}`);
  };

  if (isConnected) {
    return <div>Redirecting...</div>;
  }

  return (
    <>
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-purple-50 dark:from-gray-900 dark:to-gray-800 px-4">
        <div className="text-center w-full max-w-2xl">
          <div className="flex justify-center mb-6">
            <Image
              src="/mutable_logo.svg"
              alt="Mutable Logo"
              width={150}
              height={150}
              priority
            />
          </div>
          <div className="flex justify-center mb-4">
            {/* Light mode: dark text, Dark mode: white text with shadow */}
            <Image
              src="/mutable_text_dark.svg"
              alt="Mutable"
              width={300}
              height={60}
              priority
              className="block dark:hidden"
            />
            <Image
              src="/mutable_text.svg"
              alt="Mutable"
              width={300}
              height={60}
              priority
              className="hidden dark:block"
            />
          </div>
          <p className="text-xl font-semibold text-gray-600 dark:text-gray-300 mb-8">
            Your Nostr Mute List Manager
          </p>

          {/* Main Action Buttons */}
          <div className="max-w-md mx-auto w-full mb-8">
            <div className="flex flex-col gap-4 justify-center items-stretch">
              <button
                onClick={() => setShowAuthModal(true)}
                className="w-full px-8 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
              >
                <Lock size={20} />
                Connect with Nostr
              </button>

              <Link
                href="/mute-o-scope"
                className="w-full px-8 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-semibold shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
              >
                <Image
                  src="/mute_o_scope_icon_white.svg"
                  alt="Mute-o-Scope"
                  width={20}
                  height={20}
                />
                Mute-o-Scope
              </Link>
              <Link
                href="/snoopable"
                className="w-full px-8 py-3 bg-gray-900 text-white rounded-lg hover:bg-black transition-colors font-semibold shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
              >
                <svg
                  width="20"
                  height="16"
                  viewBox="0 0 459 374"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="text-white"
                  aria-hidden="true"
                >
                  <path
                    d="M122.637 0.00931859C53.8791 0.00931859 0 81.967 0 186.615C0 291.263 53.8586 373.221 122.616 373.221C191.374 373.221 245.233 291.263 245.233 186.615C245.253 81.967 191.389 0.00931859 122.637 0.00931859ZM122.637 341.251C73.514 341.251 32.0091 270.431 32.0091 186.636C32.0091 102.82 73.5145 32.0205 122.637 32.0205C160.523 32.0205 193.769 74.1884 207.066 131.873C200.669 129.473 193.831 127.994 186.614 127.994C154.265 127.994 127.975 154.306 127.975 186.637C127.975 218.987 154.285 245.279 186.614 245.279C193.831 245.279 200.669 243.8 207.066 241.401C193.771 299.086 160.523 341.251 122.637 341.251ZM213.264 186.636C213.264 201.331 201.309 213.288 186.614 213.288C171.919 213.288 159.964 201.331 159.964 186.636C159.964 171.94 171.919 159.983 186.614 159.983C201.309 159.983 213.264 171.94 213.264 186.636ZM335.881 0.0297912C299.014 0.0297912 266.504 23.7429 244.214 61.754C250.552 74.4505 256.03 88.0862 260.308 102.722C276.682 60.5343 304.732 32.0047 335.883 32.0047C373.77 32.0047 407.016 74.1725 420.313 131.857C413.915 129.457 407.078 127.978 399.86 127.978C367.512 127.978 341.221 154.29 341.221 186.621C341.221 218.971 367.532 245.264 399.86 245.264C407.078 245.264 413.915 243.784 420.313 241.385C407.017 299.07 373.769 341.237 335.883 341.237C304.734 341.237 276.686 312.725 260.308 270.519C256.03 285.155 250.552 298.811 244.214 311.487C266.506 349.497 298.994 373.212 335.881 373.212C404.638 373.212 458.497 291.254 458.497 186.606C458.497 81.9577 404.638 0 335.881 0V0.0297912ZM399.858 213.308C385.163 213.308 373.208 201.352 373.208 186.656C373.208 171.96 385.163 160.004 399.858 160.004C414.553 160.004 426.508 171.96 426.508 186.656C426.508 201.352 414.553 213.308 399.858 213.308Z"
                    fill="currentColor"
                  />
                </svg>
                Snoopable
                <span className="text-xs font-bold px-1.5 py-0.5 bg-gray-700 rounded">
                  NEW
                </span>
              </Link>
            </div>
          </div>

          {/* Mute-o-Scope Info Card */}
          <div className="max-w-md mx-auto w-full mt-8 p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="flex items-start gap-3 mb-4">
              <Image
                src="/mute_o_scope_icon_white.svg"
                alt="Mute-o-Scope"
                width={24}
                height={24}
                className="flex-shrink-0 mt-1"
              />
              <div className="text-left">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                  Try Mute-o-Scope - No Login Required
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Search any npub to see who is publicly muting them. Perfect
                  for checking your reputation or investigating profiles.
                </p>
              </div>
            </div>

            {/* Search Box */}
            <div className="relative" ref={searchDropdownRef}>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyPress={handleKeyPress}
                    onFocus={() => {
                      if (profileSearchResults.length > 0) {
                        setShowProfileResults(true);
                      }
                    }}
                    placeholder="Enter npub, username, or hex..."
                    className="w-full px-4 py-2 pr-10 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm"
                  />
                  {isSearchingProfiles && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Loader2
                        size={16}
                        className="animate-spin text-gray-400"
                      />
                    </div>
                  )}
                </div>
                <button
                  onClick={handleSearch}
                  disabled={!searchQuery.trim()}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Image
                    src="/mute_o_scope_icon_white.svg"
                    alt="Mute-o-Scope"
                    width={16}
                    height={16}
                  />
                </button>
              </div>

              {/* Profile search results dropdown */}
              {showProfileResults && profileSearchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto z-50">
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
                          alt={profile.display_name || profile.name || "User"}
                          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display =
                              "none";
                          }}
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
                          <User
                            size={20}
                            className="text-gray-600 dark:text-gray-300"
                          />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white truncate">
                          {profile.display_name || profile.name || "Anonymous"}
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
          </div>

          {/* Snoopable Info Card */}
          <div className="max-w-md mx-auto w-full mt-6 p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="flex items-start gap-3 mb-4">
              <svg
                width="24"
                height="19"
                viewBox="0 0 459 374"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="text-purple-600 dark:text-purple-400 flex-shrink-0 mt-1"
                aria-hidden="true"
              >
                <path
                  d="M122.637 0.00931859C53.8791 0.00931859 0 81.967 0 186.615C0 291.263 53.8586 373.221 122.616 373.221C191.374 373.221 245.233 291.263 245.233 186.615C245.253 81.967 191.389 0.00931859 122.637 0.00931859ZM122.637 341.251C73.514 341.251 32.0091 270.431 32.0091 186.636C32.0091 102.82 73.5145 32.0205 122.637 32.0205C160.523 32.0205 193.769 74.1884 207.066 131.873C200.669 129.473 193.831 127.994 186.614 127.994C154.265 127.994 127.975 154.306 127.975 186.637C127.975 218.987 154.285 245.279 186.614 245.279C193.831 245.279 200.669 243.8 207.066 241.401C193.771 299.086 160.523 341.251 122.637 341.251ZM213.264 186.636C213.264 201.331 201.309 213.288 186.614 213.288C171.919 213.288 159.964 201.331 159.964 186.636C159.964 171.94 171.919 159.983 186.614 159.983C201.309 159.983 213.264 171.94 213.264 186.636ZM335.881 0.0297912C299.014 0.0297912 266.504 23.7429 244.214 61.754C250.552 74.4505 256.03 88.0862 260.308 102.722C276.682 60.5343 304.732 32.0047 335.883 32.0047C373.77 32.0047 407.016 74.1725 420.313 131.857C413.915 129.457 407.078 127.978 399.86 127.978C367.512 127.978 341.221 154.29 341.221 186.621C341.221 218.971 367.532 245.264 399.86 245.264C407.078 245.264 413.915 243.784 420.313 241.385C407.017 299.07 373.769 341.237 335.883 341.237C304.734 341.237 276.686 312.725 260.308 270.519C256.03 285.155 250.552 298.811 244.214 311.487C266.506 349.497 298.994 373.212 335.881 373.212C404.638 373.212 458.497 291.254 458.497 186.606C458.497 81.9577 404.638 0 335.881 0V0.0297912ZM399.858 213.308C385.163 213.308 373.208 201.352 373.208 186.656C373.208 171.96 385.163 160.004 399.858 160.004C414.553 160.004 426.508 171.96 426.508 186.656C426.508 201.352 414.553 213.308 399.858 213.308Z"
                  fill="currentColor"
                />
              </svg>
              <div className="text-left">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                  Try Snoopable - No Login Required{" "}
                  <span className="inline-flex items-center text-xs font-bold px-1.5 py-0.5 bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200 rounded">
                    NEW
                  </span>
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  See how public your DM metadata really is. Analyze any npub to
                  view activity, top contacts, and heatmap insights.
                </p>
              </div>
            </div>

            <div className="relative" ref={snoopSearchDropdownRef}>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={snoopQuery}
                    onChange={(e) => setSnoopQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleSnoopSearch();
                        setShowSnoopProfileResults(false);
                      }
                    }}
                    onFocus={() => {
                      if (snoopSearchResults.length > 0) {
                        setShowSnoopProfileResults(true);
                      }
                    }}
                    placeholder="Enter npub or username..."
                    className="w-full px-4 py-2 pr-10 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm"
                  />
                  {isSearchingSnoopProfiles && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Loader2
                        size={16}
                        className="animate-spin text-gray-400"
                      />
                    </div>
                  )}
                </div>
                <button
                  onClick={handleSnoopSearch}
                  disabled={!snoopQuery.trim()}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-black transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg
                    width="16"
                    height="13"
                    viewBox="0 0 459 374"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className="text-white"
                    aria-hidden="true"
                  >
                    <path
                      d="M122.637 0.00931859C53.8791 0.00931859 0 81.967 0 186.615C0 291.263 53.8586 373.221 122.616 373.221C191.374 373.221 245.233 291.263 245.233 186.615C245.253 81.967 191.389 0.00931859 122.637 0.00931859ZM122.637 341.251C73.514 341.251 32.0091 270.431 32.0091 186.636C32.0091 102.82 73.5145 32.0205 122.637 32.0205C160.523 32.0205 193.769 74.1884 207.066 131.873C200.669 129.473 193.831 127.994 186.614 127.994C154.265 127.994 127.975 154.306 127.975 186.637C127.975 218.987 154.285 245.279 186.614 245.279C193.831 245.279 200.669 243.8 207.066 241.401C193.771 299.086 160.523 341.251 122.637 341.251ZM213.264 186.636C213.264 201.331 201.309 213.288 186.614 213.288C171.919 213.288 159.964 201.331 159.964 186.636C159.964 171.94 171.919 159.983 186.614 159.983C201.309 159.983 213.264 171.94 213.264 186.636ZM335.881 0.0297912C299.014 0.0297912 266.504 23.7429 244.214 61.754C250.552 74.4505 256.03 88.0862 260.308 102.722C276.682 60.5343 304.732 32.0047 335.883 32.0047C373.77 32.0047 407.016 74.1725 420.313 131.857C413.915 129.457 407.078 127.978 399.86 127.978C367.512 127.978 341.221 154.29 341.221 186.621C341.221 218.971 367.532 245.264 399.86 245.264C407.078 245.264 413.915 243.784 420.313 241.385C407.017 299.07 373.769 341.237 335.883 341.237C304.734 341.237 276.686 312.725 260.308 270.519C256.03 285.155 250.552 298.811 244.214 311.487C266.506 349.497 298.994 373.212 335.881 373.212C404.638 373.212 458.497 291.254 458.497 186.606C458.497 81.9577 404.638 0 335.881 0V0.0297912ZM399.858 213.308C385.163 213.308 373.208 201.352 373.208 186.656C373.208 171.96 385.163 160.004 399.858 160.004C414.553 160.004 426.508 171.96 426.508 186.656C426.508 201.352 414.553 213.308 399.858 213.308Z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
              </div>

              {showSnoopProfileResults && snoopSearchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto z-50">
                  {snoopSearchResults.map((profile) => (
                    <button
                      key={profile.pubkey}
                      onClick={() => handleSelectSnoopProfile(profile)}
                      className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
                    >
                      {profile.picture ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={profile.picture}
                          alt=""
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src =
                              `https://api.dicebear.com/7.x/bottts/svg?seed=${profile.pubkey}`;
                          }}
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                          <User className="text-white" size={16} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 dark:text-white truncate">
                          {profile.display_name || profile.name || "Anonymous"}
                        </div>
                        {profile.nip05 && (
                          <div className="text-xs text-green-600 dark:text-green-400 truncate">
                            ✓ {profile.nip05}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Plebs vs. Zombies Credit */}
          <div className="max-w-md mx-auto w-full mt-4 flex items-center justify-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <span>From the creator of</span>
            <a
              href="https://plebsvszombies.cc"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-purple-600 dark:hover:text-purple-400 transition-colors font-medium"
            >
              <Image
                src="/plebs_vs_zombies_logo.svg"
                alt="Plebs vs. Zombies"
                width={20}
                height={20}
              />
              Plebs vs. Zombies
            </a>
          </div>
        </div>
      </div>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </>
  );
}
