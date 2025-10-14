'use client';

import { useState } from 'react';
import { X, Shield, AlertTriangle, Loader2, Archive } from 'lucide-react';
import { PublicMuteList } from '@/types';

interface ImportConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  pack: PublicMuteList | null;
  onConfirm: () => Promise<void>;
  newItemsCount: number;
  totalItemsCount: number;
}

export default function ImportConfirmationDialog({
  isOpen,
  onClose,
  pack,
  onConfirm,
  newItemsCount,
  totalItemsCount,
}: ImportConfirmationDialogProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  if (!isOpen || !pack) return null;

  const handleConfirm = async () => {
    setIsProcessing(true);
    setProgress(0);

    // Simulate progress
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) {
          clearInterval(interval);
          return 90;
        }
        return prev + 10;
      });
    }, 200);

    try {
      await onConfirm();
      setProgress(100);
      setTimeout(() => {
        onClose();
        setIsProcessing(false);
        setProgress(0);
      }, 1000);
    } catch (error) {
      clearInterval(interval);
      setIsProcessing(false);
      setProgress(0);
      console.error('Failed to import pack:', error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="text-red-600 dark:text-red-500" size={24} />
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Confirm Import
              </h2>
            </div>
            <button
              onClick={onClose}
              disabled={isProcessing}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
            >
              <X size={24} />
            </button>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
            You are about to import items from &quot;{pack.name}&quot;
          </p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Safety Backup Notice */}
          <div className="rounded-lg border border-blue-500/20 bg-blue-50 dark:bg-blue-900/20 p-4">
            <div className="flex items-start gap-3">
              <Archive className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" size={20} />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                  Safety Backup Recommended
                </p>
                <p className="text-xs text-blue-800 dark:text-blue-200">
                  We recommend creating a backup of your current mute list before importing. You can do this from the &quot;My Mute List&quot; tab.
                </p>
              </div>
            </div>
          </div>

          {/* Warning */}
          <div className="rounded-lg border border-red-500/20 bg-red-50 dark:bg-red-900/20 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" size={20} />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-red-900 dark:text-red-100">
                  This action will add {newItemsCount} new {newItemsCount === 1 ? 'item' : 'items'}
                </p>
                <p className="text-xs text-red-800 dark:text-red-200">
                  A mute list event (kind 10000) will be published to your configured Nostr relays. These mutes will apply across all compatible Nostr clients.
                </p>
              </div>
            </div>
          </div>

          {/* Pack Details */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Pack details:</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Name:</span>
                <span className="font-medium text-gray-900 dark:text-white">{pack.name}</span>
              </div>
              {pack.description && (
                <div className="flex flex-col gap-1">
                  <span className="text-gray-600 dark:text-gray-400">Description:</span>
                  <span className="text-gray-900 dark:text-white text-xs">{pack.description}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Total items:</span>
                <span className="font-medium text-gray-900 dark:text-white">{totalItemsCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">New items to add:</span>
                <span className="font-medium text-red-600 dark:text-red-400">{newItemsCount}</span>
              </div>
              <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Pubkeys: </span>
                    <span className="font-medium text-gray-900 dark:text-white">{pack.list.pubkeys.length}</span>
                  </div>
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Words: </span>
                    <span className="font-medium text-gray-900 dark:text-white">{pack.list.words.length}</span>
                  </div>
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Tags: </span>
                    <span className="font-medium text-gray-900 dark:text-white">{pack.list.tags.length}</span>
                  </div>
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Threads: </span>
                    <span className="font-medium text-gray-900 dark:text-white">{pack.list.threads.length}</span>
                  </div>
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 pt-2">
              This will update your mute list across all Nostr clients that support NIP-51.
            </p>
          </div>

          {/* Progress */}
          {isProcessing && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 className="text-red-600 animate-spin" size={16} />
                <span className="text-sm text-gray-900 dark:text-white">Processing import...</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-red-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isProcessing}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isProcessing ? (
              <>
                <Loader2 className="animate-spin" size={16} />
                Processing...
              </>
            ) : (
              <>
                <Shield size={16} />
                Import {newItemsCount} {newItemsCount === 1 ? 'item' : 'items'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
