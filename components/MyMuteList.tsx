'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { useAuth } from '@/hooks/useAuth';
import { publishMuteList } from '@/lib/nostr';
import { Save, RefreshCw, Download, Upload, Archive, FolderOpen } from 'lucide-react';
import MuteListCategory from './MuteListCategory';
import PrivacyControls from './PrivacyControls';

export default function MyMuteList() {
  const { session, reloadMuteList } = useAuth();
  const {
    muteList,
    muteListLoading,
    muteListError,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    setActiveTab
  } = useStore();

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = useState(false);

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
    <div className="space-y-6 w-full max-w-full">
      {/* Header with Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 w-full max-w-full">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              My Mute List
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {muteList.pubkeys.length} {muteList.pubkeys.length === 1 ? 'profile' : 'profiles'}
              {muteList.words.length > 0 && `, ${muteList.words.length} ${muteList.words.length === 1 ? 'word' : 'words'}`}
              {muteList.tags.length > 0 && `, ${muteList.tags.length} ${muteList.tags.length === 1 ? 'tag' : 'tags'}`}
              {muteList.threads.length > 0 && `, ${muteList.threads.length} ${muteList.threads.length === 1 ? 'thread' : 'threads'}`}
              {hasUnsavedChanges && (
                <span className="ml-2 text-amber-600 dark:text-amber-500">
                  (Unsaved changes)
                </span>
              )}
            </p>
          </div>

          <button
            onClick={() => setActiveTab('backups')}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium w-full sm:w-auto"
          >
            <Archive size={18} />
            <span>Manage Backups</span>
          </button>
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

      {/* Privacy Controls */}
      {!muteListLoading && (
        <PrivacyControls />
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
