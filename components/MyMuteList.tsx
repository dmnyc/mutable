'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { useAuth } from '@/hooks/useAuth';
import { publishMuteList } from '@/lib/nostr';
import { Save, RefreshCw, Download, Upload, Archive, X, AlertCircle } from 'lucide-react';
import MuteListCategory from './MuteListCategory';
import BackupRestore from './BackupRestore';

export default function MyMuteList() {
  const { session, reloadMuteList } = useAuth();
  const {
    muteList,
    muteListLoading,
    muteListError,
    hasUnsavedChanges,
    setHasUnsavedChanges
  } = useStore();

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [showRestoredNotification, setShowRestoredNotification] = useState(false);

  // Show notification if we restored unsaved changes
  useEffect(() => {
    if (hasUnsavedChanges) {
      setShowRestoredNotification(true);
      // Auto-hide after 10 seconds
      const timer = setTimeout(() => setShowRestoredNotification(false), 10000);
      return () => clearTimeout(timer);
    }
  }, []); // Only run on mount

  const handlePublish = async () => {
    if (!session) return;

    try {
      setPublishing(true);
      setPublishError(null);
      setPublishSuccess(false);

      await publishMuteList(muteList, session.relays);

      setHasUnsavedChanges(false);
      setPublishSuccess(true);

      // Clear success message after 3 seconds
      setTimeout(() => setPublishSuccess(false), 3000);
    } catch (error) {
      setPublishError(
        error instanceof Error ? error.message : 'Failed to publish mute list'
      );
    } finally {
      setPublishing(false);
    }
  };

  const handleDiscard = async () => {
    if (!session) return;

    if (confirm('Are you sure you want to discard all unsaved changes? This will reload your mute list from Nostr.')) {
      try {
        await reloadMuteList();
      } catch (error) {
        console.error('Failed to reload mute list:', error);
      }
    }
  };

  const totalMutedItems =
    muteList.pubkeys.length +
    muteList.words.length +
    muteList.tags.length +
    muteList.threads.length;

  return (
    <div className="space-y-6">
      {/* Restored Changes Notification */}
      {showRestoredNotification && hasUnsavedChanges && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-amber-600 dark:text-amber-500 mt-0.5" size={20} />
            <div className="flex-1">
              <h3 className="font-semibold text-amber-900 dark:text-amber-100">
                Unsaved Changes Restored
              </h3>
              <p className="text-sm text-amber-800 dark:text-amber-200 mt-1">
                Your previous session had unsaved changes that have been restored. Don&apos;t forget to publish or discard them.
              </p>
            </div>
            <button
              onClick={() => setShowRestoredNotification(false)}
              className="text-amber-600 dark:text-amber-500 hover:text-amber-800 dark:hover:text-amber-300"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Header with Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              My Mute List
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {totalMutedItems} {totalMutedItems === 1 ? 'item' : 'items'} muted
              {hasUnsavedChanges && (
                <span className="ml-2 text-amber-600 dark:text-amber-500">
                  (Unsaved changes)
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <BackupRestore />

            {hasUnsavedChanges && (
              <button
                onClick={handleDiscard}
                disabled={publishing}
                className="flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              >
                <X size={16} />
                <span>Discard Changes</span>
              </button>
            )}

            <button
              onClick={handlePublish}
              disabled={publishing || !hasUnsavedChanges}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                hasUnsavedChanges
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500'
              }`}
            >
              <Save size={16} />
              <span>{publishing ? 'Publishing...' : 'Publish Changes'}</span>
            </button>
          </div>
        </div>

        {/* Success/Error Messages */}
        {publishSuccess && (
          <div className="mt-4 p-3 bg-green-100 dark:bg-green-900 border border-green-400 dark:border-green-700 rounded text-green-700 dark:text-green-200 text-sm">
            Mute list published successfully!
          </div>
        )}

        {publishError && (
          <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 rounded text-red-700 dark:text-red-200 text-sm">
            {publishError}
          </div>
        )}

        {muteListError && (
          <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 rounded text-red-700 dark:text-red-200 text-sm">
            {muteListError}
          </div>
        )}
      </div>

      {/* Loading State */}
      {muteListLoading && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-12 text-center">
          <RefreshCw className="animate-spin mx-auto mb-3 text-gray-400" size={32} />
          <p className="text-gray-600 dark:text-gray-400">Loading mute list...</p>
        </div>
      )}

      {/* Mute List Categories */}
      {!muteListLoading && (
        <div className="space-y-6">
          <MuteListCategory
            category="pubkeys"
            title="Muted Pubkeys"
            items={muteList.pubkeys}
            placeholder="Enter pubkey (hex or npub)"
          />

          <MuteListCategory
            category="words"
            title="Muted Words"
            items={muteList.words}
            placeholder="Enter word or phrase"
          />

          <MuteListCategory
            category="tags"
            title="Muted Tags"
            items={muteList.tags}
            placeholder="Enter hashtag (without #)"
          />

          <MuteListCategory
            category="threads"
            title="Muted Threads"
            items={muteList.threads}
            placeholder="Enter event ID"
          />
        </div>
      )}
    </div>
  );
}
