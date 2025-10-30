'use client';

import { useState, useEffect, useRef } from 'react';
import { useStore } from '@/lib/store';
import { batchCheckAccountActivity } from '@/lib/nostr';
import { hexToNpub, fetchProfile } from '@/lib/nostr';
import { AccountActivityStatus, Profile } from '@/types';
import {
  Trash2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  User,
  Calendar,
  Activity,
  Eye,
  EyeOff,
  Sliders,
  ExternalLink,
  Copy,
  Sparkles
} from 'lucide-react';

export default function ListCleaner() {
  const { muteList, session, removeMutedItem, addToBlacklist, removeFromBlacklist, blacklistedPubkeys, isBlacklisted } = useStore();

  // Scan state
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [scanResults, setScanResults] = useState<AccountActivityStatus[]>([]);
  const [inactivityThreshold, setInactivityThreshold] = useState(180); // days

  // UI state
  const [showInactive, setShowInactive] = useState(true);
  const [showActive, setShowActive] = useState(false);
  const [showBlacklist, setShowBlacklist] = useState(false);
  const [profilesMap, setProfilesMap] = useState<Map<string, Profile>>(new Map());
  const [loadingProfiles, setLoadingProfiles] = useState<Set<string>>(new Set());
  const [blacklistProfilesMap, setBlacklistProfilesMap] = useState<Map<string, Profile>>(new Map());

  // Abort controller for cancelling scan
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load profiles for blacklisted pubkeys
  useEffect(() => {
    if (!showBlacklist || blacklistedPubkeys.size === 0 || !session) return;

    const loadBlacklistProfiles = async () => {
      const pubkeysToLoad = Array.from(blacklistedPubkeys)
        .filter(pk => !blacklistProfilesMap.has(pk))
        .slice(0, 20); // Load 20 at a time

      if (pubkeysToLoad.length === 0) return;

      const profilePromises = pubkeysToLoad.map(async (pubkey) => {
        try {
          const profile = await fetchProfile(pubkey, session.relays);
          return { pubkey, profile };
        } catch (error) {
          return { pubkey, profile: null };
        }
      });

      const results = await Promise.allSettled(profilePromises);

      setBlacklistProfilesMap(prev => {
        const next = new Map(prev);
        results.forEach(result => {
          if (result.status === 'fulfilled' && result.value.profile) {
            next.set(result.value.pubkey, result.value.profile);
          }
        });
        return next;
      });
    };

    loadBlacklistProfiles();
  }, [showBlacklist, blacklistedPubkeys, blacklistProfilesMap, session]);

  // Load profiles for scan results
  useEffect(() => {
    if (scanResults.length === 0) return;

    const loadProfiles = async () => {
      const pubkeysToLoad = scanResults
        .map(r => r.pubkey)
        .filter(pk => !profilesMap.has(pk) && !loadingProfiles.has(pk))
        .slice(0, 20); // Load 20 at a time

      if (pubkeysToLoad.length === 0) return;

      // Mark as loading
      setLoadingProfiles(prev => {
        const next = new Set(prev);
        pubkeysToLoad.forEach(pk => next.add(pk));
        return next;
      });

      // Fetch profiles
      const profilePromises = pubkeysToLoad.map(async (pubkey) => {
        try {
          const profile = await fetchProfile(pubkey, session?.relays || []);
          return { pubkey, profile };
        } catch (error) {
          return { pubkey, profile: null };
        }
      });

      const results = await Promise.allSettled(profilePromises);

      // Update profiles map
      setProfilesMap(prev => {
        const next = new Map(prev);
        results.forEach(result => {
          if (result.status === 'fulfilled' && result.value.profile) {
            next.set(result.value.pubkey, result.value.profile);
          }
        });
        return next;
      });

      // Remove from loading
      setLoadingProfiles(prev => {
        const next = new Set(prev);
        pubkeysToLoad.forEach(pk => next.delete(pk));
        return next;
      });
    };

    loadProfiles();
  }, [scanResults, profilesMap, loadingProfiles, session?.relays]);

  const handleStartScan = async () => {
    if (!session) return;

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    setIsScanning(true);
    setScanResults([]);
    setScanProgress({ current: 0, total: muteList.pubkeys.length });

    try {
      const pubkeys = muteList.pubkeys.map(p => p.value);

      const results = await batchCheckAccountActivity(
        pubkeys,
        session.relays,
        inactivityThreshold,
        (current, total) => {
          setScanProgress({ current, total });
        },
        abortControllerRef.current.signal
      );

      setScanResults(results);
    } catch (error) {
      console.error('Scan failed:', error);
    } finally {
      setIsScanning(false);
      abortControllerRef.current = null;
    }
  };

  const handleAbortScan = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsScanning(false);
    }
  };

  const handleRemoveAccount = (pubkey: string) => {
    removeMutedItem(pubkey, 'pubkeys');
    addToBlacklist(pubkey);

    // Remove from scan results
    setScanResults(prev => prev.filter(r => r.pubkey !== pubkey));
  };

  const handleBulkRemove = () => {
    const inactiveAccounts = scanResults.filter(r => r.isLikelyAbandoned);

    inactiveAccounts.forEach(account => {
      removeMutedItem(account.pubkey, 'pubkeys');
      addToBlacklist(account.pubkey);
    });

    setScanResults([]);
  };

  const handleRemoveFromBlacklist = (pubkey: string) => {
    removeFromBlacklist(pubkey);
  };

  const handleCopyNpub = (pubkey: string) => {
    const npub = hexToNpub(pubkey);
    navigator.clipboard.writeText(npub);
    // Could add a toast notification here
  };

  const formatDate = (timestamp: number | null) => {
    if (!timestamp) return 'Unknown';
    return new Date(timestamp * 1000).toLocaleDateString();
  };

  const getDisplayName = (pubkey: string, profile: Profile | undefined) => {
    if (profile) {
      return profile.display_name || profile.name || hexToNpub(pubkey).slice(0, 12) + '...';
    }
    return hexToNpub(pubkey).slice(0, 12) + '...';
  };

  // Filter results based on view toggle
  const filteredResults = scanResults.filter(result => {
    if (showInactive && result.isLikelyAbandoned) return true;
    if (showActive && !result.isLikelyAbandoned) return true;
    return false;
  });

  const inactiveCount = scanResults.filter(r => r.isLikelyAbandoned).length;
  const activeCount = scanResults.filter(r => !r.isLikelyAbandoned).length;

  if (!session) {
    return (
      <div className="p-8 text-center">
        <AlertTriangle className="mx-auto mb-4 text-yellow-500" size={48} />
        <h2 className="text-xl font-bold mb-2">Not Connected</h2>
        <p className="text-gray-600 dark:text-gray-400">
          Please connect your Nostr profile to use the List Cleaner.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Sparkles size={24} />
          List Cleaner
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-3">
          Scan your mute list for inactive or abandoned profiles. Removed profiles are added to a blacklist to prevent re-importing.
        </p>

        {/* Accuracy Disclaimer */}
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 flex gap-3">
          <AlertTriangle size={20} className="text-yellow-600 dark:text-yellow-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-yellow-800 dark:text-yellow-200">
            <p className="font-semibold mb-1">Data Accuracy Notice</p>
            <p>
              This scan queries multiple popular relays to find user activity, but cannot check every relay where a user might post.
              Some active users may be incorrectly flagged as inactive if their content is not available on the queried relays.
              You can always verify by clicking "View Profile" before removing a profile.
            </p>
          </div>
        </div>
      </div>

      {/* Scan Controls */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold mb-1">Inactivity Threshold</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Profiles with no activity for this many days will be flagged
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Sliders size={20} className="text-gray-400" />
              <input
                type="range"
                min="30"
                max="365"
                step="30"
                value={inactivityThreshold}
                onChange={(e) => setInactivityThreshold(Number(e.target.value))}
                className="w-32"
                disabled={isScanning}
              />
              <span className="text-lg font-semibold w-20 text-right">
                {inactivityThreshold} days
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
            <div>
              <p className="text-gray-600 dark:text-gray-400">
                <span className="text-3xl font-bold text-gray-900 dark:text-white">{muteList.pubkeys.length}</span>
                <span className="ml-2 text-sm">muted profiles</span>
              </p>
            </div>

            {!isScanning ? (
              <button
                onClick={handleStartScan}
                disabled={muteList.pubkeys.length === 0}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Activity size={18} />
                Start Scan
              </button>
            ) : (
              <button
                onClick={handleAbortScan}
                className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2"
              >
                <XCircle size={18} />
                Cancel Scan
              </button>
            )}
          </div>

          {/* Progress Bar */}
          {isScanning && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">
                  Scanning... {scanProgress.current} / {scanProgress.total}
                </span>
                <span className="text-gray-600 dark:text-gray-400">
                  {Math.round((scanProgress.current / scanProgress.total) * 100)}%
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{
                    width: `${(scanProgress.current / scanProgress.total) * 100}%`
                  }}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                Scanning multiple relays for activity. This may take some time.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      {scanResults.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          {/* Results Header */}
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Scan Results</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowInactive(!showInactive)}
                  className={`px-3 py-1 rounded-lg text-sm flex items-center gap-2 ${
                    showInactive
                      ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {showInactive ? <Eye size={16} /> : <EyeOff size={16} />}
                  Inactive ({inactiveCount})
                </button>
                <button
                  onClick={() => setShowActive(!showActive)}
                  className={`px-3 py-1 rounded-lg text-sm flex items-center gap-2 ${
                    showActive
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {showActive ? <Eye size={16} /> : <EyeOff size={16} />}
                  Active ({activeCount})
                </button>
              </div>
            </div>

            {inactiveCount > 0 && showInactive && (
              <button
                onClick={handleBulkRemove}
                className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center justify-center gap-2"
              >
                <Trash2 size={18} />
                Remove All {inactiveCount} Inactive Accounts
              </button>
            )}
          </div>

          {/* Results List */}
          <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-96 overflow-y-auto">
            {filteredResults.map((result) => {
              const profile = profilesMap.get(result.pubkey);
              const displayName = getDisplayName(result.pubkey, profile);
              const npub = hexToNpub(result.pubkey);

              return (
                <div
                  key={result.pubkey}
                  className={`p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                    result.isLikelyAbandoned ? 'bg-red-50 dark:bg-red-900/10' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {profile?.picture ? (
                        <img
                          src={profile.picture}
                          alt={displayName}
                          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
                          <User size={20} />
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium truncate">{displayName}</p>
                          {result.isLikelyAbandoned ? (
                            <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-2 py-0.5 rounded whitespace-nowrap">
                              inactive
                            </span>
                          ) : (
                            <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2 py-0.5 rounded whitespace-nowrap">
                              active
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-4 mt-1 text-xs text-gray-600 dark:text-gray-400 flex-wrap">
                          {result.lastActivityTimestamp !== null && result.daysInactive !== null ? (
                            <>
                              <span className="flex items-center gap-1 whitespace-nowrap">
                                <Calendar size={12} />
                                Last: {formatDate(result.lastActivityTimestamp)}
                              </span>
                              <span className={`font-semibold whitespace-nowrap ${
                                result.daysInactive > 180 ? 'text-red-600 dark:text-red-400' :
                                result.daysInactive > 90 ? 'text-orange-600 dark:text-orange-400' :
                                'text-green-600 dark:text-green-400'
                              }`}>
                                {result.daysInactive} days inactive
                              </span>
                              {result.lastActivityType && (
                                <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded whitespace-nowrap">
                                  {result.lastActivityType.replace(/_/g, ' ').toLowerCase()}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-red-600 dark:text-red-400 font-semibold">
                              No activity found - likely deleted
                            </span>
                          )}
                          {!result.hasProfile && (
                            <span className="text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded whitespace-nowrap">
                              no profile
                            </span>
                          )}
                        </div>

                        {/* Profile Links */}
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            onClick={() => handleCopyNpub(result.pubkey)}
                            className="text-xs text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1"
                            title="Copy npub"
                          >
                            <Copy size={12} />
                            Copy npub
                          </button>
                          <span className="text-gray-300 dark:text-gray-600">|</span>
                          <a
                            href={`https://npub.world/${npub}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1"
                          >
                            <ExternalLink size={12} />
                            View Profile
                          </a>
                        </div>
                      </div>
                    </div>

                    {result.isLikelyAbandoned && (
                      <button
                        onClick={() => handleRemoveAccount(result.pubkey)}
                        className="ml-4 px-3 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2 text-sm flex-shrink-0"
                      >
                        <Trash2 size={14} />
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Blacklist Viewer */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setShowBlacklist(!showBlacklist)}
          className="w-full p-6 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} className="text-yellow-500" />
            <div className="text-left">
              <h2 className="text-lg font-semibold">Blacklisted Profiles</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {blacklistedPubkeys.size} profiles prevented from re-importing
              </p>
            </div>
          </div>
          <span className="text-gray-400">
            {showBlacklist ? '▼' : '▶'}
          </span>
        </button>

        {showBlacklist && blacklistedPubkeys.size > 0 && (
          <div className="border-t border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700 max-h-96 overflow-y-auto">
            {Array.from(blacklistedPubkeys).map((pubkey) => {
              const profile = blacklistProfilesMap.get(pubkey);
              const displayName = getDisplayName(pubkey, profile);
              const npub = hexToNpub(pubkey);

              return (
                <div
                  key={pubkey}
                  className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {profile?.picture ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={profile.picture}
                          alt={displayName}
                          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
                          <User size={20} />
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium truncate">{displayName}</p>
                          <span className="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 px-2 py-0.5 rounded whitespace-nowrap">
                            Blacklisted
                          </span>
                        </div>

                        {/* Profile Links */}
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            onClick={() => handleCopyNpub(pubkey)}
                            className="text-xs text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1"
                            title="Copy npub"
                          >
                            <Copy size={12} />
                            Copy npub
                          </button>
                          <span className="text-gray-300 dark:text-gray-600">|</span>
                          <a
                            href={`https://npub.world/${npub}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1"
                          >
                            <ExternalLink size={12} />
                            View Profile
                          </a>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleRemoveFromBlacklist(pubkey)}
                      className="ml-4 px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm flex-shrink-0"
                    >
                      Restore
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {showBlacklist && blacklistedPubkeys.size === 0 && (
          <div className="p-6 border-t border-gray-200 dark:border-gray-700 text-center text-gray-600 dark:text-gray-400">
            No blacklisted profiles
          </div>
        )}
      </div>
    </div>
  );
}
