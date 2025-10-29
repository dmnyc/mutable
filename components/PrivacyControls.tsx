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
        <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="flex items-start gap-3">
            <Info size={20} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-sm text-blue-900 dark:text-blue-200">
              <div className="flex items-start justify-between mb-3">
                <p className="font-semibold">Understanding Public vs Private Mutes</p>
                <button
                  onClick={() => setShowInfo(false)}
                  className="text-xs text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-100 underline ml-4"
                >
                  Dismiss
                </button>
              </div>

              {/* What they are */}
              <div className="mb-3">
                <p className="font-medium mb-1">What are they?</p>
                <ul className="space-y-1 list-disc ml-4">
                  <li>
                    <strong>Public</strong>: Stored in event tags. Anyone can see who/what you've muted.
                  </li>
                  <li>
                    <strong>Private</strong>: Encrypted using NIP-04. Only you can decrypt and see these mutes.
                  </li>
                </ul>
              </div>

              {/* Client Compatibility Warning */}
              <div className="p-3 bg-red-100 dark:bg-red-900/40 border-2 border-red-400 dark:border-red-700 rounded mb-3">
                <div className="flex items-start gap-2">
                  <AlertCircle size={16} className="text-red-700 dark:text-red-300 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-red-900 dark:text-red-100 mb-2">🚨 Critical: Client Compatibility & Data Loss Risk</p>
                    <ul className="space-y-2 list-disc ml-4 text-red-900 dark:text-red-100">
                      <li>
                        <strong>Public mutes work in ALL clients</strong> (Damus, Primal, Amethyst, Jumble, etc.)
                      </li>
                      <li>
                        <strong>Private mutes:</strong>
                        <ul className="list-circle ml-4 mt-1 space-y-1">
                          <li><strong className="text-green-700 dark:text-green-300">✓ Work:</strong> Primal, Amethyst (they decrypt them)</li>
                          <li><strong className="text-red-700 dark:text-red-400">✗ Don't work:</strong> Damus (doesn't decrypt)</li>
                        </ul>
                      </li>
                      <li className="font-bold">
                        <strong className="text-red-800 dark:text-red-200">⚠️ DATA LOSS WARNING:</strong> If you mute someone in another client, it may <strong>overwrite your entire mute list and DELETE all private mutes!</strong> This happens because these clients don't preserve the encrypted content field.
                      </li>
                      <li>
                        <strong>Safe practice:</strong> If using private mutes, ONLY manage your mute list through Mutable to avoid data loss.
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Recommendation */}
              <div className="p-2 bg-blue-100 dark:bg-blue-900/40 rounded">
                <p className="text-blue-900 dark:text-blue-100">
                  <strong>💡 Recommendation:</strong> Keep mutes <strong>public</strong> if you want them to work across all your Nostr clients. Only use private for extra privacy when you understand they won't work in most other clients.
                </p>
              </div>

              <p className="mt-2 text-xs">
                Individual items can be toggled using the lock icon (🔓/🔒) next to each mute.
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
            {publicPubkeys} {publicPubkeys === 1 ? 'account' : 'accounts'}
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
            {privatePubkeys} {privatePubkeys === 1 ? 'account' : 'accounts'}
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
          <strong>Recommendation:</strong> Keep mutes <strong>public</strong> if you use multiple Nostr clients (Damus, Primal, etc.) to ensure mutes work everywhere. Only use private mutes if you primarily use this app for mute management and understand they won't work in most other clients.
        </p>
      </div>
    </div>
  );
}
