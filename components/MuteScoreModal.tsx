'use client';

import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { getMuteScore, getMuteRatioSignal } from '@/lib/utils/muteScore';

interface MuteScoreModalProps {
  onClose: () => void;
}

export default function MuteScoreModal({ onClose }: MuteScoreModalProps) {
  // Ranges are labelled here, but emoji/label come from the shared scoring
  // helpers so this explainer can't drift from what the app actually shows.
  const muteScoreLevels = [
    { range: '0', at: 0 },
    { range: '1-25', at: 25 },
    { range: '26-50', at: 50 },
    { range: '51-75', at: 75 },
    { range: '76-100', at: 100 },
    { range: '101-200', at: 200 },
    { range: '201-300', at: 300 },
    { range: '301-400', at: 400 },
    { range: '401+', at: 401 }
  ].map((l) => ({ ...l, ...getMuteScore(l.at) }));

  // Sample each band by asking for a representative mutes-per-1k value.
  const muteRatioLevels = [
    { range: '0', mutes: 0 },
    { range: '<1', mutes: 0.5 },
    { range: '1-5', mutes: 3 },
    { range: '5-20', mutes: 10 },
    { range: '20-50', mutes: 30 },
    { range: '50-150', mutes: 100 },
    { range: '150+', mutes: 200 }
  ].map((l) => ({ ...l, ...getMuteRatioSignal(l.mutes, 1000) }));

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-gray-200 dark:border-gray-700 p-6 flex items-start justify-between flex-shrink-0">
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
              Mute Score &amp; Ratio
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              How muted a user is, in raw count and relative to how much they post
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
            Mute Score
          </h3>
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
            How many public mute lists include this user.
          </p>
          <div className="space-y-2">
            {muteScoreLevels.map((level) => (
              <div
                key={level.label}
                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{level.emoji}</span>
                  <div>
                    <div className="font-semibold text-gray-900 dark:text-white">
                      {level.label}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      {level.range} mute list{level.range === '0' ? '' : 's'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mt-6 mb-1">
            Mute Ratio
          </h3>
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
            Mutes per 1,000 notes posted. Normalizes the score against activity,
            so someone who posts constantly isn&apos;t penalized for volume alone
            — and someone muted heavily despite posting little stands out.
          </p>
          <div className="space-y-2">
            {muteRatioLevels.map((level) => (
              <div
                key={level.label}
                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{level.emoji}</span>
                  <div>
                    <div className="font-semibold text-gray-900 dark:text-white">
                      {level.label}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      {level.range} per 1k notes
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 mt-4">
            Note counts come from relays that support NIP-45, falling back to a
            capped scan. A &ldquo;+&rdquo; means the true count is higher, so the
            real ratio is lower than shown.
          </p>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 p-6 flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
