"use client";

import { useStore } from "@/lib/store";
import { AlertCircle, Save, Trash2, Sparkles } from "lucide-react";

interface UnsavedChangesBannerProps {
  onPublish: () => void;
  onDiscard: () => void;
  onClean: () => void;
}

export default function UnsavedChangesBanner({
  onPublish,
  onDiscard,
  onClean,
}: UnsavedChangesBannerProps) {
  const { hasUnsavedChanges, muteList } = useStore();

  if (!hasUnsavedChanges) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-amber-50 dark:bg-amber-950 border-t-2 border-amber-500 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <AlertCircle
              size={20}
              className="flex-shrink-0 text-amber-600 dark:text-amber-400"
            />
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 min-w-0">
              <span className="font-bold">Unsaved changes</span>
              <span className="hidden sm:inline text-gray-600 dark:text-gray-400 ml-2">
                {muteList.pubkeys.length}{" "}
                {muteList.pubkeys.length === 1 ? "profile" : "profiles"}
                {muteList.words.length > 0 &&
                  `, ${muteList.words.length} ${muteList.words.length === 1 ? "word" : "words"}`}
                {muteList.tags.length > 0 &&
                  `, ${muteList.tags.length} ${muteList.tags.length === 1 ? "tag" : "tags"}`}
                {muteList.threads.length > 0 &&
                  `, ${muteList.threads.length} ${muteList.threads.length === 1 ? "thread" : "threads"}`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onDiscard}
              className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <Trash2 size={16} />
              <span className="hidden sm:inline">Discard</span>
            </button>
            <button
              onClick={onClean}
              className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-1.5"
              title="Clean up inactive profiles before publishing"
            >
              <Sparkles size={16} />
              <span className="hidden sm:inline">Clean</span>
            </button>
            <button
              onClick={onPublish}
              className="px-4 py-2 text-sm font-bold bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 rounded-lg transition-colors flex items-center gap-1.5 animate-pulse"
            >
              <Save size={16} />
              <span>Save</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
