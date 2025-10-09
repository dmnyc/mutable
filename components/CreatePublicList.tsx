'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useStore } from '@/lib/store';
import { publishPublicList } from '@/lib/nostr';
import { X, Plus, Trash2 } from 'lucide-react';
import { MuteList, MuteItem } from '@/types';

interface CreatePublicListProps {
  onClose: () => void;
}

export default function CreatePublicList({ onClose }: CreatePublicListProps) {
  const { session } = useAuth();
  const { muteList } = useStore();

  const [listName, setListName] = useState('');
  const [description, setDescription] = useState('');
  const [useCurrentList, setUseCurrentList] = useState(true);
  const [customList, setCustomList] = useState<MuteList>({
    pubkeys: [],
    words: [],
    tags: [],
    threads: []
  });

  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handlePublish = async () => {
    if (!session) return;

    if (!listName.trim()) {
      setError('List name is required');
      return;
    }

    try {
      setPublishing(true);
      setError(null);

      const listToPublish = useCurrentList ? muteList : customList;

      await publishPublicList(
        listName.trim(),
        description.trim(),
        listToPublish,
        session.relays
      );

      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish list');
    } finally {
      setPublishing(false);
    }
  };

  const totalItems = useCurrentList
    ? muteList.pubkeys.length +
      muteList.words.length +
      muteList.tags.length +
      muteList.threads.length
    : customList.pubkeys.length +
      customList.words.length +
      customList.tags.length +
      customList.threads.length;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              Create Public Mute List
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Success Message */}
          {success && (
            <div className="p-4 bg-green-100 dark:bg-green-900 border border-green-400 dark:border-green-700 rounded text-green-700 dark:text-green-200">
              Public list published successfully!
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-4 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 rounded text-red-700 dark:text-red-200">
              {error}
            </div>
          )}

          {/* List Details */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                List Name <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                placeholder="e.g., spam-bots, nsfw-content"
                className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Use a descriptive, unique name (lowercase, hyphens allowed)
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what this list contains and its purpose"
                rows={3}
                className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
              />
            </div>
          </div>

          {/* List Source */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              List Contents
            </label>

            <div className="space-y-2">
              <label className="flex items-start space-x-3 p-4 border-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 border-gray-300 dark:border-gray-600">
                <input
                  type="radio"
                  checked={useCurrentList}
                  onChange={() => setUseCurrentList(true)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900 dark:text-white">
                    Use My Current Mute List
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    Publish your current mute list with {muteList.pubkeys.length +
                      muteList.words.length +
                      muteList.tags.length +
                      muteList.threads.length}{' '}
                    items
                  </div>
                </div>
              </label>

              <label className="flex items-start space-x-3 p-4 border-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 border-gray-300 dark:border-gray-600">
                <input
                  type="radio"
                  checked={!useCurrentList}
                  onChange={() => setUseCurrentList(false)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900 dark:text-white">
                    Create Custom List
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    Build a new list from scratch
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* List Preview */}
          <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              List Preview
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-600 dark:text-gray-400">Pubkeys: </span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {useCurrentList ? muteList.pubkeys.length : customList.pubkeys.length}
                </span>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">Words: </span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {useCurrentList ? muteList.words.length : customList.words.length}
                </span>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">Tags: </span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {useCurrentList ? muteList.tags.length : customList.tags.length}
                </span>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">Threads: </span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {useCurrentList ? muteList.threads.length : customList.threads.length}
                </span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-gray-300 dark:border-gray-600">
              <span className="text-sm text-gray-600 dark:text-gray-400">Total: </span>
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                {totalItems} items
              </span>
            </div>
          </div>

          {/* Notice */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <p className="text-sm text-blue-900 dark:text-blue-200">
              <strong>Note:</strong> Public lists are visible to everyone on Nostr. They can be
              discovered and used by other users. Make sure you&apos;re comfortable sharing this
              information publicly.
            </p>
          </div>

          {/* Actions */}
          <div className="flex space-x-3 pt-4">
            <button
              onClick={handlePublish}
              disabled={publishing || !listName.trim() || totalItems === 0}
              className="flex-1 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {publishing ? 'Publishing...' : 'Publish List'}
            </button>
            <button
              onClick={onClose}
              disabled={publishing}
              className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors font-semibold"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
