'use client';

import { useState, useRef } from 'react';
import { useStore } from '@/lib/store';
import { useAuth } from '@/hooks/useAuth';
import { MuteList } from '@/types';
import { publishMuteList } from '@/lib/nostr';
import { Download, Upload, Archive } from 'lucide-react';

export default function BackupRestore() {
  const { session } = useAuth();
  const { muteList, setMuteList, setHasUnsavedChanges } = useStore();
  const [showMenu, setShowMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Export to JSON
  const handleExportJSON = () => {
    const dataStr = JSON.stringify(muteList, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mutable-backup-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setShowMenu(false);
  };

  // Import from JSON
  const handleImportJSON = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const imported: MuteList = JSON.parse(content);

        // Validate structure
        if (
          !imported.pubkeys ||
          !imported.words ||
          !imported.tags ||
          !imported.threads
        ) {
          throw new Error('Invalid backup file format');
        }

        setMuteList(imported);

        // Auto-publish if user is logged in
        if (session) {
          try {
            await publishMuteList(imported, session.relays);
            setHasUnsavedChanges(false);
            alert('Backup imported and published successfully!');
          } catch (error) {
            setHasUnsavedChanges(true);
            alert('Backup imported but failed to publish. Please try publishing manually.');
          }
        } else {
          setHasUnsavedChanges(true);
          alert('Backup imported successfully! Please sign in to publish your changes.');
        }
      } catch (error) {
        alert('Failed to import backup: ' + (error instanceof Error ? error.message : 'Unknown error'));
      }
    };
    reader.readAsText(file);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setShowMenu(false);
  };

  // Save to localStorage
  const handleSaveToLocalStorage = () => {
    try {
      const backupKey = `mutable-backup-${Date.now()}`;
      localStorage.setItem(backupKey, JSON.stringify(muteList));
      alert('Backup saved to browser storage!');
      setShowMenu(false);
    } catch (error) {
      alert('Failed to save to browser storage');
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors font-medium"
      >
        <Archive size={16} />
        <span>Backup</span>
      </button>

      {showMenu && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowMenu(false)}
          />

          {/* Menu */}
          <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20">
            <div className="py-1">
              <button
                onClick={handleExportJSON}
                className="w-full flex items-center space-x-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <Download size={16} />
                <span>Export to JSON</span>
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center space-x-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <Upload size={16} />
                <span>Import from JSON</span>
              </button>

              <button
                onClick={handleSaveToLocalStorage}
                className="w-full flex items-center space-x-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <Archive size={16} />
                <span>Save to Browser</span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleImportJSON}
        className="hidden"
      />
    </div>
  );
}
