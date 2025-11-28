'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useStore } from '@/lib/store';
import { RefreshCw, Users, User, VolumeX, ExternalLink, UserMinus, AlertCircle, X, Copy, Loader2, Search, Repeat } from 'lucide-react';
import { ReciprocalResult, Profile } from '@/types';
import UserProfileModal from './UserProfileModal';
import {
  checkReciprocalFollows,
  checkSpecificUserReciprocal,
  enrichMutealsWithProfiles,
  hexToNpub,
  npubToHex,
  unfollowUser,
  unfollowMultipleUsers,
  searchProfiles,
  fetchProfile,
  getFollowListPubkeys
} from '@/lib/nostr';
import { backupService } from '@/lib/backupService';

export default function Reciprocals() {
  const { session } = useAuth();
  const { muteList, addMutedItem } = useStore();
  const [checking, setChecking] = useState(false);
  const [allResults, setAllResults] = useState<ReciprocalResult[]>([]);
  const [displayedResults, setDisplayedResults] = useState<ReciprocalResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [copiedNpub, setCopiedNpub] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Search specific user states
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<ReciprocalResult | null>(null);
  const [searchingUser, setSearchingUser] = useState(false);
  const [profileSearchResults, setProfileSearchResults] = useState<Profile[]>([]);
  const [isSearchingProfiles, setIsSearchingProfiles] = useState(false);
  const [showProfileResults, setShowProfileResults] = useState(false);
  const searchDropdownRef = useRef<HTMLDivElement>(null);

  const handleCheckAll = async () => {
    if (!session) return;
    if (checking) return; // Prevent multiple concurrent checks

    // Create new abort controller for this check
    abortControllerRef.current = new AbortController();

    try {
      setChecking(true);
      setError(null);
      setAllResults([]);
      setDisplayedResults([]);
      setSearchResult(null);
      setProgress('Fetching your follow list...');

      // Get list of non-reciprocal follows (pubkeys only)
      const nonReciprocalPubkeys = await checkReciprocalFollows(
        session.pubkey,
        session.relays,
        (current, total) => {
          const percent = Math.round((current / total) * 100);
          // If current is much smaller than total at this point, we're in second pass
          if (total < 100 && current < total) {
            setProgress(`Second pass: Checking user relay preferences... ${current}/${total}`);
          } else {
            setProgress(`Checking ${current} of ${total} follows... (${percent}%)`);
          }
        },
        abortControllerRef.current?.signal
      );

      // Check for abort
      if (abortControllerRef.current?.signal.aborted) {
        setProgress('');
        setChecking(false);
        return;
      }

      if (nonReciprocalPubkeys.length === 0) {
        setAllResults([]);
        setDisplayedResults([]);
        setProgress('');
        setChecking(false);
        return;
      }

      // Convert to ReciprocalResult format
      const results: ReciprocalResult[] = nonReciprocalPubkeys.map(pubkey => ({
        pubkey,
        followsBack: false,
        checkedAt: Date.now()
      }));

      setAllResults(results);

      // Enrich with profiles (in batches of 5)
      setProgress(`Loading profiles for ${results.length} non-reciprocal follows...`);

      const enrichedResults: ReciprocalResult[] = [];
      const batchSize = 5;

      for (let i = 0; i < results.length; i += batchSize) {
        // Check for abort
        if (abortControllerRef.current?.signal.aborted) {
          break;
        }

        const batch = results.slice(i, i + batchSize);
        const profiles = await Promise.all(
          batch.map(async (result) => {
            try {
              const profile = await fetchProfile(result.pubkey, session.relays);
              return { ...result, profile: profile || undefined };
            } catch (err) {
              return result; // Return without profile if fetch fails
            }
          })
        );

        enrichedResults.push(...profiles);
        setDisplayedResults([...enrichedResults]);

        setProgress(`Loading profiles... ${enrichedResults.length}/${results.length}`);

        // Small delay to avoid overwhelming relays
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      setProgress('');
    } catch (err) {
      console.error('Check error:', err);
      setError(err instanceof Error ? err.message : 'Failed to check reciprocal follows');
      setProgress('');
    } finally {
      setChecking(false);
    }
  };

  const handleSearchUser = async () => {
    if (!session || !searchQuery.trim()) return;

    // Close the dropdown when search starts
    setShowProfileResults(false);

    try {
      setSearchingUser(true);
      setError(null);
      setSearchResult(null);
      setProgress('Looking up user...');

      let targetPubkey = searchQuery.trim();

      // Convert npub to hex if needed
      if (targetPubkey.startsWith('npub') || targetPubkey.startsWith('nprofile')) {
        try {
          targetPubkey = npubToHex(targetPubkey);
        } catch (err) {
          setError('Invalid npub format');
          setSearchingUser(false);
          setProgress('');
          return;
        }
      }
      // Search by username if not a pubkey
      else if (!targetPubkey.match(/^[0-9a-f]{64}$/i)) {
        setProgress('Searching for user...');
        const profiles = await searchProfiles(targetPubkey, session.relays, 10);
        if (profiles.length === 0) {
          setError(`No user found with username: "${targetPubkey}"`);
          setSearchingUser(false);
          setProgress('');
          return;
        }
        targetPubkey = profiles[0].pubkey;
      }

      setProgress('Checking reciprocity...');

      // Check if this user follows back
      const { followsBack, isFollowing } = await checkSpecificUserReciprocal(
        session.pubkey,
        targetPubkey,
        session.relays
      );

      if (!isFollowing) {
        setError("You don't follow this user, so reciprocity doesn't apply.");
        setSearchingUser(false);
        setProgress('');
        return;
      }

      // Fetch profile
      setProgress('Loading profile...');
      const profile = await fetchProfile(targetPubkey, session.relays);

      const result: ReciprocalResult = {
        pubkey: targetPubkey,
        profile: profile || undefined,
        followsBack,
        checkedAt: Date.now()
      };

      setSearchResult(result);
      setProgress('');
    } catch (err) {
      console.error('Search error:', err);
      setError(err instanceof Error ? err.message : 'Failed to check user');
      setProgress('');
    } finally {
      setSearchingUser(false);
    }
  };

  const handleAbort = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setProgress('Stopping...');
    }
  };

  const handleUnfollowAll = async () => {
    if (!session || allResults.length === 0) return;

    const confirmed = confirm(
      `Unfollow all ${allResults.length} non-reciprocal follow${allResults.length === 1 ? '' : 's'}?\n\n` +
      `This will:\n` +
      `• Create a backup of your follow list first\n` +
      `• Remove ${allResults.length} user${allResults.length === 1 ? '' : 's'} from your follow list\n` +
      `• Publish the updated list to your relays (one time)\n\n` +
      `This action cannot be undone (except by restoring from backup).`
    );

    if (!confirmed) return;

    try {
      setChecking(true);
      setProgress('Creating backup...');

      // Get current follows
      const currentFollows = await getFollowListPubkeys(session.pubkey, session.relays);

      // Create backup first
      const backup = backupService.createFollowListBackup(
        session.pubkey,
        currentFollows,
        `Auto-backup before unfollowing ${allResults.length} non-reciprocal follows`
      );
      backupService.saveBackup(backup);

      setProgress(`Publishing updated follow list (removing ${allResults.length} user${allResults.length === 1 ? '' : 's'})...`);

      // Unfollow all users at once (optimized - publishes once)
      const pubkeysToUnfollow = allResults.map(r => r.pubkey);
      await unfollowMultipleUsers(pubkeysToUnfollow, session.relays);

      setProgress('');
      alert(`Successfully unfollowed ${allResults.length} user${allResults.length === 1 ? '' : 's'}!`);

      // Clear results
      setAllResults([]);
      setDisplayedResults([]);
    } catch (err) {
      console.error('Unfollow error:', err);
      setError(err instanceof Error ? err.message : 'Failed to unfollow users');
    } finally {
      setChecking(false);
    }
  };

  const handleMuteAll = () => {
    if (allResults.length === 0) return;

    const confirmed = confirm(
      `Mute all ${allResults.length} non-reciprocal follow${allResults.length === 1 ? '' : 's'}?\n\n` +
      `This will add ${allResults.length} user${allResults.length === 1 ? '' : 's'} to your local mute list.\n` +
      `Remember to click "Publish Changes" in the My Mute List tab to save to relays.`
    );

    if (!confirmed) return;

    let addedCount = 0;

    allResults.forEach(result => {
      // Only add if not already muted
      const alreadyMuted = muteList.pubkeys.some(p => p.value === result.pubkey);
      if (!alreadyMuted) {
        addMutedItem(
          {
            type: 'pubkey',
            value: result.pubkey,
            reason: 'Non-reciprocal follow',
            private: false
          },
          'pubkeys'
        );
        addedCount++;
      }
    });

    if (addedCount > 0) {
      alert(`Added ${addedCount} user${addedCount === 1 ? '' : 's'} to your mute list.`);
    } else {
      alert('All users were already in your mute list.');
    }
  };

  const handleUnfollowSingle = async (pubkey: string) => {
    if (!session) return;

    const confirmed = confirm('Unfollow this user?\n\nA backup will be created before unfollowing.\nThis will publish the change to your relays immediately.');
    if (!confirmed) return;

    try {
      // Get current follows and create backup first
      const currentFollows = await getFollowListPubkeys(session.pubkey, session.relays);
      const backup = backupService.createFollowListBackup(
        session.pubkey,
        currentFollows,
        'Auto-backup before unfollowing user from Reciprocals'
      );
      backupService.saveBackup(backup);

      // Now unfollow
      await unfollowUser(pubkey, session.relays);

      // Remove from results
      setAllResults(prev => prev.filter(r => r.pubkey !== pubkey));
      setDisplayedResults(prev => prev.filter(r => r.pubkey !== pubkey));

      if (searchResult?.pubkey === pubkey) {
        setSearchResult(null);
      }

      alert('Successfully unfollowed! (Backup saved)');
    } catch (err) {
      console.error('Unfollow error:', err);
      alert('Failed to unfollow user');
    }
  };

  const handleMuteSingle = (pubkey: string) => {
    const alreadyMuted = muteList.pubkeys.some(p => p.value === pubkey);

    if (alreadyMuted) {
      alert('This user is already in your mute list.');
      return;
    }

    addMutedItem(
      {
        type: 'pubkey',
        value: pubkey,
        reason: 'Non-reciprocal follow',
        private: false
      },
      'pubkeys'
    );

    alert('Added to mute list. Remember to publish changes.');
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

  const handleViewProfile = (result: ReciprocalResult) => {
    setSelectedProfile(result.profile || { pubkey: result.pubkey });
  };

  // Real-time profile search as user types
  useEffect(() => {
    const searchUserProfiles = async () => {
      if (!session || !searchQuery.trim()) {
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
  }, [searchQuery, session]);

  const handleSelectProfile = (profile: Profile) => {
    setSearchQuery(profile.display_name || profile.name || profile.nip05 || '');
    setShowProfileResults(false);
  };

  const renderUserRow = (result: ReciprocalResult) => {
    const profile = result.profile;
    const displayName = profile?.display_name || profile?.name || (profile ? 'Anonymous' : 'Loading profile...');
    const npub = hexToNpub(result.pubkey);
    const isLoading = !profile;

    return (
      <div
        key={result.pubkey}
        className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <div
          className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden cursor-pointer"
          onClick={() => handleViewProfile(result)}
          title="View profile"
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
              {!isLoading && (
                result.followsBack ? (
                  <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded font-medium">
                    ✓ Follows back
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 rounded font-medium">
                    ✗ Doesn&apos;t follow back
                  </span>
                )
              )}
            </div>
            {profile?.nip05 && (
              <div className="text-xs text-green-600 dark:text-green-400 truncate">
                ✓ {profile.nip05}
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

          {/* Mute Button */}
          <button
            onClick={() => handleMuteSingle(result.pubkey)}
            className="p-2 text-red-600 dark:text-red-400 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
            title="Add to mute list"
          >
            <VolumeX size={16} />
          </button>

          {/* Unfollow Button */}
          <button
            onClick={() => handleUnfollowSingle(result.pubkey)}
            className="p-2 text-orange-600 dark:text-orange-400 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
            title="Unfollow"
          >
            <UserMinus size={16} />
          </button>

          {/* View on external site */}
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
  };

  if (!session) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
          <Users className="mx-auto mb-4 text-gray-400 dark:text-gray-500" size={48} />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Sign In Required
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Connect your Nostr account to check for reciprocal follows.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-start gap-3 mb-4">
          <Repeat className="text-red-600 dark:text-red-500 mt-1" size={24} />
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Reciprocals - Check Who Follows Back
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Find users you follow who don&apos;t follow you back. Check your entire follow list or search for a specific user.
            </p>
          </div>
        </div>

        {/* Info Box */}
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            <strong>Note:</strong> For users with many follows, this may take a while. The check includes a second pass that queries each user&apos;s preferred relays (NIP-65) to minimize false positives.
          </p>
        </div>
      </div>

      {/* Search Specific User */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Check Specific User
        </h3>

        <div className="relative" ref={searchDropdownRef}>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearchUser();
                    setShowProfileResults(false);
                  }
                }}
                onFocus={() => {
                  if (profileSearchResults.length > 0) {
                    setShowProfileResults(true);
                  }
                }}
                placeholder="Enter username, NIP-05, npub, or pubkey..."
                className="w-full px-4 py-3 pr-10 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
                disabled={searchingUser || checking}
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
              onClick={handleSearchUser}
              disabled={searchingUser || checking || !searchQuery.trim()}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {searchingUser ? (
                <>
                  <RefreshCw className="animate-spin" size={20} />
                  <span className="hidden sm:inline">Checking...</span>
                </>
              ) : (
                <>
                  <Search size={20} />
                  <span className="hidden sm:inline">Check</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Search Result */}
        {searchResult && (
          <div className="mt-4">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
              Result:
            </h4>
            {renderUserRow(searchResult)}
          </div>
        )}
      </div>

      {/* Check All Follows */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Check All Your Follows
        </h3>

        <div className="flex gap-2">
          <button
            onClick={handleCheckAll}
            disabled={checking}
            className="flex-1 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {checking ? (
              <>
                <RefreshCw className="animate-spin" size={20} />
                Checking...
              </>
            ) : (
              <>
                <Users size={20} />
                Check All My Follows
              </>
            )}
          </button>

          {checking && (
            <button
              onClick={handleAbort}
              className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium flex items-center gap-2"
              title="Stop checking"
            >
              <X size={20} />
              <span className="hidden sm:inline">Stop</span>
            </button>
          )}
        </div>

        {/* Progress Display */}
        {checking && progress && (
          <div className="mt-4 p-4 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-2 border-blue-200 dark:border-blue-700 rounded-lg">
            <div className="flex items-center space-x-3">
              <RefreshCw className="animate-spin text-blue-600 dark:text-blue-400" size={20} />
              <div className="text-blue-900 dark:text-blue-100 font-medium">
                {progress}
              </div>
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
      {!checking && displayedResults.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="mb-4">
            <div className="flex items-start justify-between gap-4 mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {allResults.length} Non-Reciprocal Follow{allResults.length === 1 ? '' : 's'}
              </h3>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={handleMuteAll}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium text-sm flex items-center gap-2"
                  title="Add all to mute list"
                >
                  <VolumeX size={16} />
                  <span className="hidden sm:inline">Mute All</span>
                </button>
                <button
                  onClick={handleUnfollowAll}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium text-sm flex items-center gap-2"
                  title="Unfollow all"
                >
                  <UserMinus size={16} />
                  <span className="hidden sm:inline">Unfollow All</span>
                </button>
              </div>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              These users don&apos;t follow you back (or have private follow lists).
            </p>
          </div>

          <div className="space-y-3">
            {displayedResults.map(renderUserRow)}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!checking && !searchResult && allResults.length === 0 && (displayedResults.length > 0 || !error) && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
          <Users className="mx-auto mb-3 text-green-500" size={48} />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            All Clear!
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Everyone you follow follows you back, or you haven&apos;t run a check yet.
          </p>
        </div>
      )}

      {/* User Profile Modal */}
      {selectedProfile && (
        <UserProfileModal
          profile={selectedProfile}
          onClose={() => setSelectedProfile(null)}
        />
      )}
    </div>
  );
}
