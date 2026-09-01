"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import AuthModal from "@/components/AuthModal";
import SnoopableGlasses from "@/components/SnoopableGlasses";
import { Lock, User, Loader2, Flag, Trash2, Search } from "lucide-react";
import { searchProfiles, hexToNpub, DEFAULT_RELAYS } from "@/lib/nostr";
import { Profile } from "@/types";

export default function Home() {
  const router = useRouter();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [resolvedPubkey, setResolvedPubkey] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [profileSearchResults, setProfileSearchResults] = useState<Profile[]>(
    [],
  );
  const [isSearchingProfiles, setIsSearchingProfiles] = useState(false);
  const [showProfileResults, setShowProfileResults] = useState(false);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
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

      // A profile was just picked — its pubkey is stored, so don't re-search
      // the display name and reopen the dropdown over the lens buttons.
      // Editing the input clears the pick and searching resumes.
      if (resolvedPubkey) {
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
  }, [searchQuery, resolvedPubkey]);

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

  // One lookup feeds every no-sign-in tool: resolve whatever was typed
  // (npub/nprofile passes through, hex converts, names/NIP-05 resolve via
  // profile search) into an npub, then jump to the chosen lens. With an
  // empty field the lens buttons simply open that tool's own home screen.
  const handleToolSearch = async (path: string) => {
    const query = searchQuery.trim();
    if (resolving) return;
    setShowProfileResults(false);

    if (!query) {
      router.push(path);
      return;
    }

    if (resolvedPubkey) {
      router.push(
        `${path}?npub=${encodeURIComponent(hexToNpub(resolvedPubkey))}`,
      );
      return;
    }

    setResolving(true);
    setLookupError(null);
    try {
      let target: string;
      if (query.startsWith("npub") || query.startsWith("nprofile")) {
        target = query;
      } else if (query.match(/^[0-9a-f]{64}$/i)) {
        target = hexToNpub(query);
      } else {
        const profiles = await searchProfiles(query, DEFAULT_RELAYS, 10);
        if (profiles.length === 0) {
          setLookupError(
            `No user found for "${query}". Try a name, NIP-05, or npub.`,
          );
          return;
        }
        target = hexToNpub(profiles[0].pubkey);
      }
      router.push(`${path}?npub=${encodeURIComponent(target)}`);
    } catch (error) {
      console.error("Failed to resolve user:", error);
      setLookupError("Could not resolve that user. Please try again.");
    } finally {
      setResolving(false);
    }
  };

  // Picking from the dropdown stores the pubkey so clicking a lens needs no
  // second relay round trip.
  const handleSelectProfile = (profile: Profile) => {
    setSearchQuery(profile.display_name || profile.name || profile.nip05 || "");
    setResolvedPubkey(profile.pubkey);
    setLookupError(null);
    setShowProfileResults(false);
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
            </div>
          </div>

          {/* Universal No-Sign-In Lookup — one field feeds every anonymous
              tool: resolve a name, NIP-05, or npub once, then pick the lens
              to open it in. */}
          <div className="max-w-md mx-auto w-full mt-8 p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="flex items-start gap-3 mb-4">
              <Search
                size={24}
                className="text-red-600 dark:text-red-400 flex-shrink-0 mt-1"
              />
              <div className="text-left">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                  Look Up Any User - No Login Required
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Enter a username, NIP-05, or npub and pick a lens — or open
                  any lens directly to explore.
                </p>
              </div>
            </div>

            <div className="relative" ref={searchDropdownRef}>
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setResolvedPubkey(null);
                    setLookupError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setShowProfileResults(false);
                      handleToolSearch("/mute-o-scope");
                    }
                  }}
                  onFocus={() => {
                    if (profileSearchResults.length > 0) {
                      setShowProfileResults(true);
                    }
                  }}
                  placeholder="Enter npub, NIP-05, or username..."
                  className="w-full px-4 py-2 pr-10 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm"
                />
                {(resolving || isSearchingProfiles) && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Loader2 size={16} className="animate-spin text-gray-400" />
                  </div>
                )}
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

            {/* Lens buttons — NEW stays on both Reportable and Redactable */}
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button
                onClick={() => handleToolSearch("/mute-o-scope")}
                title="Who is publicly muting them"
                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center justify-center gap-1.5 text-sm"
              >
                <Image
                  src="/mute_o_scope_icon_white.svg"
                  alt=""
                  width={16}
                  height={16}
                />
                Mute-o-Scope
              </button>
              <button
                onClick={() => handleToolSearch("/snoopable")}
                title="How public their activity really is"
                className="px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium flex items-center justify-center gap-1.5 text-sm"
              >
                <SnoopableGlasses className="flex-shrink-0" />
                Snoopable
              </button>
              <button
                onClick={() => handleToolSearch("/reportable")}
                title="Public reports filed about them — and by them"
                className="px-3 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium flex items-center justify-center gap-1.5 text-sm"
              >
                <Flag size={16} />
                Reportable
                <span className="text-[10px] font-bold px-1 py-px bg-orange-800 rounded">
                  NEW
                </span>
              </button>
              <button
                onClick={() => handleToolSearch("/redactable")}
                title="Their deletion requests and deleted posts"
                className="px-3 py-2 bg-black text-white rounded-lg hover:bg-gray-800 dark:ring-1 dark:ring-gray-600 transition-colors font-medium flex items-center justify-center gap-1.5 text-sm"
              >
                <Trash2 size={16} />
                Redactable
                <span className="text-[10px] font-bold px-1 py-px bg-gray-800 rounded">
                  NEW
                </span>
              </button>
            </div>

            {lookupError && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                {lookupError}
              </p>
            )}
          </div>

          {/* Creator credits */}
          <div className="max-w-md mx-auto w-full mt-4 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
            <span className="whitespace-nowrap">From the creator of</span>
            <a
              href="https://plebsvszombies.cc"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 whitespace-nowrap hover:text-purple-600 dark:hover:text-purple-400 transition-colors font-medium"
            >
              <Image
                src="/plebs_vs_zombies_logo.svg"
                alt="Plebs vs. Zombies"
                width={20}
                height={20}
              />
              Plebs vs. Zombies
            </a>
            <span>and</span>
            <a
              href="https://sidecar.top"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 whitespace-nowrap hover:text-red-600 dark:hover:text-red-400 transition-colors font-medium"
            >
              <Image
                src="/sidecar_icon.svg"
                alt="Sidecar"
                width={18}
                height={20}
              />
              Sidecar
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
