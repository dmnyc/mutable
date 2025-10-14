'use client';

import { useState } from 'react';
import { PublicMuteList } from '@/types';
import { useStore } from '@/lib/store';
import { hexToNpub } from '@/lib/nostr';
import { Copy, ChevronDown, ChevronUp, User, Calendar, Shield, Check } from 'lucide-react';
import ImportConfirmationDialog from './ImportConfirmationDialog';

interface PublicListCardProps {
  list: PublicMuteList;
}

export default function PublicListCard({ list }: PublicListCardProps) {
  const { muteList, setMuteList, setHasUnsavedChanges, getNewItemsCount, markPackItemsAsImported } = useStore();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);

  const totalItems =
    list.list.pubkeys.length +
    list.list.words.length +
    list.list.tags.length +
    list.list.threads.length;

  const newItemsCount = getNewItemsCount(list);
  const allImported = newItemsCount === 0;

  const handleImportClick = () => {
    if (allImported) return;
    setShowConfirmDialog(true);
  };

  const handleConfirmImport = async () => {
    // Merge the public list with the user's current mute list
    const itemsToImport: string[] = [];

    const newMuteList = {
      pubkeys: [
        ...muteList.pubkeys,
        ...list.list.pubkeys.filter((item) => {
          const exists = muteList.pubkeys.some((existing) => existing.value === item.value);
          if (!exists) itemsToImport.push(item.value);
          return !exists;
        })
      ],
      words: [
        ...muteList.words,
        ...list.list.words.filter((item) => {
          const exists = muteList.words.some((existing) => existing.value === item.value);
          if (!exists) itemsToImport.push(item.value);
          return !exists;
        })
      ],
      tags: [
        ...muteList.tags,
        ...list.list.tags.filter((item) => {
          const exists = muteList.tags.some((existing) => existing.value === item.value);
          if (!exists) itemsToImport.push(item.value);
          return !exists;
        })
      ],
      threads: [
        ...muteList.threads,
        ...list.list.threads.filter((item) => {
          const exists = muteList.threads.some((existing) => existing.value === item.value);
          if (!exists) itemsToImport.push(item.value);
          return !exists;
        })
      ]
    };

    setMuteList(newMuteList);
    setHasUnsavedChanges(true);
    markPackItemsAsImported(list.id, itemsToImport);
    setImportSuccess(true);
    setTimeout(() => setImportSuccess(false), 3000);
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
    <>
      <div className="bg-gradient-to-br from-white to-gray-50 dark:from-gray-800 dark:to-gray-850 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="text-red-600 dark:text-red-500" size={20} />
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  {list.name}
                </h3>
              </div>
              {list.description && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">
                  {list.description}
                </p>
              )}
              <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
                <div className="flex items-center gap-1.5">
                  <User size={14} />
                  <span className="font-mono">{displayAuthor()}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Calendar size={14} />
                  <span>{formatDate(list.createdAt)}</span>
                </div>
              </div>
            </div>

            <button
              onClick={handleImportClick}
              disabled={allImported}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                importSuccess
                  ? 'bg-green-600 text-white'
                  : allImported
                  ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                  : 'bg-red-600 text-white hover:bg-red-700 hover:scale-105'
              }`}
            >
              {importSuccess ? (
                <>
                  <Check size={16} />
                  <span>Imported!</span>
                </>
              ) : allImported ? (
                <>
                  <Check size={16} />
                  <span>All Imported</span>
                </>
              ) : (
                <>
                  <Copy size={16} />
                  <span className="hidden sm:inline">Import</span>
                  <span className="sm:hidden">+</span>
                  {newItemsCount > 0 && (
                    <span className="bg-white/20 px-2 py-0.5 rounded text-xs">
                      {newItemsCount}
                    </span>
                  )}
                </>
              )}
            </button>
          </div>

          {/* Stats */}
          <div className="flex items-center justify-between py-3 border-t border-gray-200 dark:border-gray-700">
            <div className="grid grid-cols-2 sm:flex sm:space-x-6 gap-2 sm:gap-0 text-sm">
              <div className="flex items-center gap-1">
                <span className="text-gray-600 dark:text-gray-400">Pubkeys:</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {list.list.pubkeys.length}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-600 dark:text-gray-400">Words:</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {list.list.words.length}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-600 dark:text-gray-400">Tags:</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {list.list.tags.length}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-600 dark:text-gray-400">Threads:</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {list.list.threads.length}
                </span>
              </div>
            </div>

            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1 text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
            >
              <span className="hidden sm:inline">{isExpanded ? 'Hide' : 'Show'} Details</span>
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>

          {/* New items badge */}
          {newItemsCount > 0 && !allImported && (
            <div className="mt-3 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>{newItemsCount}</strong> new {newItemsCount === 1 ? 'item' : 'items'} available to import
              </p>
            </div>
          )}

          {/* Expanded Details */}
          {isExpanded && (
            <div className="mt-4 space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              {list.list.pubkeys.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                    <span>Muted Pubkeys</span>
                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                      ({list.list.pubkeys.length} total)
                    </span>
                  </h4>
                  <div className="space-y-1">
                    {list.list.pubkeys.slice(0, 5).map((item) => (
                      <div
                        key={item.value}
                        className="text-xs font-mono text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 px-3 py-2 rounded border border-gray-200 dark:border-gray-700"
                      >
                        {item.value.slice(0, 16)}...{item.value.slice(-8)}
                        {item.reason && (
                          <span className="ml-2 text-gray-500 dark:text-gray-500">({item.reason})</span>
                        )}
                      </div>
                    ))}
                    {list.list.pubkeys.length > 5 && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 italic pl-3 pt-1">
                        ...and {list.list.pubkeys.length - 5} more
                      </p>
                    )}
                  </div>
                </div>
              )}

              {list.list.words.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                    <span>Muted Words</span>
                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                      ({list.list.words.length} total)
                    </span>
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {list.list.words.slice(0, 10).map((item) => (
                      <span
                        key={item.value}
                        className="text-xs bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded-full text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600"
                      >
                        {item.value}
                      </span>
                    ))}
                    {list.list.words.length > 10 && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 italic self-center">
                        +{list.list.words.length - 10} more
                      </span>
                    )}
                  </div>
                </div>
              )}

              {list.list.tags.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                    <span>Muted Tags</span>
                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                      ({list.list.tags.length} total)
                    </span>
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {list.list.tags.slice(0, 10).map((item) => (
                      <span
                        key={item.value}
                        className="text-xs bg-purple-100 dark:bg-purple-900/30 px-3 py-1.5 rounded-full text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700"
                      >
                        #{item.value}
                      </span>
                    ))}
                    {list.list.tags.length > 10 && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 italic self-center">
                        +{list.list.tags.length - 10} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Dialog */}
      <ImportConfirmationDialog
        isOpen={showConfirmDialog}
        onClose={() => setShowConfirmDialog(false)}
        pack={list}
        onConfirm={handleConfirmImport}
        newItemsCount={newItemsCount}
        totalItemsCount={totalItems}
      />
    </>
  );
}
