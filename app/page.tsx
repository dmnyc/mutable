'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import AuthModal from '@/components/AuthModal';
import { Lock, Unlock, Search, User, Loader2 } from 'lucide-react';
import { searchProfiles, hexToNpub } from '@/lib/nostr';
import { Profile } from '@/types';

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.wine',
  'wss://relay.snort.social'
];

export default function Home() {
  const router = useRouter();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [profileSearchResults, setProfileSearchResults] = useState<Profile[]>([]);
  const [isSearchingProfiles, setIsSearchingProfiles] = useState(false);
  const [showProfileResults, setShowProfileResults] = useState(false);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const { isConnected } = useAuth();

  useEffect(() => {
    if (isConnected) {
      router.push('/dashboard');
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
      if (searchQuery.startsWith('npub') || searchQuery.startsWith('nprofile') || searchQuery.match(/^[0-9a-f]{64}$/i)) {
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
        console.error('Profile search failed:', error);
        setProfileSearchResults([]);
      } finally {
        setIsSearchingProfiles(false);
      }
    };

    // Debounce search - wait 300ms after user stops typing
    const timeoutId = setTimeout(searchUserProfiles, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

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

  const handleSearch = () => {
    if (searchQuery.trim()) {
      router.push(`/mute-o-scope?npub=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
      setShowProfileResults(false);
    }
  };

  const handleSelectProfile = (profile: Profile) => {
    const displayName = profile.display_name || profile.name || profile.nip05 || '';
    setSearchQuery(displayName);
    setShowProfileResults(false);
    // Navigate immediately when profile is selected - convert hex to npub
    const npub = hexToNpub(profile.pubkey);
    router.push(`/mute-o-scope?npub=${encodeURIComponent(npub)}`);
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
                <span className="text-xs font-bold px-1.5 py-0.5 bg-purple-800 rounded">NEW</span>
              </Link>
            </div>
          </div>

          {/* Mute-o-Scope Info Card */}
          <div className="max-w-md mx-auto w-full mt-8 p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="flex items-start gap-3 mb-4">
              <Unlock className="text-green-600 dark:text-green-400 flex-shrink-0 mt-1" size={24} />
              <div className="text-left">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                  Try Mute-o-Scope - No Login Required
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Search any npub to see who is publicly muting them. Perfect for checking your reputation or investigating profiles.
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
                      <Loader2 size={16} className="animate-spin text-gray-400" />
                    </div>
                  )}
                </div>
                <button
                  onClick={handleSearch}
                  disabled={!searchQuery.trim()}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Search size={16} />
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
