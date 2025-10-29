'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useStore } from '@/lib/store';
import Image from 'next/image';
import { LogOut, User } from 'lucide-react';
import MyMuteList from '@/components/MyMuteList';
import PublicLists from '@/components/PublicLists';
import Muteuals from '@/components/Muteuals';
import Backups from '@/components/Backups';
import Settings from '@/components/Settings';
import GlobalUserSearch from '@/components/GlobalUserSearch';
import UserProfileModal from '@/components/UserProfileModal';
import OnboardingModal from '@/components/OnboardingModal';
import { Profile } from '@/types';
import { fetchProfile, getFollowListPubkeys } from '@/lib/nostr';
import { backupService } from '@/lib/backupService';

export default function Dashboard() {
  const router = useRouter();
  const { session, isConnected, disconnect } = useAuth();
  const { activeTab, setActiveTab, hasUnsavedChanges, hasCompletedOnboarding, setHasCompletedOnboarding, muteList } = useStore();
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [userProfile, setUserProfile] = useState<Profile | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (!isConnected) {
      router.push('/');
    }
  }, [isConnected, router]);

  // Show onboarding on first visit
  useEffect(() => {
    if (isConnected && !hasCompletedOnboarding) {
      setShowOnboarding(true);
    }
  }, [isConnected, hasCompletedOnboarding]);

  // Load user profile
  useEffect(() => {
    const loadUserProfile = async () => {
      if (session?.pubkey) {
        try {
          const profile = await fetchProfile(session.pubkey, session.relays);
          setUserProfile(profile);
        } catch (error) {
          console.error('Failed to load user profile:', error);
        }
      }
    };

    loadUserProfile();
  }, [session]);

  // Warn before leaving page with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  if (!isConnected || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  const handleDisconnect = () => {
    disconnect();
    router.push('/');
  };

  const handleUserSelect = (profile: Profile) => {
    setSelectedProfile(profile);
  };

  const handleCreateBackup = async () => {
    if (!session) return;

    try {
      // Check if this is truly the first backup
      const existingMuteBackups = backupService.getBackupsByType('mute-list');
      const existingFollowBackups = backupService.getBackupsByType('follow-list');
      const isFirstBackup = existingMuteBackups.length === 0 && existingFollowBackups.length === 0;

      const backupNote = isFirstBackup
        ? 'Initial backup created during onboarding'
        : 'Backup created from onboarding tutorial';

      // Create mute list backup
      const muteBackup = backupService.createMuteListBackup(
        session.pubkey,
        muteList,
        backupNote
      );
      backupService.saveBackup(muteBackup);

      // Create follow list backup with retries (3 attempts) for better reliability during onboarding
      const follows = await getFollowListPubkeys(session.pubkey, session.relays, 3);
      const followBackup = backupService.createFollowListBackup(
        session.pubkey,
        follows,
        backupNote
      );
      backupService.saveBackup(followBackup);

      alert(`Backups created successfully!\n\nMute list: ${muteList.pubkeys.length + muteList.words.length + muteList.tags.length + muteList.threads.length} items\nFollow list: ${follows.length} follows`);
    } catch (error) {
      console.error('Failed to create backups:', error);
      alert('Failed to create backups. Please try again.');
    }
  };

  const handleSkipOnboarding = () => {
    setHasCompletedOnboarding(true);
    setShowOnboarding(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16 gap-4">
            <div className="flex items-center space-x-3 flex-shrink-0">
              <Image
                src="/mutable_logo.svg"
                alt="Mutable"
                width={40}
                height={40}
              />
              <Image
                src="/mutable_text.svg"
                alt="Mutable"
                width={120}
                height={24}
                className="hidden sm:block"
              />
            </div>

            {/* Global Search */}
            <GlobalUserSearch onSelectUser={handleUserSelect} />

            <div className="flex items-center space-x-4 flex-shrink-0">
              {/* User Profile Display - Desktop */}
              <div className="hidden md:flex items-center space-x-3">
                {userProfile?.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={userProfile.picture}
                    alt={userProfile.display_name || userProfile.name || 'User'}
                    className="w-8 h-8 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/%3E%3Cpath d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/%3E%3C/svg%3E';
                    }}
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                    <User size={16} className="text-gray-600 dark:text-gray-300" />
                  </div>
                )}
                <div className="flex flex-col">
                  {userProfile && (
                    <>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {userProfile.display_name || userProfile.name || 'Anonymous'}
                      </span>
                      {userProfile.nip05 && (
                        <span className="text-xs text-green-600 dark:text-green-400">
                          ✓ {userProfile.nip05}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* User Avatar - Mobile */}
              <div className="md:hidden">
                {userProfile?.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={userProfile.picture}
                    alt={userProfile.display_name || userProfile.name || 'User'}
                    className="w-8 h-8 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/%3E%3Cpath d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/%3E%3C/svg%3E';
                    }}
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                    <User size={16} className="text-gray-600 dark:text-gray-300" />
                  </div>
                )}
              </div>

              <button
                onClick={handleDisconnect}
                className="flex items-center space-x-2 px-4 py-2 text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
                title="Disconnect"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            <button
              onClick={() => setActiveTab('myList')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'myList'
                  ? 'border-red-600 text-red-600 dark:border-red-500 dark:text-red-500'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              My Mute List
            </button>
            <button
              onClick={() => setActiveTab('publicLists')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'publicLists'
                  ? 'border-red-600 text-red-600 dark:border-red-500 dark:text-red-500'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Community Packs
            </button>
            <button
              onClick={() => setActiveTab('muteuals')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'muteuals'
                  ? 'border-red-600 text-red-600 dark:border-red-500 dark:text-red-500'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Muteuals
            </button>
            <button
              onClick={() => setActiveTab('backups')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'backups'
                  ? 'border-red-600 text-red-600 dark:border-red-500 dark:text-red-500'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Backups
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'settings'
                  ? 'border-red-600 text-red-600 dark:border-red-500 dark:text-red-500'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Settings
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'myList' && <MyMuteList />}
        {activeTab === 'publicLists' && <PublicLists />}
        {activeTab === 'muteuals' && <Muteuals />}
        {activeTab === 'backups' && <Backups />}
        {activeTab === 'settings' && <Settings />}
      </main>

      {/* User Profile Modal */}
      {selectedProfile && (
        <UserProfileModal
          profile={selectedProfile}
          onClose={() => setSelectedProfile(null)}
        />
      )}

      {/* Onboarding Modal */}
      {showOnboarding && (
        <OnboardingModal
          onClose={handleSkipOnboarding}
          onCreateBackup={handleCreateBackup}
          onSkip={handleSkipOnboarding}
        />
      )}
    </div>
  );
}
