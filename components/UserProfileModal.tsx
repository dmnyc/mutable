'use client';

import { useEffect, useState } from 'react';
import { Profile, MuteList } from '@/types';
import { fetchMuteList, parseMuteListEvent, hexToNpub, isFollowing, unfollowUser, fetchProfile } from '@/lib/nostr';
import { useStore } from '@/lib/store';
import { useAuth } from '@/hooks/useAuth';
import {
  X,
  Copy,
  ExternalLink,
  UserX,
  UserCheck,
  Download,
  Loader2,
  UserMinus,
  ChevronDown,
  ChevronRight,
  VolumeX,
  Volume2,
  Search
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

interface UserProfileModalProps {
  profile: Profile;
  onClose: () => void;
}

export default function UserProfileModal({ profile, onClose }: UserProfileModalProps) {
  const { session } = useAuth();
  const { muteList, addMutedItem, removeMutedItem } = useStore();
  const [userMuteList, setUserMuteList] = useState<MuteList | null>(null);
  const [loadingMuteList, setLoadingMuteList] = useState(false);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [isFollowingUser, setIsFollowingUser] = useState(false);
  const [checkingFollow, setCheckingFollow] = useState(true);
  const [unfollowing, setUnfollowing] = useState(false);
  const [mutedProfiles, setMutedProfiles] = useState<Map<string, Profile>>(new Map());
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [displayedPubkeysCount, setDisplayedPubkeysCount] = useState(100);
  const [expandedSections, setExpandedSections] = useState<{
    pubkeys: boolean;
    words: boolean;
    tags: boolean;
    threads: boolean;
  }>({
    pubkeys: false,
    words: false,
    tags: false,
    threads: false
  });
  const [checkingIfMutingMe, setCheckingIfMutingMe] = useState(false);
  const [isMutingMe, setIsMutingMe] = useState<boolean | null>(null);

  // Check if this user is currently muted
  const isMuted = muteList.pubkeys.some(item => item.value === profile.pubkey);

  // Load user's mute list and check follow status
  useEffect(() => {
    const loadUserData = async () => {
      if (!session) return;

      // Load mute list
      setLoadingMuteList(true);
      try {
        const event = await fetchMuteList(profile.pubkey, session.relays);
        if (event) {
          const parsed = await parseMuteListEvent(event);
          setUserMuteList(parsed);
        }
      } catch (error) {
        console.error('Failed to load user mute list:', error);
      } finally {
        setLoadingMuteList(false);
      }

      // Check if following
      setCheckingFollow(true);
      try {
        const following = await isFollowing(profile.pubkey, session.pubkey, session.relays);
        setIsFollowingUser(following);
      } catch (error) {
        console.error('Failed to check follow status:', error);
      } finally {
        setCheckingFollow(false);
      }
    };

    loadUserData();
  }, [profile.pubkey, session]);

  const handleMute = () => {
    addMutedItem(
      { type: 'pubkey', value: profile.pubkey },
      'pubkeys'
    );
  };

  const handleUnmute = () => {
    removeMutedItem(profile.pubkey, 'pubkeys');
  };

  const handleUnfollow = async () => {
    if (!session) return;

    setUnfollowing(true);
    try {
      await unfollowUser(profile.pubkey, session.relays);
      setIsFollowingUser(false);
      alert(`Successfully unfollowed ${getDisplayName()}`);
    } catch (error) {
      console.error('Failed to unfollow:', error);
      alert('Failed to unfollow user. Please try again.');
    } finally {
      setUnfollowing(false);
    }
  };

  const handleMergeMuteList = () => {
    if (!userMuteList) return;

    let addedCount = 0;

    // Merge pubkeys
    userMuteList.pubkeys.forEach(item => {
      const exists = muteList.pubkeys.some(m => m.value === item.value);
      if (!exists) {
        addMutedItem(item, 'pubkeys');
        addedCount++;
      }
    });

    // Merge words
    userMuteList.words.forEach(item => {
      const exists = muteList.words.some(m => m.value === item.value);
      if (!exists) {
        addMutedItem(item, 'words');
        addedCount++;
      }
    });

    // Merge tags
    userMuteList.tags.forEach(item => {
      const exists = muteList.tags.some(m => m.value === item.value);
      if (!exists) {
        addMutedItem(item, 'tags');
        addedCount++;
      }
    });

    // Merge threads
    userMuteList.threads.forEach(item => {
      const exists = muteList.threads.some(m => m.value === item.value);
      if (!exists) {
        addMutedItem(item, 'threads');
        addedCount++;
      }
    });

    alert(`Successfully merged ${addedCount} new items from ${getDisplayName()}'s mute list!`);
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(label);
      setTimeout(() => setCopySuccess(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const getDisplayName = () => {
    return profile.display_name || profile.name || 'Anonymous';
  };

  const getTruncatedNpub = (pubkey: string) => {
    const npub = hexToNpub(pubkey);
    return `${npub.slice(0, 16)}...${npub.slice(-16)}`;
  };

  const getTotalMutedItems = () => {
    if (!userMuteList) return 0;
    return (
      userMuteList.pubkeys.length +
      userMuteList.words.length +
      userMuteList.tags.length +
      userMuteList.threads.length
    );
  };

  const toggleSection = async (section: keyof typeof expandedSections) => {
    const newExpanded = !expandedSections[section];
    setExpandedSections(prev => ({
      ...prev,
      [section]: newExpanded
    }));

    // Load profiles when expanding pubkeys section
    if (section === 'pubkeys' && newExpanded && userMuteList && mutedProfiles.size === 0) {
      await loadMutedProfiles();
    }
  };

  const loadMutedProfiles = async (startIndex = 0, count = displayedPubkeysCount) => {
    if (!userMuteList || !session) return;

    setLoadingProfiles(true);
    const profilesMap = new Map<string, Profile>(mutedProfiles);

    // Only fetch profiles for the current batch
    const pubkeysToLoad = userMuteList.pubkeys.slice(startIndex, startIndex + count);

    const fetchPromises = pubkeysToLoad.map(async (item) => {
      // Skip if already loaded
      if (profilesMap.has(item.value)) return;

      try {
        const profile = await fetchProfile(item.value, session.relays);
        if (profile) {
          profilesMap.set(item.value, profile);
        }
      } catch (error) {
        console.error(`Failed to fetch profile for ${item.value}:`, error);
      }
    });

    await Promise.allSettled(fetchPromises);
    setMutedProfiles(profilesMap);
    setLoadingProfiles(false);
  };

  const handleLoadMore = () => {
    const newCount = displayedPubkeysCount + 100;
    setDisplayedPubkeysCount(newCount);
    loadMutedProfiles(displayedPubkeysCount, 100);
  };

  const getProfileDisplayName = (pubkey: string) => {
    const profile = mutedProfiles.get(pubkey);
    return profile?.display_name || profile?.name || null;
  };

  const handleCheckIfMutingMe = async () => {
    if (!session) return;

    setCheckingIfMutingMe(true);
    try {
      // Fetch their public mute list if not already loaded
      let muteList = userMuteList;
      if (!muteList) {
        const event = await fetchMuteList(profile.pubkey, session.relays);
        if (event) {
          muteList = await parseMuteListEvent(event);
        }
      }

      // Check if my pubkey is in their public mute list
      if (muteList) {
        const isMuted = muteList.pubkeys.some(item => item.value === session.pubkey);
        setIsMutingMe(isMuted);
      } else {
        setIsMutingMe(false);
      }
    } catch (error) {
      console.error('Failed to check if user is muting me:', error);
      setIsMutingMe(null);
    } finally {
      setCheckingIfMutingMe(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-6 flex items-start justify-between">
          <div className="flex items-start space-x-4 flex-1">
            {profile.picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.picture}
                alt={getDisplayName()}
                className="w-16 h-16 rounded-full object-cover flex-shrink-0"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/%3E%3Cpath d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/%3E%3C/svg%3E';
                }}
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
                <span className="text-gray-600 dark:text-gray-300 text-xl font-medium">
                  {getDisplayName()[0].toUpperCase()}
                </span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                {getDisplayName()}
              </h2>
              {profile.nip05 && (
                <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                  ✓ {profile.nip05}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* About */}
          {profile.about && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                About
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                {profile.about}
              </p>
            </div>
          )}

          {/* Public Key */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Public Key
            </h3>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-gray-100 dark:bg-gray-700 px-3 py-2 rounded font-mono text-gray-900 dark:text-white overflow-x-auto">
                {getTruncatedNpub(profile.pubkey)}
              </code>
              <button
                onClick={() => copyToClipboard(hexToNpub(profile.pubkey), 'npub')}
                className="p-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                title="Copy npub"
              >
                {copySuccess === 'npub' ? <UserCheck size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            {session && (
              isMuted ? (
                <button
                  onClick={handleUnmute}
                  className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  <UserCheck size={16} />
                  <span>Unmute User</span>
                </button>
              ) : (
                <button
                  onClick={handleMute}
                  className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  <UserX size={16} />
                  <span>Mute User</span>
                </button>
              )
            )}

            {isFollowingUser && !checkingFollow && (
              <button
                onClick={handleUnfollow}
                disabled={unfollowing}
                className="flex items-center space-x-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:bg-orange-400 disabled:cursor-not-allowed"
              >
                <UserMinus size={16} />
                <span>{unfollowing ? 'Unfollowing...' : 'Unfollow'}</span>
              </button>
            )}

            <button
              onClick={() => window.open(`https://npub.world/${hexToNpub(profile.pubkey)}`, '_blank')}
              className="flex items-center space-x-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              <ExternalLink size={16} />
              <span>View Profile</span>
            </button>
          </div>

          {/* Check if muting me */}
          {session && (
            <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-4 bg-gray-50 dark:bg-gray-700">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
                    Is {getDisplayName()} muting me publicly?
                  </h4>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    Check if this user has you in their public mute list
                  </p>
                </div>
                <button
                  onClick={handleCheckIfMutingMe}
                  disabled={checkingIfMutingMe}
                  className="ml-4 flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-blue-400 disabled:cursor-not-allowed"
                >
                  {checkingIfMutingMe ? (
                    <>
                      <Loader2 className="animate-spin" size={16} />
                      <span>Checking...</span>
                    </>
                  ) : (
                    <span>Check</span>
                  )}
                </button>
              </div>
            {isMutingMe !== null && (
              <div className={`mt-3 p-3 rounded-lg ${
                isMutingMe
                  ? 'bg-red-100 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                  : 'bg-green-100 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
              }`}>
                <p className={`text-sm font-medium ${
                  isMutingMe
                    ? 'text-red-800 dark:text-red-200'
                    : 'text-green-800 dark:text-green-200'
                }`}>
                  {isMutingMe
                    ? `⚠️ Yes, ${getDisplayName()} is publicly muting you`
                    : `✓ No, ${getDisplayName()} is not publicly muting you`}
                </p>
              </div>
            )}
            </div>
          )}

          {/* Mute-o-Scope Link */}
          <div className="border border-purple-200 dark:border-purple-600 rounded-lg p-4 bg-purple-50 dark:bg-purple-900/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1">
                <Image
                  src="/mute_o_scope_icon_white.svg"
                  alt="Mute-o-Scope"
                  width={32}
                  height={32}
                  className="flex-shrink-0"
                />
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
                    See who is muting {getDisplayName()}
                  </h4>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    Use Mute-o-Scope to search public mute lists network-wide
                  </p>
                </div>
              </div>
              <Link
                href={`/mute-o-scope?npub=${hexToNpub(profile.pubkey)}`}
                target="_blank"
                className="ml-4 flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                <Search size={16} />
                <span className="whitespace-nowrap">Search</span>
              </Link>
            </div>
          </div>

          {/* User's Mute List */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              {getDisplayName()}&apos;s Mute List
            </h3>

            {loadingMuteList ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="animate-spin text-gray-400" size={32} />
                <span className="ml-3 text-gray-600 dark:text-gray-400">
                  Loading mute list...
                </span>
              </div>
            ) : userMuteList ? (
              <div className="space-y-4">
                {/* Muted Users */}
                {userMuteList.pubkeys.length > 0 && (
                  <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleSection('pubkeys')}
                      className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                    >
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        Muted Users ({userMuteList.pubkeys.length})
                      </span>
                      {expandedSections.pubkeys ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    {expandedSections.pubkeys && (
                      <div className="p-4 space-y-2 max-h-96 overflow-y-auto">
                        {loadingProfiles && mutedProfiles.size === 0 ? (
                          <div className="flex items-center justify-center py-4">
                            <Loader2 className="animate-spin text-gray-400" size={20} />
                            <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">
                              Loading profiles...
                            </span>
                          </div>
                        ) : (
                          <>
                            {userMuteList.pubkeys.slice(0, displayedPubkeysCount).map((item, idx) => {
                              const profile = mutedProfiles.get(item.value);
                              const displayName = profile?.display_name || profile?.name;
                              const isAlreadyMuted = muteList.pubkeys.some(m => m.value === item.value);

                              return (
                                <div key={idx} className="flex items-center justify-between bg-white dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-600">
                                <div className="flex items-center space-x-3 flex-1 min-w-0">
                                  {profile?.picture ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={profile.picture}
                                      alt={displayName || 'User'}
                                      className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/%3E%3Cpath d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/%3E%3C/svg%3E';
                                      }}
                                    />
                                  ) : (
                                    <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
                                      <span className="text-gray-600 dark:text-gray-300 text-sm font-medium">
                                        {displayName ? displayName[0].toUpperCase() : '?'}
                                      </span>
                                    </div>
                                  )}

                                  <div className="flex-1 min-w-0">
                                    {displayName ? (
                                      <>
                                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                          {displayName}
                                        </p>
                                        {profile?.nip05 && (
                                          <p className="text-xs text-green-600 dark:text-green-400 truncate">
                                            ✓ {profile.nip05}
                                          </p>
                                        )}
                                        <p className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate">
                                          {hexToNpub(item.value).slice(0, 16)}...
                                        </p>
                                      </>
                                    ) : (
                                      <p className="text-xs text-gray-600 dark:text-gray-400 font-mono">
                                        {hexToNpub(item.value).slice(0, 20)}...{hexToNpub(item.value).slice(-8)}
                                      </p>
                                    )}
                                    {item.reason && (
                                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 italic">
                                        Reason: {item.reason}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                  <button
                                    onClick={() => copyToClipboard(hexToNpub(item.value), `muted-${item.value}`)}
                                    className="p-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                                    title="Copy npub"
                                  >
                                    {copySuccess === `muted-${item.value}` ? <UserCheck size={16} /> : <Copy size={16} />}
                                  </button>
                                  {isAlreadyMuted ? (
                                    <button
                                      onClick={() => {
                                        removeMutedItem(item.value, 'pubkeys');
                                      }}
                                      className="p-2 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                                      title="Already muted - click to unmute"
                                    >
                                      <VolumeX size={16} />
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        addMutedItem({ type: 'pubkey', value: item.value, reason: item.reason }, 'pubkeys');
                                      }}
                                      className="p-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                                      title="Mute this user"
                                    >
                                      <Volume2 size={16} />
                                    </button>
                                  )}
                                  <button
                                    onClick={() => window.open(`https://npub.world/${hexToNpub(item.value)}`, '_blank')}
                                    className="p-2 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                                    title="View profile"
                                  >
                                    <ExternalLink size={16} />
                                  </button>
                                </div>
                                </div>
                              );
                            })}

                          {/* Load More Button */}
                          {displayedPubkeysCount < userMuteList.pubkeys.length && (
                            <button
                              onClick={handleLoadMore}
                              disabled={loadingProfiles}
                              className="w-full mt-4 py-2 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium disabled:opacity-50"
                            >
                              {loadingProfiles ? (
                                <span className="flex items-center justify-center gap-2">
                                  <Loader2 className="animate-spin" size={16} />
                                  Loading...
                                </span>
                              ) : (
                                `Load More (${userMuteList.pubkeys.length - displayedPubkeysCount} remaining)`
                              )}
                            </button>
                          )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Muted Words */}
                {userMuteList.words.length > 0 && (
                  <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleSection('words')}
                      className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                    >
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        Muted Words ({userMuteList.words.length})
                      </span>
                      {expandedSections.words ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    {expandedSections.words && (
                      <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
                        {userMuteList.words.map((item, idx) => (
                          <div key={idx} className="text-sm bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-600">
                            <span className="font-medium text-gray-900 dark:text-white">{item.value}</span>
                            {item.reason && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{item.reason}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Muted Tags */}
                {userMuteList.tags.length > 0 && (
                  <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleSection('tags')}
                      className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                    >
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        Muted Tags ({userMuteList.tags.length})
                      </span>
                      {expandedSections.tags ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    {expandedSections.tags && (
                      <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
                        {userMuteList.tags.map((item, idx) => (
                          <div key={idx} className="text-sm bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-600">
                            <span className="font-medium text-gray-900 dark:text-white">#{item.value}</span>
                            {item.reason && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{item.reason}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Muted Threads */}
                {userMuteList.threads.length > 0 && (
                  <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleSection('threads')}
                      className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                    >
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        Muted Threads ({userMuteList.threads.length})
                      </span>
                      {expandedSections.threads ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    {expandedSections.threads && (
                      <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
                        {userMuteList.threads.map((item, idx) => (
                          <div key={idx} className="text-xs bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-600">
                            <code className="font-mono text-gray-900 dark:text-white">
                              {item.value.slice(0, 16)}...{item.value.slice(-16)}
                            </code>
                            {item.reason && (
                              <p className="text-gray-500 dark:text-gray-400 mt-1">{item.reason}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {getTotalMutedItems() === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic text-center py-4">
                    This user&apos;s mute list is empty
                  </p>
                )}

                {getTotalMutedItems() > 0 && (
                  <button
                    onClick={handleMergeMuteList}
                    className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                  >
                    <Download size={16} />
                    <span>Merge Their Mute List with Mine</span>
                  </button>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic text-center py-4">
                This user doesn&apos;t have a public mute list
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
