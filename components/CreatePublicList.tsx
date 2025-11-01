'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useStore } from '@/lib/store';
import { publishPublicList, npubToHex, PACK_CATEGORIES, PackCategory } from '@/lib/nostr';
import { X, Plus, Trash2, AlertCircle, Tag } from 'lucide-react';
import { MuteList, MutedPubkey, MutedWord, MutedTag } from '@/types';

interface CreatePublicListProps {
  onClose: () => void;
}

export default function CreatePublicList({ onClose }: CreatePublicListProps) {
  const { session } = useAuth();
  const { muteList } = useStore();

  const [listName, setListName] = useState('');
  const [description, setDescription] = useState('');
  const [useCurrentList, setUseCurrentList] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<PackCategory[]>([]);
  const [customList, setCustomList] = useState<MuteList>({
    pubkeys: [],
    words: [],
    tags: [],
    threads: []
  });

  // Batch input states
  const [batchNpubInput, setBatchNpubInput] = useState('');
  const [batchWordInput, setBatchWordInput] = useState('');
  const [batchTagInput, setBatchTagInput] = useState('');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Add batch npubs
  const handleAddBatchNpubs = () => {
    const lines = batchNpubInput.split('\n').filter(line => line.trim());
    const errors: string[] = [];
    const validPubkeys: MutedPubkey[] = [];

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        let hex: string;
        if (trimmed.startsWith('npub')) {
          hex = npubToHex(trimmed);
        } else if (trimmed.length === 64 && /^[0-9a-f]+$/i.test(trimmed)) {
          hex = trimmed.toLowerCase();
        } else {
          errors.push(`Line ${index + 1}: Invalid format "${trimmed.slice(0, 20)}..."`);
          return;
        }

        // Check for duplicates
        if (!customList.pubkeys.some(p => p.value === hex)) {
          validPubkeys.push({ type: 'pubkey', value: hex });
        }
      } catch (err) {
        errors.push(`Line ${index + 1}: ${err instanceof Error ? err.message : 'Invalid npub'}`);
      }
    });

    if (errors.length > 0) {
      setValidationErrors(errors);
    } else {
      setValidationErrors([]);
    }

    if (validPubkeys.length > 0) {
      setCustomList({
        ...customList,
        pubkeys: [...customList.pubkeys, ...validPubkeys]
      });
      setBatchNpubInput('');
    }
  };

  // Add batch words
  const handleAddBatchWords = () => {
    const words = batchWordInput
      .split('\n')
      .map(w => w.trim())
      .filter(w => w.length > 0);

    const validWords: MutedWord[] = words
      .filter(word => !customList.words.some(w => w.value === word))
      .map(word => ({ type: 'word', value: word }));

    if (validWords.length > 0) {
      setCustomList({
        ...customList,
        words: [...customList.words, ...validWords]
      });
      setBatchWordInput('');
    }
  };

  // Add batch tags
  const handleAddBatchTags = () => {
    const tags = batchTagInput
      .split('\n')
      .map(t => t.trim().replace(/^#/, '')) // Remove leading # if present
      .filter(t => t.length > 0);

    const validTags: MutedTag[] = tags
      .filter(tag => !customList.tags.some(t => t.value === tag))
      .map(tag => ({ type: 'tag', value: tag }));

    if (validTags.length > 0) {
      setCustomList({
        ...customList,
        tags: [...customList.tags, ...validTags]
      });
      setBatchTagInput('');
    }
  };

  // Remove item
  const handleRemoveItem = (category: keyof MuteList, value: string) => {
    setCustomList({
      ...customList,
      [category]: customList[category].filter(item => item.value !== value)
    });
  };

  // Toggle category selection
  const handleToggleCategory = (category: PackCategory) => {
    if (selectedCategories.includes(category)) {
      setSelectedCategories(selectedCategories.filter(c => c !== category));
    } else {
      setSelectedCategories([...selectedCategories, category]);
    }
  };

  const handlePublish = async () => {
    if (!session) return;

    if (!listName.trim()) {
      setError('Pack name is required');
      return;
    }

    // Validate list name format
    if (!/^[a-z0-9-]+$/.test(listName.trim())) {
      setError('Pack name must contain only lowercase letters, numbers, and hyphens');
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
        session.relays,
        selectedCategories
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

  const MAX_NAME_LENGTH = 50;
  const MAX_DESC_LENGTH = 500;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-6 z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              Create Community Pack
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
              Community pack published successfully!
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-4 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 rounded text-red-700 dark:text-red-200 flex items-start gap-2">
              <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Validation Errors */}
          {validationErrors.length > 0 && (
            <div className="p-4 bg-amber-100 dark:bg-amber-900/30 border border-amber-400 dark:border-amber-700 rounded">
              <div className="flex items-start gap-2 mb-2">
                <AlertCircle size={20} className="flex-shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
                <p className="font-semibold text-amber-900 dark:text-amber-200">
                  Some entries could not be added:
                </p>
              </div>
              <ul className="text-sm text-amber-800 dark:text-amber-300 ml-7 space-y-1">
                {validationErrors.slice(0, 5).map((err, i) => (
                  <li key={i}>• {err}</li>
                ))}
                {validationErrors.length > 5 && (
                  <li className="italic">...and {validationErrors.length - 5} more</li>
                )}
              </ul>
              <button
                onClick={() => setValidationErrors([])}
                className="mt-2 text-sm text-amber-700 dark:text-amber-400 underline hover:no-underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* List Details */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Pack Name <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                placeholder="e.g., spam-bots, nsfw-content, known-scammers"
                maxLength={MAX_NAME_LENGTH}
                className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
              <div className="mt-1 flex justify-between text-xs">
                <span className="text-gray-500 dark:text-gray-400">
                  Use lowercase, numbers, and hyphens only
                </span>
                <span className="text-gray-500 dark:text-gray-400">
                  {listName.length}/{MAX_NAME_LENGTH}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what this pack contains and its purpose..."
                rows={3}
                maxLength={MAX_DESC_LENGTH}
                className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
              <div className="mt-1 flex justify-end text-xs text-gray-500 dark:text-gray-400">
                {description.length}/{MAX_DESC_LENGTH}
              </div>
            </div>

            {/* Category Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Categories (Optional)
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Select one or more categories to help others discover your pack
              </p>
              <div className="flex flex-wrap gap-2">
                {Object.values(PACK_CATEGORIES).map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => handleToggleCategory(category)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all capitalize flex items-center gap-1.5 ${
                      selectedCategories.includes(category)
                        ? 'bg-purple-600 text-white shadow-md'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                    }`}
                  >
                    <Tag size={14} />
                    {category}
                  </button>
                ))}
              </div>
              {selectedCategories.length > 0 && (
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                  Selected: {selectedCategories.join(', ')}
                </div>
              )}
            </div>
          </div>

          {/* List Source */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Pack Contents
            </label>

            <div className="space-y-2">
              <label className={`flex items-start space-x-3 p-4 border-2 rounded-lg cursor-pointer transition-all ${
                useCurrentList
                  ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                  : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}>
                <input
                  type="radio"
                  checked={useCurrentList}
                  onChange={() => setUseCurrentList(true)}
                  className="mt-1 text-red-600"
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

              <label className={`flex items-start space-x-3 p-4 border-2 rounded-lg cursor-pointer transition-all ${
                !useCurrentList
                  ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                  : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}>
                <input
                  type="radio"
                  checked={!useCurrentList}
                  onChange={() => setUseCurrentList(false)}
                  className="mt-1 text-red-600"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900 dark:text-white">
                    Create Custom Pack
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    Build a new pack from scratch with batch input
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Custom List Builder */}
          {!useCurrentList && (
            <div className="space-y-6 border-t border-gray-200 dark:border-gray-700 pt-6">
              {/* Batch Npub Input */}
              <div>
                <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
                  Add Pubkeys (npub or hex)
                </label>
                <textarea
                  value={batchNpubInput}
                  onChange={(e) => setBatchNpubInput(e.target.value)}
                  placeholder="Paste one npub or hex pubkey per line&#10;npub1abc...&#10;npub1def...&#10;0123456789abcdef..."
                  rows={4}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white font-mono text-sm"
                />
                <button
                  onClick={handleAddBatchNpubs}
                  disabled={!batchNpubInput.trim()}
                  className="mt-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Plus size={16} />
                  Add Pubkeys
                </button>

                {/* Pubkey Chips */}
                {customList.pubkeys.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
                      Added pubkeys ({customList.pubkeys.length}):
                    </p>
                    <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2 bg-gray-50 dark:bg-gray-700/50 rounded">
                      {customList.pubkeys.map((item) => (
                        <span
                          key={item.value}
                          className="inline-flex items-center gap-2 px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded-full text-xs font-mono"
                        >
                          <span className="text-gray-700 dark:text-gray-300">
                            {item.value.slice(0, 8)}...{item.value.slice(-4)}
                          </span>
                          <button
                            onClick={() => handleRemoveItem('pubkeys', item.value)}
                            className="text-red-600 dark:text-red-400 hover:text-red-800"
                          >
                            <X size={14} />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Batch Word Input */}
              <div>
                <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
                  Add Words
                </label>
                <textarea
                  value={batchWordInput}
                  onChange={(e) => setBatchWordInput(e.target.value)}
                  placeholder="One word or phrase per line&#10;spam&#10;scam&#10;offensive-word"
                  rows={3}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm"
                />
                <button
                  onClick={handleAddBatchWords}
                  disabled={!batchWordInput.trim()}
                  className="mt-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Plus size={16} />
                  Add Words
                </button>

                {/* Word Chips */}
                {customList.words.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
                      Added words ({customList.words.length}):
                    </p>
                    <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2 bg-gray-50 dark:bg-gray-700/50 rounded">
                      {customList.words.map((item) => (
                        <span
                          key={item.value}
                          className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 rounded-full text-xs"
                        >
                          <span className="text-blue-700 dark:text-blue-300">{item.value}</span>
                          <button
                            onClick={() => handleRemoveItem('words', item.value)}
                            className="text-red-600 dark:text-red-400 hover:text-red-800"
                          >
                            <X size={14} />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Batch Tag Input */}
              <div>
                <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
                  Add Tags
                </label>
                <textarea
                  value={batchTagInput}
                  onChange={(e) => setBatchTagInput(e.target.value)}
                  placeholder="One hashtag per line (# optional)&#10;spam&#10;nsfw&#10;politics"
                  rows={3}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm"
                />
                <button
                  onClick={handleAddBatchTags}
                  disabled={!batchTagInput.trim()}
                  className="mt-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Plus size={16} />
                  Add Tags
                </button>

                {/* Tag Chips */}
                {customList.tags.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
                      Added tags ({customList.tags.length}):
                    </p>
                    <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2 bg-gray-50 dark:bg-gray-700/50 rounded">
                      {customList.tags.map((item) => (
                        <span
                          key={item.value}
                          className="inline-flex items-center gap-2 px-3 py-1 bg-purple-100 dark:bg-purple-900/30 rounded-full text-xs"
                        >
                          <span className="text-purple-700 dark:text-purple-300">#{item.value}</span>
                          <button
                            onClick={() => handleRemoveItem('tags', item.value)}
                            className="text-red-600 dark:text-red-400 hover:text-red-800"
                          >
                            <X size={14} />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* List Preview */}
          <div className="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-750 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              Pack Summary
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Pubkeys:</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {useCurrentList ? muteList.pubkeys.length : customList.pubkeys.length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Words:</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {useCurrentList ? muteList.words.length : customList.words.length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Tags:</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {useCurrentList ? muteList.tags.length : customList.tags.length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Threads:</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {useCurrentList ? muteList.threads.length : customList.threads.length}
                </span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-gray-300 dark:border-gray-600 flex justify-between items-center">
              <span className="text-sm text-gray-600 dark:text-gray-400">Total items:</span>
              <span className="text-lg font-bold text-red-600 dark:text-red-400">
                {totalItems}
              </span>
            </div>
          </div>

          {/* Notice */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <p className="text-sm text-blue-900 dark:text-blue-200">
              <strong>Note:</strong> Community packs are visible to everyone on Nostr. They can be
              discovered and imported by other users. Make sure you&apos;re comfortable sharing this
              information publicly.
            </p>
          </div>

          {/* Actions */}
          <div className="flex space-x-3 pt-4">
            <button
              onClick={handlePublish}
              disabled={publishing || !listName.trim() || totalItems === 0}
              className="flex-1 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {publishing ? (
                <>
                  <span className="animate-spin">⏳</span>
                  Publishing...
                </>
              ) : (
                <>
                  <Plus size={20} />
                  Publish Pack
                </>
              )}
            </button>
            <button
              onClick={onClose}
              disabled={publishing}
              className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors font-semibold disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
