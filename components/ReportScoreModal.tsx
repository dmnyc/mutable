'use client';

import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ReportScoreModalProps {
  onClose: () => void;
}

export default function ReportScoreModal({ onClose }: ReportScoreModalProps) {
  const reportScoreLevels = [
    { emoji: '⬜', label: 'Clean', range: '0' },
    { emoji: '🟦', label: 'Flagged', range: '1-2' },
    { emoji: '🟩', label: 'Noted', range: '3-5' },
    { emoji: '🟨', label: 'Concerning', range: '6-10' },
    { emoji: '🟧', label: 'Risky', range: '11-20' },
    { emoji: '🟥', label: 'Dangerous', range: '21-40' },
    { emoji: '🟪', label: 'Severe', range: '41-75' },
    { emoji: '⬛', label: 'Critical', range: '76+' },
  ];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-gray-200 dark:border-gray-700 p-6 flex items-start justify-between">
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
              Report Score Levels
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Based on the number of unique users who have publicly reported this pubkey (NIP-56)
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
            {reportScoreLevels.map((level) => (
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
                      {level.range} unique reporter{level.range === '0' ? 's' : 's'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
            <p className="text-xs text-yellow-800 dark:text-yellow-200">
              <strong>Caution:</strong> Anyone can file a NIP-56 report against anyone else for
              any reason, including harassment or coordinated brigading. Treat this score as an
              unverified public signal, not proof of wrongdoing.
            </p>
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
    </div>,
    document.body,
  );
}
