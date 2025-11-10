'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Lock, Unlock, Eye, EyeOff, Info, AlertCircle } from 'lucide-react';

export default function PrivacyControls() {
  const { muteList, bulkSetPrivacy } = useStore();
  const [showInfo, setShowInfo] = useState(true); // Default to visible

  const publicPubkeys = muteList.pubkeys.filter(item => !item.private).length;
  const publicWords = muteList.words.filter(item => !item.private).length;
  const publicTags = muteList.tags.filter(item => !item.private).length;
  const publicThreads = muteList.threads.filter(item => !item.private).length;
  const publicCount = publicPubkeys + publicWords + publicTags + publicThreads;

  const privatePubkeys = muteList.pubkeys.filter(item => item.private).length;
  const privateWords = muteList.words.filter(item => item.private).length;
  const privateTags = muteList.tags.filter(item => item.private).length;
  const privateThreads = muteList.threads.filter(item => item.private).length;
  const privateCount = privatePubkeys + privateWords + privateTags + privateThreads;

  const handleMakeAllPrivate = () => {
    if (confirm(`This will make all ${publicCount} public mutes private (encrypted). Continue?`)) {
      bulkSetPrivacy(true);
    }
  };

  const handleMakeAllPublic = () => {
    if (confirm(`This will make all ${privateCount} private mutes public (visible to everyone). Continue?`)) {
      bulkSetPrivacy(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Privacy Controls
        </h3>
        <button
          onClick={() => setShowInfo(!showInfo)}
          className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          title="About privacy"
        >
          <Info size={18} />
        </button>
      </div>

      {showInfo && (
        <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg overflow-hidden">
          <div className="flex items-start gap-3">
            <Info size={20} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 text-sm text-gray-900 dark:text-gray-200 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-blue-900 dark:text-blue-100 break-words">Understanding Public vs Private Mutes</p>
                <button
                  onClick={() => setShowInfo(false)}
                  className="text-xs text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-100 underline whitespace-nowrap flex-shrink-0"
                >
                  Dismiss
                </button>
              </div>

              <div className="space-y-2">
                <p className="break-words"><strong>Public:</strong> Stored in event tags, visible to everyone. Works in all clients.</p>

                <p className="break-words"><strong>Private:</strong> Encrypted using NIP-04. Works in Primal and Amethyst, but not Damus.</p>

                <p className="text-amber-800 dark:text-amber-300 break-words"><strong>⚠️ Warning:</strong> Other clients may overwrite and delete all private mutes. Only manage private mutes through Mutable.</p>

                <p className="text-blue-900 dark:text-blue-100 break-words"><strong>💡 Recommendation:</strong> Use public mutes for compatibility across all clients. Private mutes offer less compatibility.</p>
              </div>

              <p className="text-xs text-gray-600 dark:text-gray-400 break-words">
                Individual items can be toggled using the lock icon next to each mute.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Public Mutes */}
        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Eye size={20} className="text-amber-600 dark:text-amber-400" />
              <h4 className="font-semibold text-amber-900 dark:text-amber-100">
                Public Mutes
              </h4>
            </div>
            <span className="text-xs font-medium text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/40 px-2 py-1 rounded">
              More Compatible
            </span>
          </div>
          <p className="text-2xl font-bold text-amber-900 dark:text-amber-100 mb-1">
            {publicCount}
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300 mb-2">
            {publicPubkeys} {publicPubkeys === 1 ? 'profile' : 'profiles'}
            {publicWords > 0 && `, ${publicWords} ${publicWords === 1 ? 'word' : 'words'}`}
            {publicTags > 0 && `, ${publicTags} ${publicTags === 1 ? 'tag' : 'tags'}`}
            {publicThreads > 0 && `, ${publicThreads} ${publicThreads === 1 ? 'thread' : 'threads'}`}
          </p>
          <p className="text-sm text-amber-800 dark:text-amber-200 mb-3">
            Visible to everyone
          </p>
          <button
            onClick={handleMakeAllPrivate}
            disabled={publicCount === 0}
            className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Lock size={16} />
            <span>Make All Private</span>
          </button>
        </div>

        {/* Private Mutes */}
        <div className="p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <EyeOff size={20} className="text-purple-600 dark:text-purple-400" />
              <h4 className="font-semibold text-purple-900 dark:text-purple-100">
                Private Mutes
              </h4>
            </div>
            <span className="text-xs font-medium text-orange-700 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/40 px-2 py-1 rounded">
              Less Compatible
            </span>
          </div>
          <p className="text-2xl font-bold text-purple-900 dark:text-purple-100 mb-1">
            {privateCount}
          </p>
          <p className="text-xs text-purple-700 dark:text-purple-300 mb-2">
            {privatePubkeys} {privatePubkeys === 1 ? 'profile' : 'profiles'}
            {privateWords > 0 && `, ${privateWords} ${privateWords === 1 ? 'word' : 'words'}`}
            {privateTags > 0 && `, ${privateTags} ${privateTags === 1 ? 'tag' : 'tags'}`}
            {privateThreads > 0 && `, ${privateThreads} ${privateThreads === 1 ? 'thread' : 'threads'}`}
          </p>
          <p className="text-sm text-purple-800 dark:text-purple-200 mb-3">
            Encrypted (only you can see)
          </p>
          <button
            onClick={handleMakeAllPublic}
            disabled={privateCount === 0}
            className="w-full px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Unlock size={16} />
            <span>Make All Public</span>
          </button>
        </div>
      </div>

      <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
        <p className="text-xs text-gray-600 dark:text-gray-400">
          <strong>Recommendation:</strong> Keep mutes <strong>public</strong> if you use multiple Nostr clients (Damus, Primal, etc.) to ensure mutes work everywhere. Only use private mute lists for extra privacy and understand they won&apos;t work in every client.
        </p>
      </div>
    </div>
  );
}
