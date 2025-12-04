'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useRelaySync } from '@/hooks/useRelaySync';
import { useStore } from '@/lib/store';
import { protectionService } from '@/lib/protectionService';
import { blacklistService } from '@/lib/blacklistService';
import { fetchProfile, hexToNpub } from '@/lib/nostr';
import { publishAppData, D_TAGS, ProtectedUsersData, BlacklistData } from '@/lib/relayStorage';
import { Profile } from '@/types';
import packageJson from '../package.json';
import {
  Settings as SettingsIcon,
  Trash2,
  AlertTriangle,
  Info,
  Moon,
  Sun,
  Bell,
  Shield,
  Eye,
  Database,
  RefreshCw,
  CheckCircle,
  XCircle,
  Radio,
  Cloud,
  CloudOff,
  Download,
  Upload,
  User
} from 'lucide-react';

export default function Settings() {
  const router = useRouter();
  const { disconnect } = useAuth();
  const { triggerSync, getSyncStatus, isOnline } = useRelaySync();
  const { session, setHasCompletedOnboarding } = useStore();

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetStep, setResetStep] = useState(0);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatusData, setSyncStatusData] = useState(getSyncStatus());
  const [protectedCount, setProtectedCount] = useState(0);
  const [blacklistCount, setBlacklistCount] = useState(0);
  const [showProtectedManager, setShowProtectedManager] = useState(false);
  const [showBlacklistManager, setShowBlacklistManager] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, Profile | null>>({});

  // Relay state
  const [userRelayList, setUserRelayList] = useState<{
    read: string[];
    write: string[];
    both: string[];
    timestamp?: number;
  } | null>(null);
  const [loadingRelays, setLoadingRelays] = useState(false);

  // Theme preference (could be expanded with actual theme switching)
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return document.documentElement.classList.contains('dark');
    }
    return false;
  });

  const handleToggleDarkMode = () => {
    if (typeof window !== 'undefined') {
      document.documentElement.classList.toggle('dark');
      setDarkMode(!darkMode);
      localStorage.setItem('theme', !darkMode ? 'dark' : 'light');
    }
  };

  // Use cached relay list metadata from session (fetched at login)
  useEffect(() => {
    if (!session) return;

    console.log('📋 Checking session for cached relay list metadata');

    if (session.relayListMetadata) {
      console.log('✅ Using cached relay list metadata from session:', session.relayListMetadata);
      setUserRelayList(session.relayListMetadata);
      setLoadingRelays(false);
    } else {
      console.log('ℹ️ No cached relay list metadata available');
      setLoadingRelays(false);
    }
  }, [session]);

  const handleResetOnboarding = () => {
    setHasCompletedOnboarding(false);
    setSuccessMessage('Onboarding reset! Refresh the page to see the onboarding flow again.');
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  const handleResetApp = () => {
    if (resetStep === 0) {
      setResetStep(1);
      return;
    }

    // Disconnect user first
    disconnect();

    // Clear all localStorage
    localStorage.clear();

    setSuccessMessage('App reset complete! Redirecting to home...');
    setTimeout(() => {
      window.location.href = '/';
    }, 2000);
  };

  const getStorageSize = () => {
    try {
      let total = 0;
      for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
          total += localStorage[key].length + key.length;
        }
      }
      return (total / 1024).toFixed(2); // KB
    } catch {
      return '0';
    }
  };

  const getBackupCount = () => {
    try {
      const backups = localStorage.getItem('mutable-backups');
      if (backups) {
        return JSON.parse(backups).length;
      }
    } catch {
      return 0;
    }
    return 0;
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      const result = await triggerSync();
      setSyncStatusData(result || getSyncStatus());

      if (result && result.errors.length === 0) {
        setSuccessMessage('All app data synced successfully with relays!');
      } else if (result && result.errors.length > 0) {
        setErrorMessage(`Sync completed with ${result.errors.length} error(s). Check console for details.`);
      }

      setTimeout(() => {
        setSuccessMessage(null);
        setErrorMessage(null);
      }, 5000);
    } catch (error) {
      setErrorMessage('Failed to sync with relays. Please try again.');
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleForceRepublish = async () => {
    if (!session) return;

    setIsSyncing(true);
    try {
      // Publish to ALL relays including mobile relays
      const allRelays = [
        ...session.relays,
        'wss://nostrelay.yeghro.com',
        'wss://nostr.land',
        'wss://offchain.pub',
      ];

      // 1. Republish Protected Users
      const protectedRecords = protectionService.loadProtectionRecords();
      const protectedData: ProtectedUsersData = {
        version: 1,
        timestamp: Date.now(),
        users: protectedRecords.map(r => ({
          pubkey: r.pubkey,
          addedAt: r.addedAt,
          reason: r.note,
        })),
      };

      console.log('[Settings] Republishing', protectedRecords.length, 'protected users to', allRelays.length, 'relays');
      await publishAppData(D_TAGS.PROTECTED_USERS, protectedData, session.pubkey, allRelays, true);

      // 2. Republish Blacklist
      const blacklistPubkeys = blacklistService.getBlacklistedPubkeys();
      const blacklistData: BlacklistData = {
        version: 1,
        timestamp: Date.now(),
        pubkeys: blacklistPubkeys,
      };

      console.log('[Settings] Republishing', blacklistPubkeys.length, 'blacklisted users to', allRelays.length, 'relays');
      await publishAppData(D_TAGS.BLACKLIST, blacklistData, session.pubkey, allRelays, true);

      setSuccessMessage(`✅ Republished ${protectedRecords.length} protected users and ${blacklistPubkeys.length} blacklisted users to ${allRelays.length} relays!`);
      setTimeout(() => setSuccessMessage(null), 10000);
    } catch (error) {
      console.error('[Settings] Force republish error:', error);
      setErrorMessage('❌ Republish failed: ' + (error instanceof Error ? error.message : 'Unknown'));
      setTimeout(() => setErrorMessage(null), 10000);
    } finally {
      setIsSyncing(false);
    }
  };

  // Poll sync status and counts periodically
  useEffect(() => {
    const updateCounts = () => {
      setProtectedCount(protectionService.getProtectedCount());
      setBlacklistCount(blacklistService.getBlacklistCount());
      setSyncStatusData(getSyncStatus());
    };

    // Initial update
    updateCounts();

    const interval = setInterval(updateCounts, 2000);
    return () => clearInterval(interval);
  }, [getSyncStatus]);

  // Fetch profiles when modals open
  useEffect(() => {
    if (!session || (!showProtectedManager && !showBlacklistManager)) return;

    const fetchProfiles = async () => {
      const pubkeysToFetch: string[] = [];

      if (showProtectedManager) {
        pubkeysToFetch.push(...protectionService.getProtectedPubkeys());
      }

      if (showBlacklistManager) {
        pubkeysToFetch.push(...blacklistService.getBlacklistedPubkeys());
      }

      // Filter out already fetched profiles
      const uniquePubkeys = [...new Set(pubkeysToFetch)].filter(pk => profiles[pk] === undefined);

      if (uniquePubkeys.length === 0) return;

      console.log('Fetching profiles for', uniquePubkeys.length, 'pubkeys');

      // Fetch profiles
      for (const pubkey of uniquePubkeys) {
        fetchProfile(pubkey, session.relays)
          .then(profile => {
            console.log('Fetched profile for', pubkey, profile);
            setProfiles(prev => ({ ...prev, [pubkey]: profile }));
          })
          .catch((err) => {
            console.error('Failed to fetch profile for', pubkey, err);
            setProfiles(prev => ({ ...prev, [pubkey]: null }));
          });
      }
    };

    fetchProfiles();
  }, [showProtectedManager, showBlacklistManager, session]);

  const handleExportProtectedUsers = () => {
    const records = protectionService.loadProtectionRecords();

    if (records.length === 0) {
      alert('No protected users to export.');
      return;
    }

    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      count: records.length,
      protectedUsers: records
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mutable-protected-users-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setSuccessMessage(`Exported ${records.length} protected user${records.length === 1 ? '' : 's'}`);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleImportProtectedUsers = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const importData = JSON.parse(content);

        // Validate format
        if (!importData.protectedUsers || !Array.isArray(importData.protectedUsers)) {
          throw new Error('Invalid protected users file format');
        }

        let addedCount = 0;
        let skippedCount = 0;

        // Import as append-only (don't overwrite existing)
        importData.protectedUsers.forEach((user: { pubkey: string; note?: string }) => {
          if (user.pubkey && !protectionService.isProtected(user.pubkey)) {
            protectionService.addProtection(user.pubkey, user.note);
            addedCount++;
          } else {
            skippedCount++;
          }
        });

        // Update counts
        setProtectedCount(protectionService.getProtectedCount());

        // Publish to relay if user is online
        if (session) {
          protectionService.publishToRelay(session.pubkey, session.relays).catch(console.error);
        }

        setSuccessMessage(
          `Import complete!\nAdded: ${addedCount} user${addedCount === 1 ? '' : 's'}\n` +
          (skippedCount > 0 ? `Skipped ${skippedCount} already protected` : '')
        );
        setTimeout(() => setSuccessMessage(null), 5000);
      } catch (error) {
        setErrorMessage(`Failed to import: ${error instanceof Error ? error.message : 'Invalid file'}`);
        setTimeout(() => setErrorMessage(null), 5000);
      }
    };
    reader.readAsText(file);

    // Reset input so same file can be selected again
    event.target.value = '';
  };

  const handleExportBlacklist = () => {
    const pubkeys = blacklistService.getBlacklistedPubkeys();

    if (pubkeys.length === 0) {
      alert('No blacklisted users to export.');
      return;
    }

    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      count: pubkeys.length,
      blacklistedPubkeys: pubkeys
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mutable-blacklist-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setSuccessMessage(`Exported ${pubkeys.length} blacklisted user${pubkeys.length === 1 ? '' : 's'}`);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleImportBlacklist = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const importData = JSON.parse(content);

        // Validate format
        if (!importData.blacklistedPubkeys || !Array.isArray(importData.blacklistedPubkeys)) {
          throw new Error('Invalid blacklist file format');
        }

        let addedCount = 0;
        let skippedCount = 0;

        // Import as append-only (don't overwrite existing)
        importData.blacklistedPubkeys.forEach((pubkey: string) => {
          if (pubkey && !blacklistService.isBlacklisted(pubkey)) {
            blacklistService.addToBlacklist(pubkey);
            addedCount++;
          } else {
            skippedCount++;
          }
        });

        // Update counts
        setBlacklistCount(blacklistService.getBlacklistCount());

        // Publish to relay if user is online
        if (session) {
          blacklistService.publishToRelay(session.pubkey, session.relays).catch(console.error);
        }

        setSuccessMessage(
          `Import complete!\nAdded: ${addedCount} user${addedCount === 1 ? '' : 's'}\n` +
          (skippedCount > 0 ? `Skipped ${skippedCount} already blacklisted` : '')
        );
        setTimeout(() => setSuccessMessage(null), 5000);
      } catch (error) {
        setErrorMessage(`Failed to import: ${error instanceof Error ? error.message : 'Invalid file'}`);
        setTimeout(() => setErrorMessage(null), 5000);
      }
    };
    reader.readAsText(file);

    // Reset input so same file can be selected again
    event.target.value = '';
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Manage your application preferences and data
        </p>
      </div>

      {/* Success/Error Messages */}
      {successMessage && (
        <div className="p-4 bg-green-100 dark:bg-green-900/30 border border-green-400 dark:border-green-700 rounded-lg flex items-center gap-2">
          <CheckCircle size={20} className="text-green-600 dark:text-green-400" />
          <span className="text-green-800 dark:text-green-200">{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg flex items-center gap-2">
          <XCircle size={20} className="text-red-600 dark:text-red-400" />
          <span className="text-red-800 dark:text-red-200">{errorMessage}</span>
        </div>
      )}

      {/* Appearance Section */}
      {/* Commented out - may add back later
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center gap-3 mb-4">
          {darkMode ? <Moon size={24} className="text-gray-900 dark:text-white" /> : <Sun size={24} className="text-gray-900 dark:text-white" />}
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Appearance</h2>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 dark:text-white">Dark Mode</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Toggle between light and dark theme
              </p>
            </div>
            <button
              onClick={handleToggleDarkMode}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                darkMode ? 'bg-red-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                  darkMode ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>
      */}

      {/* Nostr Network Section */}
      {session && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center gap-3 mb-4">
            <Radio size={24} className="text-gray-900 dark:text-white" />
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Nostr Network</h2>
          </div>

          <div className="space-y-4">
            {/* Info about relay source */}
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <div className="flex items-start gap-3">
                <Info size={20} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-900 dark:text-blue-200">
                  <p className="font-semibold mb-1">Your Relay Configuration</p>
                  <p>Mutable uses your relay list from Nostr (NIP-65). These are the relays you&apos;ve announced to the network and are used by all Nostr clients.</p>
                </div>
              </div>
            </div>

            {/* Current session relays */}
            <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                <span>📡</span> Active Relays (Current Session)
              </h3>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                These relays are being used for this session:
              </p>
              <div className="space-y-1">
                {session.relays.map((relay, i) => (
                  <div key={i} className="text-xs font-mono bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-600">
                    {relay}
                  </div>
                ))}
              </div>
            </div>

            {/* User's announced relay list from Nostr */}
            {loadingRelays ? (
              <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-center">
                <RefreshCw className="animate-spin mx-auto mb-2 text-gray-400" size={24} />
                <p className="text-sm text-gray-600 dark:text-gray-400">Loading relay preferences from Nostr...</p>
              </div>
            ) : userRelayList ? (
              <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
                  Your Announced Relay List (NIP-65)
                </h3>
                {userRelayList.timestamp && (
                  <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                    Last updated: {new Date(userRelayList.timestamp * 1000).toLocaleString()}
                  </p>
                )}

                {/* Read & Write Relays */}
                {userRelayList.both.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Read & Write ({userRelayList.both.length})
                    </p>
                    <div className="space-y-1">
                      {userRelayList.both.map((relay, i) => (
                        <div key={i} className="text-xs font-mono bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-600">
                          {relay}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Write Only Relays */}
                {userRelayList.write.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Write Only ({userRelayList.write.length})
                    </p>
                    <div className="space-y-1">
                      {userRelayList.write.map((relay, i) => (
                        <div key={i} className="text-xs font-mono bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-600">
                          {relay}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Read Only Relays */}
                {userRelayList.read.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Read Only ({userRelayList.read.length})
                    </p>
                    <div className="space-y-1">
                      {userRelayList.read.map((relay, i) => (
                        <div key={i} className="text-xs font-mono bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-600">
                          {relay}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-xs text-gray-600 dark:text-gray-400 mt-3">
                  💡 To update your relay list, use a Nostr client that supports NIP-65 (like Jumble, Amethyst, or Damus).
                </p>
              </div>
            ) : (
              <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={20} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-amber-900 dark:text-amber-200">
                    <p className="font-semibold mb-1">No Relay List Found</p>
                    <p>You haven&apos;t published a NIP-65 relay list yet. Mutable is using relays from your NIP-07 extension or defaults.</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Relay Storage Sync Section */}
      {session && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center gap-3 mb-4">
            <Cloud size={24} className="text-gray-900 dark:text-white" />
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Relay Storage Sync</h2>
          </div>

          <div className="space-y-4">
            {/* Info about relay storage */}
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <div className="flex items-start gap-3">
                <Info size={20} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-900 dark:text-blue-200">
                  <p className="font-semibold mb-1">Multi-Device Sync</p>
                  <p className="mb-2">Your protected users, blacklist, preferences, and imported packs are automatically synced to your Nostr relays. This allows you to seamlessly access your data across all devices.</p>
                  <p className="text-xs">
                    <strong>Tip:</strong> Use the export/import buttons to share your lists or create local backups. Imports are append-only and won&apos;t overwrite existing data.
                  </p>
                </div>
              </div>
            </div>

            {/* Sync status */}
            <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  {isOnline ? (
                    <Cloud size={20} className="text-green-600 dark:text-green-400" />
                  ) : (
                    <CloudOff size={20} className="text-gray-400" />
                  )}
                  <h3 className="font-semibold text-gray-900 dark:text-white">Sync Status</h3>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleManualSync}
                    disabled={isSyncing || !isOnline}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm font-medium"
                  >
                    <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />
                    {isSyncing ? 'Syncing...' : 'Sync Now'}
                  </button>
                  <button
                    onClick={handleForceRepublish}
                    disabled={isSyncing || !isOnline}
                    className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm font-medium"
                    title="Force republish all data to all relays"
                  >
                    <Cloud size={16} />
                    Republish All
                  </button>
                </div>
              </div>

              {syncStatusData.lastSyncTime && (
                <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                  Last synced: {new Date(syncStatusData.lastSyncTime).toLocaleString()}
                </div>
              )}

              {/* Data counts */}
              <div className="space-y-4 mt-3">
                <div className="p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-600">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-gray-600 dark:text-gray-400">Protected Users:</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowProtectedManager(true)}
                        disabled={protectedCount === 0}
                        className="flex items-center gap-1.5 px-2 py-1 text-xs sm:text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                        title="View and manage protected users"
                      >
                        <span>Manage</span>
                      </button>
                      <button
                        onClick={handleExportProtectedUsers}
                        disabled={protectedCount === 0}
                        className="flex items-center gap-1.5 px-2 py-1 text-xs sm:text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                        title="Export protected users list"
                      >
                        <Download size={14} />
                        <span>Export</span>
                      </button>
                      <label className="flex items-center gap-1.5 px-2 py-1 text-xs sm:text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded cursor-pointer font-medium" title="Import protected users list">
                        <Upload size={14} />
                        <span>Import</span>
                        <input
                          type="file"
                          accept=".json"
                          onChange={handleImportProtectedUsers}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                  <p className="font-semibold text-gray-900 dark:text-white">{protectedCount}</p>
                </div>
                <div className="p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-600">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-gray-600 dark:text-gray-400">Blacklisted:</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowBlacklistManager(true)}
                        disabled={blacklistCount === 0}
                        className="flex items-center gap-1.5 px-2 py-1 text-xs sm:text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                        title="View and manage blacklist"
                      >
                        <span>Manage</span>
                      </button>
                      <button
                        onClick={handleExportBlacklist}
                        disabled={blacklistCount === 0}
                        className="flex items-center gap-1.5 px-2 py-1 text-xs sm:text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                        title="Export blacklist"
                      >
                        <Download size={14} />
                        <span>Export</span>
                      </button>
                      <label className="flex items-center gap-1.5 px-2 py-1 text-xs sm:text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded cursor-pointer font-medium" title="Import blacklist">
                        <Upload size={14} />
                        <span>Import</span>
                        <input
                          type="file"
                          accept=".json"
                          onChange={handleImportBlacklist}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                  <p className="font-semibold text-gray-900 dark:text-white">{blacklistCount}</p>
                </div>
              </div>

              {syncStatusData.syncedServices.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Synced Services ({syncStatusData.syncedServices.length})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {syncStatusData.syncedServices.map((service) => (
                      <span
                        key={service}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 rounded text-xs"
                      >
                        <CheckCircle size={12} />
                        {service}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {syncStatusData.errors.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-red-700 dark:text-red-300 mb-2">
                    Errors ({syncStatusData.errors.length})
                  </p>
                  <div className="space-y-1">
                    {syncStatusData.errors.map((error, i) => (
                      <div
                        key={i}
                        className="text-xs text-red-800 dark:text-red-200 bg-red-100 dark:bg-red-900/30 p-2 rounded"
                      >
                        {error}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Privacy & Data Section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center gap-3 mb-4">
          <Shield size={24} className="text-gray-900 dark:text-white" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Privacy & Data</h2>
        </div>

        <div className="space-y-4">
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-start gap-3">
              <Info size={20} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-900 dark:text-blue-200">
                <p className="font-semibold mb-1">About Your Data</p>
                <p>Mutable stores data locally in your browser. Your Nostr data on relays remains separate and is not affected by local data operations.</p>
              </div>
            </div>
          </div>

          <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <div className="flex items-center gap-3 mb-3">
              <Database size={20} className="text-gray-600 dark:text-gray-400" />
              <h3 className="font-semibold text-gray-900 dark:text-white">Storage Information</h3>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-600 dark:text-gray-400">Total Storage Used:</span>
                <p className="font-semibold text-gray-900 dark:text-white">{getStorageSize()} KB</p>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">Backups Stored:</span>
                <p className="font-semibold text-gray-900 dark:text-white">{getBackupCount()}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Onboarding Section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center gap-3 mb-4">
          <Eye size={24} className="text-gray-900 dark:text-white" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Show Onboarding</h2>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 dark:text-white">Welcome Tutorial</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                View the welcome tutorial again
              </p>
            </div>
            <button
              onClick={handleResetOnboarding}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors flex items-center gap-2"
            >
              <Eye size={16} />
              Show Again
            </button>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border-2 border-red-300 dark:border-red-800 p-6">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle size={24} className="text-red-600 dark:text-red-400" />
          <h2 className="text-xl font-bold text-red-900 dark:text-red-100">Danger Zone</h2>
        </div>

        <div className="space-y-4">
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <h3 className="font-bold text-red-900 dark:text-red-100 mb-2">
              Reset All Application Data
            </h3>
            <p className="text-sm text-red-800 dark:text-red-200 mb-3">
              This will permanently delete all local data and reset the application to its initial state.
            </p>

            <div className="bg-red-100 dark:bg-red-900/40 border border-red-300 dark:border-red-700 rounded p-3 mb-4">
              <p className="text-xs font-semibold text-red-900 dark:text-red-100 mb-2">
                ⚠️ This action will delete:
              </p>
              <ul className="text-xs text-red-900 dark:text-red-100 space-y-1 ml-4 list-disc">
                <li>All backups stored in your browser</li>
                <li>Your session (you&apos;ll be logged out)</li>
                <li>All application settings and preferences</li>
                <li>Cached mute lists and follow lists</li>
              </ul>
            </div>

            <div className="bg-blue-100 dark:bg-blue-900/40 border border-blue-300 dark:border-blue-700 rounded p-3 mb-4">
              <p className="text-xs font-semibold text-blue-900 dark:text-blue-100">
                ℹ️ Your Nostr data is safe: This only clears local browser data. Your mute lists, follows, and posts on Nostr relays will NOT be affected.
              </p>
            </div>

            {resetStep === 0 ? (
              <button
                onClick={() => setShowResetConfirm(true)}
                className="w-full sm:w-auto px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold flex items-center justify-center gap-2"
              >
                <Trash2 size={18} />
                Reset Application
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-bold text-red-900 dark:text-red-100">
                  ⚠️ Are you absolutely sure? This cannot be undone!
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={handleResetApp}
                    className="flex-1 px-6 py-3 bg-red-700 text-white rounded-lg hover:bg-red-800 transition-colors font-bold flex items-center justify-center gap-2"
                  >
                    <AlertTriangle size={18} />
                    Yes, Delete Everything
                  </button>
                  <button
                    onClick={() => setResetStep(0)}
                    className="flex-1 px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* About Section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center gap-3 mb-4">
          <Info size={24} className="text-gray-900 dark:text-white" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">About Mutable</h2>
        </div>

        <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
          <p>
            <strong className="text-gray-900 dark:text-white">Version:</strong> {packageJson.version}
          </p>
          <p>
            <strong className="text-gray-900 dark:text-white">Build:</strong> {process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.substring(0, 7) || 'local'}
          </p>
          <p>
            <strong className="text-gray-900 dark:text-white">Description:</strong> Mutable is a comprehensive Nostr social graph management tool that helps you curate your follow lists and maintain a healthy social feed through intelligent muting, community-driven filtering, and advanced list management features.
          </p>
          <div>
            <strong className="text-gray-900 dark:text-white block mb-2">Features:</strong>
            <ul className="list-disc list-inside space-y-1 ml-4 text-gray-600 dark:text-gray-400">
              <li><strong className="text-gray-700 dark:text-gray-300">Mute-o-Scope:</strong> Analyze your social graph and discover users to mute based on engagement patterns and follower overlap</li>
              <li><strong className="text-gray-700 dark:text-gray-300">Public Packs:</strong> Discover and import curated mute lists from the Nostr community (e.g., scammers, spam bots, low-quality accounts)</li>
              <li><strong className="text-gray-700 dark:text-gray-300">Muteuals:</strong> Find users you follow who have muted you, helping you understand your social dynamics</li>
              <li><strong className="text-gray-700 dark:text-gray-300">Reciprocals:</strong> Discover who you follow that doesn&apos;t follow you back, with intelligent relay discovery using NIP-65</li>
              <li><strong className="text-gray-700 dark:text-gray-300">Decimator:</strong> Randomly reduce your follow list by a percentage to keep it manageable, with user protection capabilities</li>
              <li><strong className="text-gray-700 dark:text-gray-300">Backups:</strong> Automatically backup your follow lists before making changes, with easy restore functionality</li>
              <li><strong className="text-gray-700 dark:text-gray-300">NIP-51 Support:</strong> Full support for Nostr&apos;s mute list standard with public and private list management</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="text-red-600 dark:text-red-400" size={32} />
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Confirm Reset</h3>
            </div>

            <p className="text-gray-700 dark:text-gray-300 mb-4">
              Are you sure you want to reset the application? This will delete all local data and log you out.
            </p>

            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 mb-6">
              <p className="text-sm text-red-800 dark:text-red-200">
                <strong>Important:</strong> Make sure you&apos;ve exported any important backups before proceeding. Your Nostr relay data will remain safe.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowResetConfirm(false);
                  setResetStep(1);
                }}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold"
              >
                Yes, Reset
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Protected Users Manager Modal */}
      {showProtectedManager && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Manage Protected Users ({protectedCount})</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">These users are protected from mass operations</p>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-2">
                {protectionService.loadProtectionRecords().map((record) => {
                  const profile = profiles[record.pubkey];
                  const displayName = profile?.display_name || profile?.name || record.pubkey.slice(0, 16) + '...';
                  const npub = hexToNpub(record.pubkey);
                  const truncatedNpub = `${npub.slice(0, 12)}...${npub.slice(-6)}`;

                  return (
                    <div key={record.pubkey} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded">
                      {profile?.picture ? (
                        <img
                          src={profile.picture}
                          alt={displayName}
                          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
                          <User size={20} className="text-gray-600 dark:text-gray-400" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-gray-900 dark:text-white">{displayName}</div>
                        <div className="font-mono text-xs text-gray-500 dark:text-gray-400 truncate">{truncatedNpub}</div>
                        {record.note && <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 italic">{record.note}</div>}
                      </div>
                      <button
                        onClick={() => {
                          if (confirm(`Remove protection for ${displayName}?`)) {
                            protectionService.removeProtection(record.pubkey);
                            setProtectedCount(protectionService.getProtectedCount());
                            if (session) {
                              protectionService.publishToRelay(session.pubkey, session.relays).catch(console.error);
                            }
                          }
                        }}
                        className="ml-2 px-3 py-1 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded whitespace-nowrap"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex gap-3">
              <button
                onClick={() => {
                  if (confirm(`Remove ALL ${protectedCount} protected users? This cannot be undone!`)) {
                    protectionService.clearAllProtection();
                    setProtectedCount(0);
                    setShowProtectedManager(false);
                    if (session) {
                      protectionService.publishToRelay(session.pubkey, session.relays).catch(console.error);
                    }
                    setSuccessMessage('All protected users removed');
                    setTimeout(() => setSuccessMessage(null), 3000);
                  }
                }}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                Clear All
              </button>
              <button
                onClick={() => setShowProtectedManager(false)}
                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Blacklist Manager Modal */}
      {showBlacklistManager && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Manage Blacklist ({blacklistCount})</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Blacklisted users won&apos;t be re-imported</p>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-2">
                {blacklistService.getBlacklistedPubkeys().map((pubkey) => {
                  const profile = profiles[pubkey];
                  const displayName = profile?.display_name || profile?.name || pubkey.slice(0, 16) + '...';
                  const npub = hexToNpub(pubkey);
                  const truncatedNpub = `${npub.slice(0, 12)}...${npub.slice(-6)}`;

                  return (
                    <div key={pubkey} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded">
                      {profile?.picture ? (
                        <img
                          src={profile.picture}
                          alt={displayName}
                          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
                          <User size={20} className="text-gray-600 dark:text-gray-400" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-gray-900 dark:text-white">{displayName}</div>
                        <div className="font-mono text-xs text-gray-500 dark:text-gray-400 truncate">{truncatedNpub}</div>
                      </div>
                      <button
                        onClick={() => {
                          if (confirm(`Remove ${displayName} from blacklist?`)) {
                            blacklistService.removeFromBlacklist(pubkey);
                            setBlacklistCount(blacklistService.getBlacklistCount());
                            if (session) {
                              blacklistService.publishToRelay(session.pubkey, session.relays).catch(console.error);
                            }
                          }
                        }}
                        className="ml-2 px-3 py-1 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded whitespace-nowrap"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex gap-3">
              <button
                onClick={() => {
                  if (confirm(`Remove ALL ${blacklistCount} blacklisted users? This cannot be undone!`)) {
                    blacklistService.clearBlacklist();
                    setBlacklistCount(0);
                    setShowBlacklistManager(false);
                    if (session) {
                      blacklistService.publishToRelay(session.pubkey, session.relays).catch(console.error);
                    }
                    setSuccessMessage('All blacklisted users removed');
                    setTimeout(() => setSuccessMessage(null), 3000);
                  }
                }}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                Clear All
              </button>
              <button
                onClick={() => setShowBlacklistManager(false)}
                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
