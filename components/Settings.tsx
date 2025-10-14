'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useStore } from '@/lib/store';
import {
  Settings as SettingsIcon,
  Trash2,
  AlertTriangle,
  Info,
  Moon,
  Sun,
  Bell,
  Shield,
  Eye,
  Database,
  RefreshCw,
  CheckCircle,
  XCircle
} from 'lucide-react';

export default function Settings() {
  const router = useRouter();
  const { disconnect } = useAuth();
  const { setHasCompletedOnboarding } = useStore();

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetStep, setResetStep] = useState(0);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Theme preference (could be expanded with actual theme switching)
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return document.documentElement.classList.contains('dark');
    }
    return false;
  });

  const handleToggleDarkMode = () => {
    if (typeof window !== 'undefined') {
      document.documentElement.classList.toggle('dark');
      setDarkMode(!darkMode);
      localStorage.setItem('theme', !darkMode ? 'dark' : 'light');
    }
  };

  const handleResetOnboarding = () => {
    setHasCompletedOnboarding(false);
    setSuccessMessage('Onboarding reset! Refresh the page to see the onboarding flow again.');
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  const handleResetApp = () => {
    if (resetStep === 0) {
      setResetStep(1);
      return;
    }

    // Disconnect user first
    disconnect();

    // Clear all localStorage
    localStorage.clear();

    setSuccessMessage('App reset complete! Redirecting to home...');
    setTimeout(() => {
      window.location.href = '/';
    }, 2000);
  };

  const getStorageSize = () => {
    try {
      let total = 0;
      for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
          total += localStorage[key].length + key.length;
        }
      }
      return (total / 1024).toFixed(2); // KB
    } catch {
      return '0';
    }
  };

  const getBackupCount = () => {
    try {
      const backups = localStorage.getItem('mutable-backups');
      if (backups) {
        return JSON.parse(backups).length;
      }
    } catch {
      return 0;
    }
    return 0;
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Manage your application preferences and data
        </p>
      </div>

      {/* Success/Error Messages */}
      {successMessage && (
        <div className="p-4 bg-green-100 dark:bg-green-900/30 border border-green-400 dark:border-green-700 rounded-lg flex items-center gap-2">
          <CheckCircle size={20} className="text-green-600 dark:text-green-400" />
          <span className="text-green-800 dark:text-green-200">{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg flex items-center gap-2">
          <XCircle size={20} className="text-red-600 dark:text-red-400" />
          <span className="text-red-800 dark:text-red-200">{errorMessage}</span>
        </div>
      )}

      {/* Appearance Section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center gap-3 mb-4">
          {darkMode ? <Moon size={24} className="text-gray-900 dark:text-white" /> : <Sun size={24} className="text-gray-900 dark:text-white" />}
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Appearance</h2>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 dark:text-white">Dark Mode</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Toggle between light and dark theme
              </p>
            </div>
            <button
              onClick={handleToggleDarkMode}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                darkMode ? 'bg-red-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                  darkMode ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Privacy & Data Section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center gap-3 mb-4">
          <Shield size={24} className="text-gray-900 dark:text-white" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Privacy & Data</h2>
        </div>

        <div className="space-y-4">
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-start gap-3">
              <Info size={20} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-900 dark:text-blue-200">
                <p className="font-semibold mb-1">About Your Data</p>
                <p>Mutable stores data locally in your browser. Your Nostr data on relays remains separate and is not affected by local data operations.</p>
              </div>
            </div>
          </div>

          <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <div className="flex items-center gap-3 mb-3">
              <Database size={20} className="text-gray-600 dark:text-gray-400" />
              <h3 className="font-semibold text-gray-900 dark:text-white">Storage Information</h3>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-600 dark:text-gray-400">Total Storage Used:</span>
                <p className="font-semibold text-gray-900 dark:text-white">{getStorageSize()} KB</p>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">Backups Stored:</span>
                <p className="font-semibold text-gray-900 dark:text-white">{getBackupCount()}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Onboarding Section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center gap-3 mb-4">
          <Eye size={24} className="text-gray-900 dark:text-white" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Onboarding</h2>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 dark:text-white">Reset Onboarding</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                View the welcome tutorial again on next login
              </p>
            </div>
            <button
              onClick={handleResetOnboarding}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors flex items-center gap-2"
            >
              <RefreshCw size={16} />
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border-2 border-red-300 dark:border-red-800 p-6">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle size={24} className="text-red-600 dark:text-red-400" />
          <h2 className="text-xl font-bold text-red-900 dark:text-red-100">Danger Zone</h2>
        </div>

        <div className="space-y-4">
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <h3 className="font-bold text-red-900 dark:text-red-100 mb-2">
              Reset All Application Data
            </h3>
            <p className="text-sm text-red-800 dark:text-red-200 mb-3">
              This will permanently delete all local data and reset the application to its initial state.
            </p>

            <div className="bg-red-100 dark:bg-red-900/40 border border-red-300 dark:border-red-700 rounded p-3 mb-4">
              <p className="text-xs font-semibold text-red-900 dark:text-red-100 mb-2">
                ⚠️ This action will delete:
              </p>
              <ul className="text-xs text-red-900 dark:text-red-100 space-y-1 ml-4 list-disc">
                <li>All backups stored in your browser</li>
                <li>Your session (you&apos;ll be logged out)</li>
                <li>All application settings and preferences</li>
                <li>Cached mute lists and follow lists</li>
                <li>Onboarding completion status</li>
              </ul>
            </div>

            <div className="bg-blue-100 dark:bg-blue-900/40 border border-blue-300 dark:border-blue-700 rounded p-3 mb-4">
              <p className="text-xs font-semibold text-blue-900 dark:text-blue-100">
                ℹ️ Your Nostr data is safe: This only clears local browser data. Your mute lists, follows, and posts on Nostr relays will NOT be affected.
              </p>
            </div>

            {resetStep === 0 ? (
              <button
                onClick={() => setShowResetConfirm(true)}
                className="w-full sm:w-auto px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold flex items-center justify-center gap-2"
              >
                <Trash2 size={18} />
                Reset Application
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-bold text-red-900 dark:text-red-100">
                  ⚠️ Are you absolutely sure? This cannot be undone!
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={handleResetApp}
                    className="flex-1 px-6 py-3 bg-red-700 text-white rounded-lg hover:bg-red-800 transition-colors font-bold flex items-center justify-center gap-2"
                  >
                    <AlertTriangle size={18} />
                    Yes, Delete Everything
                  </button>
                  <button
                    onClick={() => setResetStep(0)}
                    className="flex-1 px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* About Section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center gap-3 mb-4">
          <Info size={24} className="text-gray-900 dark:text-white" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">About Mutable</h2>
        </div>

        <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
          <p>
            <strong className="text-gray-900 dark:text-white">Version:</strong> 1.0.0
          </p>
          <p>
            <strong className="text-gray-900 dark:text-white">Description:</strong> A Nostr mute list management application
          </p>
          <p>
            <strong className="text-gray-900 dark:text-white">Features:</strong> Manage personal mute lists, discover community packs, track muteuals, and create backups
          </p>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="text-red-600 dark:text-red-400" size={32} />
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Confirm Reset</h3>
            </div>

            <p className="text-gray-700 dark:text-gray-300 mb-4">
              Are you sure you want to reset the application? This will delete all local data and log you out.
            </p>

            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 mb-6">
              <p className="text-sm text-red-800 dark:text-red-200">
                <strong>Important:</strong> Make sure you&apos;ve exported any important backups before proceeding. Your Nostr relay data will remain safe.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowResetConfirm(false);
                  setResetStep(1);
                }}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold"
              >
                Yes, Reset
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
