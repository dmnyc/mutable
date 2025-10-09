'use client';

import { useState } from 'react';
import { PublicMuteList } from '@/types';
import { useStore } from '@/lib/store';
import { hexToNpub } from '@/lib/nostr';
import { Copy, ChevronDown, ChevronUp, User, Calendar } from 'lucide-react';

interface PublicListCardProps {
  list: PublicMuteList;
}

export default function PublicListCard({ list }: PublicListCardProps) {
  const { muteList, setMuteList, setHasUnsavedChanges } = useStore();
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const totalItems =
    list.list.pubkeys.length +
    list.list.words.length +
    list.list.tags.length +
    list.list.threads.length;

  const handleCopyToMyList = () => {
    // Merge the public list with the user's current mute list
    const newMuteList = {
      pubkeys: [
        ...muteList.pubkeys,
        ...list.list.pubkeys.filter(
          (item) => !muteList.pubkeys.some((existing) => existing.value === item.value)
        )
      ],
      words: [
        ...muteList.words,
        ...list.list.words.filter(
          (item) => !muteList.words.some((existing) => existing.value === item.value)
        )
      ],
      tags: [
        ...muteList.tags,
        ...list.list.tags.filter(
          (item) => !muteList.tags.some((existing) => existing.value === item.value)
        )
      ],
      threads: [
        ...muteList.threads,
        ...list.list.threads.filter(
          (item) => !muteList.threads.some((existing) => existing.value === item.value)
        )
      ]
    };

    setMuteList(newMuteList);
    setHasUnsavedChanges(true);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString();
  };

  const displayAuthor = () => {
    try {
      const npub = hexToNpub(list.author);
      return `${npub.slice(0, 12)}...${npub.slice(-8)}`;
    } catch {
      return `${list.author.slice(0, 12)}...${list.author.slice(-8)}`;
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              {list.name}
            </h3>
            {list.description && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                {list.description}
              </p>
            )}
            <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
              <div className="flex items-center space-x-1">
                <User size={14} />
                <span className="font-mono">{displayAuthor()}</span>
              </div>
              <div className="flex items-center space-x-1">
                <Calendar size={14} />
                <span>{formatDate(list.createdAt)}</span>
              </div>
            </div>
          </div>

          <button
            onClick={handleCopyToMyList}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              copied
                ? 'bg-green-600 text-white'
                : 'bg-red-600 text-white hover:bg-red-700'
            }`}
          >
            <Copy size={16} />
            <span>{copied ? 'Copied!' : 'Copy to My List'}</span>
          </button>
        </div>

        {/* Stats */}
        <div className="flex items-center justify-between py-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex space-x-6 text-sm">
            <div>
              <span className="text-gray-600 dark:text-gray-400">Pubkeys: </span>
              <span className="font-semibold text-gray-900 dark:text-white">
                {list.list.pubkeys.length}
              </span>
            </div>
            <div>
              <span className="text-gray-600 dark:text-gray-400">Words: </span>
              <span className="font-semibold text-gray-900 dark:text-white">
                {list.list.words.length}
              </span>
            </div>
            <div>
              <span className="text-gray-600 dark:text-gray-400">Tags: </span>
              <span className="font-semibold text-gray-900 dark:text-white">
                {list.list.tags.length}
              </span>
            </div>
            <div>
              <span className="text-gray-600 dark:text-gray-400">Threads: </span>
              <span className="font-semibold text-gray-900 dark:text-white">
                {list.list.threads.length}
              </span>
            </div>
          </div>

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center space-x-1 text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
          >
            <span>{isExpanded ? 'Hide' : 'Show'} Details</span>
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="mt-4 space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            {list.list.pubkeys.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                  Muted Pubkeys
                </h4>
                <div className="space-y-1">
                  {list.list.pubkeys.slice(0, 5).map((item) => (
                    <div
                      key={item.value}
                      className="text-xs font-mono text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 px-2 py-1 rounded"
                    >
                      {item.value.slice(0, 16)}...{item.value.slice(-8)}
                      {item.reason && (
                        <span className="ml-2 text-gray-500">({item.reason})</span>
                      )}
                    </div>
                  ))}
                  {list.list.pubkeys.length > 5 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                      ...and {list.list.pubkeys.length - 5} more
                    </p>
                  )}
                </div>
              </div>
            )}

            {list.list.words.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                  Muted Words
                </h4>
                <div className="flex flex-wrap gap-2">
                  {list.list.words.slice(0, 10).map((item) => (
                    <span
                      key={item.value}
                      className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-gray-700 dark:text-gray-300"
                    >
                      {item.value}
                    </span>
                  ))}
                  {list.list.words.length > 10 && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 italic">
                      +{list.list.words.length - 10} more
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
