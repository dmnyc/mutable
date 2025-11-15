'use client';

import { X } from 'lucide-react';

interface MuteScoreModalProps {
  onClose: () => void;
}

export default function MuteScoreModal({ onClose }: MuteScoreModalProps) {
  const muteScoreLevels = [
    { emoji: '⬜', label: 'Pristine', range: '0' },
    { emoji: '🟦', label: 'Low', range: '1-25' },
    { emoji: '🟩', label: 'Average', range: '26-50' },
    { emoji: '🟨', label: 'Moderate', range: '51-75' },
    { emoji: '🟧', label: 'High', range: '76-100' },
    { emoji: '🟥', label: 'Severe', range: '101-200' },
    { emoji: '🟪', label: 'Legendary', range: '201-300' },
    { emoji: '🟫', label: 'Shitlisted', range: '301-400' },
    { emoji: '⬛', label: 'Blacklisted', range: '401+' }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-gray-200 dark:border-gray-700 p-6 flex items-start justify-between">
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
              Mute Score Levels
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Scoring system based on public mute list count
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
        <div className="p-6">
          <div className="space-y-3">
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
                      {level.range} mute list{level.range === '0' || level.range === '1-25' ? 's' : 's'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 p-6">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
