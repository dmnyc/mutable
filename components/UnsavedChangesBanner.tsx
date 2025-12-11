'use client';

import { useStore } from '@/lib/store';
import { AlertCircle, Save, Trash2, Sparkles } from 'lucide-react';

interface UnsavedChangesBannerProps {
  onPublish: () => void;
  onDiscard: () => void;
  onClean: () => void;
}

export default function UnsavedChangesBanner({ onPublish, onDiscard, onClean }: UnsavedChangesBannerProps) {
  const { hasUnsavedChanges, muteList } = useStore();

  if (!hasUnsavedChanges) return null;

  // Calculate total items
  const totalItems = muteList.pubkeys.length + muteList.words.length + muteList.tags.length + muteList.threads.length;

  return (
    <div className="bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <AlertCircle size={20} className="flex-shrink-0 text-amber-600 dark:text-amber-500" />
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 min-w-0">
              <h3 className="font-bold text-lg">Unsaved changes</h3>
              <div className="text-gray-600 dark:text-gray-400 text-xs sm:text-sm truncate">
                {muteList.pubkeys.length} {muteList.pubkeys.length === 1 ? 'profile' : 'profiles'}
                {muteList.words.length > 0 && `, ${muteList.words.length} ${muteList.words.length === 1 ? 'word' : 'words'}`}
                {muteList.tags.length > 0 && `, ${muteList.tags.length} ${muteList.tags.length === 1 ? 'tag' : 'tags'}`}
                {muteList.threads.length > 0 && `, ${muteList.threads.length} ${muteList.threads.length === 1 ? 'thread' : 'threads'}`}
                {' '}— not published yet
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onDiscard}
              className="px-3 sm:px-6 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg transition-colors flex items-center gap-2"
            >
              <Trash2 size={18} />
              <span>Discard</span>
            </button>
            <button
              onClick={onClean}
              className="px-3 sm:px-6 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-2"
              title="Clean up inactive profiles before publishing"
            >
              <Sparkles size={18} />
              <span>Clean</span>
            </button>
            <button
              onClick={onPublish}
              className="px-3 sm:px-6 py-2.5 text-sm font-medium bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 rounded-lg transition-colors flex items-center gap-2 animate-pulse-glow"
            >
              <Save size={18} />
              <span>Publish</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
