'use client';

import { useState } from 'react';
import { X, Shield, Users, Eye, EyeOff, Archive, Download, FileText } from 'lucide-react';

interface OnboardingModalProps {
  onClose: () => void;
  onCreateBackup: () => void;
  onSkip: () => void;
}

export default function OnboardingModal({ onClose, onCreateBackup, onSkip }: OnboardingModalProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    {
      title: 'Welcome to Mutable',
      icon: <Shield className="text-red-500" size={48} />,
      content: (
        <div className="space-y-4">
          <p className="text-gray-700 dark:text-gray-300">
            Mutable helps you manage your Nostr mute lists with powerful features for organizing and sharing your content filters.
          </p>
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">What you can do:</h4>
            <ul className="space-y-2 text-sm text-blue-800 dark:text-blue-200">
              <li className="flex items-center gap-2">
                <span>•</span>
                <span>Manage your personal mute list (pubkeys, words, tags, threads)</span>
              </li>
              <li className="flex items-center gap-2">
                <span>•</span>
                <span>Discover and import community mute lists shared by others</span>
              </li>
              <li className="flex items-center gap-2">
                <span>•</span>
                <span>Find out who has publicly muted you (Muteuals)</span>
              </li>
              <li className="flex items-center gap-2">
                <span>•</span>
                <span>Clean up inactive or deleted profiles from your mute list</span>
              </li>
            </ul>
          </div>
        </div>
      )
    },
    {
      title: 'Understanding Mute Lists',
      icon: <Eye className="text-purple-500" size={48} />,
      content: (
        <div className="space-y-4">
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Shield className="text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-1" size={20} />
              <div>
                <h4 className="font-semibold text-indigo-900 dark:text-indigo-100 mb-1">Your Personal Mute List (Kind 10000)</h4>
                <p className="text-sm text-indigo-800 dark:text-indigo-200 mb-2">
                  Your personal mute list follows you across all Nostr clients. A single event can contain <strong>both</strong> public and private mutes:
                </p>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Eye className="text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" size={14} />
                    <div className="text-xs text-indigo-800 dark:text-indigo-200">
                      <strong>Public (Recommended):</strong> Stored in event tags, visible to anyone. Works in ALL Nostr clients (Damus, Primal, Amethyst, etc.).
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <EyeOff className="text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" size={14} />
                    <div className="text-xs text-indigo-800 dark:text-indigo-200">
                      <strong>Private (Limited Compatibility):</strong> Encrypted in the content field. Only works in some clients (Primal, Amethyst). Damus and others don&apos;t decrypt them.
                    </div>
                  </div>
                </div>
                <div className="bg-indigo-100 dark:bg-indigo-900/30 rounded p-2 text-xs text-indigo-900 dark:text-indigo-100 mt-2">
                  <strong>Default:</strong> Mutable creates public mutes by default for maximum compatibility. You can change individual items to private using the lock icon (🔓/🔒) if needed.
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Users className="text-purple-600 dark:text-purple-400 flex-shrink-0 mt-1" size={20} />
              <div>
                <h4 className="font-semibold text-purple-900 dark:text-purple-100 mb-1">Community Mute Lists (Kind 30001)</h4>
                <p className="text-sm text-purple-800 dark:text-purple-200 mb-2">
                  Shareable curated lists that anyone can discover and subscribe to. Perfect for:
                </p>
                <ul className="text-xs text-purple-800 dark:text-purple-200 space-y-1 ml-4">
                  <li>• Community-maintained spam/scam blocklists</li>
                  <li>• Topic-specific filters (politics, sports, etc.)</li>
                  <li>• Coordinating moderation across communities</li>
                </ul>
                <div className="bg-purple-100 dark:bg-purple-900/30 rounded p-2 text-xs text-purple-900 dark:text-purple-100 mt-2">
                  <strong>Note:</strong> These lists are always fully public and meant to be shared
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      title: 'Backup Your Data',
      icon: <Archive className="text-blue-500" size={48} />,
      content: (
        <div className="space-y-4">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <h4 className="font-semibold text-red-900 dark:text-red-100 mb-2">Important: Always Backup First!</h4>
                <p className="text-sm text-red-800 dark:text-red-200">
                  Before making any changes to your mute or follow lists, we <strong>strongly recommend</strong> creating a backup.
                  This ensures you can restore your data if something goes wrong.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-3 flex items-center gap-2">
              <Archive size={20} />
              What gets backed up:
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-blue-800 dark:text-blue-200">
                <span>✓</span>
                <span>Your complete mute list</span>
              </div>
              <div className="flex items-center gap-2 text-blue-800 dark:text-blue-200">
                <span>✓</span>
                <span>Your follow list</span>
              </div>
              <div className="flex items-center gap-2 text-blue-800 dark:text-blue-200">
                <span>✓</span>
                <span>Timestamps & metadata</span>
              </div>
              <div className="flex items-center gap-2 text-blue-800 dark:text-blue-200">
                <span>✓</span>
                <span>Easy export to your computer</span>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
            <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
              <FileText size={18} />
              Two storage options:
            </h4>
            <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
              <li className="flex items-start gap-2">
                <span className="font-semibold min-w-[120px]">Browser Storage:</span>
                <span>Automatic backups stored locally in your browser</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-semibold min-w-[120px]">Download JSON:</span>
                <span>Export backups to your computer for safekeeping</span>
              </li>
            </ul>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              onClick={() => {
                onCreateBackup();
                onClose();
              }}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
            >
              <Archive size={18} />
              Create My First Backup
            </button>
            <button
              onClick={() => {
                onSkip();
                onClose();
              }}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 font-medium transition-colors"
            >
              Skip for Now
            </button>
          </div>
        </div>
      )
    }
  ];

  const currentStepData = steps[currentStep];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {currentStepData.icon}
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {currentStepData.title}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Step {currentStep + 1} of {steps.length}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {currentStepData.content}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {steps.map((_, index) => (
                <div
                  key={index}
                  className={`h-2 w-2 rounded-full transition-colors ${
                    index === currentStep
                      ? 'bg-red-600'
                      : index < currentStep
                      ? 'bg-red-400'
                      : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                />
              ))}
            </div>
            <div className="flex gap-3">
              {currentStep > 0 && (
                <button
                  onClick={() => setCurrentStep(currentStep - 1)}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Back
                </button>
              )}
              {currentStep < steps.length - 1 ? (
                <button
                  onClick={() => setCurrentStep(currentStep + 1)}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                >
                  Next
                </button>
              ) : (
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-medium"
                >
                  I&apos;ll Set Up Later
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
