'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useStore } from '@/lib/store';
import { backupService, Backup } from '@/lib/backupService';
import { getFollowListPubkeys, publishMuteList } from '@/lib/nostr';
import {
  Archive,
  Download,
  Upload,
  Trash2,
  Calendar,
  FileText,
  Shield,
  Users,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  AlertTriangle
} from 'lucide-react';

export default function Backups() {
  const { session } = useAuth();
  const { muteList, setMuteList } = useStore();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [selectedType, setSelectedType] = useState<'all' | 'mute-list' | 'follow-list'>('all');
  const [isCreating, setIsCreating] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load backups
  useEffect(() => {
    loadBackups();
  }, []);

  const loadBackups = () => {
    const allBackups = backupService.getAllBackups();
    setBackups(allBackups);
  };

  const filteredBackups = selectedType === 'all'
    ? backups
    : backups.filter(b => b.type === selectedType);

  const handleCreateMuteListBackup = async () => {
    if (!session) return;

    try {
      setIsCreating(true);
      setErrorMessage(null);

      const backup = backupService.createMuteListBackup(
        session.pubkey,
        muteList,
        'Manual backup created from Backups tab'
      );

      const saved = backupService.saveBackup(backup);

      if (saved) {
        loadBackups();
        setSuccessMessage(`Mute list backup created with ${muteList.pubkeys.length + muteList.words.length + muteList.tags.length + muteList.threads.length} items`);
        setTimeout(() => setSuccessMessage(null), 5000);
      } else {
        setErrorMessage('Failed to save backup to storage');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create backup');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateFollowListBackup = async () => {
    if (!session) return;

    try {
      setIsCreating(true);
      setErrorMessage(null);

      // Use retries for better reliability
      const follows = await getFollowListPubkeys(session.pubkey, session.relays, 3);
      const backup = backupService.createFollowListBackup(
        session.pubkey,
        follows,
        'Manual backup created from Backups tab'
      );

      const saved = backupService.saveBackup(backup);

      if (saved) {
        loadBackups();
        setSuccessMessage(`Follow list backup created with ${follows.length} follows`);
        setTimeout(() => setSuccessMessage(null), 5000);
      } else {
        setErrorMessage('Failed to save backup to storage');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create backup');
    } finally {
      setIsCreating(false);
    }
  };

  const handleExportBackup = (backup: Backup) => {
    try {
      backupService.exportBackupToFile(backup);
      setSuccessMessage('Backup downloaded successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error) {
      setErrorMessage('Failed to export backup');
      setTimeout(() => setErrorMessage(null), 3000);
    }
  };

  const handleImportBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      const result = await backupService.importBackupFromFile(content);

      if (result.success) {
        loadBackups();
        setSuccessMessage('Backup imported successfully');
        setTimeout(() => setSuccessMessage(null), 5000);
      } else {
        setErrorMessage(result.error || 'Failed to import backup');
        setTimeout(() => setErrorMessage(null), 5000);
      }
    } catch (error) {
      setErrorMessage('Failed to read backup file');
      setTimeout(() => setErrorMessage(null), 5000);
    }

    // Reset file input
    event.target.value = '';
  };

  const handleDeleteBackup = (backupId: string) => {
    if (!confirm('Are you sure you want to delete this backup? This action cannot be undone.')) {
      return;
    }

    const success = backupService.deleteBackup(backupId);
    if (success) {
      loadBackups();
      setSuccessMessage('Backup deleted successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } else {
      setErrorMessage('Failed to delete backup');
      setTimeout(() => setErrorMessage(null), 3000);
    }
  };

  const handleDeleteAllBackups = () => {
    if (!confirm('Are you sure you want to delete ALL backups? This action cannot be undone and you will lose all backup history.')) {
      return;
    }

    const success = backupService.deleteAllBackups();
    if (success) {
      loadBackups();
      setSuccessMessage('All backups deleted successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } else {
      setErrorMessage('Failed to delete all backups');
      setTimeout(() => setErrorMessage(null), 3000);
    }
  };

  const handleRestoreBackup = async (backup: Backup) => {
    if (!session) {
      setErrorMessage('Please sign in to restore backups');
      setTimeout(() => setErrorMessage(null), 3000);
      return;
    }

    if (backup.type === 'mute-list') {
      if (!confirm('Are you sure you want to restore this mute list backup? This will replace your current mute list and publish it immediately.')) {
        return;
      }

      try {
        const restoredMuteList = backupService.restoreMuteListBackup(backup.id);
        if (!restoredMuteList) {
          setErrorMessage('Failed to restore backup');
          setTimeout(() => setErrorMessage(null), 3000);
          return;
        }

        // Update the mute list in the store
        setMuteList(restoredMuteList);

        // Publish immediately
        try {
          await publishMuteList(restoredMuteList, session.relays);
          setSuccessMessage('Backup restored and published successfully!');
          setTimeout(() => setSuccessMessage(null), 5000);
        } catch (publishError) {
          setErrorMessage('Backup restored but failed to publish. Please try publishing manually.');
          setTimeout(() => setErrorMessage(null), 5000);
        }
      } catch (error) {
        setErrorMessage('Failed to restore and publish backup');
        setTimeout(() => setErrorMessage(null), 3000);
      }
    } else {
      // Follow list backup - not implemented yet
      setErrorMessage('Follow list restore is not yet implemented');
      setTimeout(() => setErrorMessage(null), 3000);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const getBackupItemCount = (backup: Backup): number => {
    if (backup.type === 'mute-list') {
      const data = backup.data as any;
      return data.pubkeys.length + data.words.length + data.tags.length + data.threads.length;
    } else {
      return (backup.data as string[]).length;
    }
  };

  const muteListBackups = backups.filter(b => b.type === 'mute-list');
  const followListBackups = backups.filter(b => b.type === 'follow-list');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Backups</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Manage backups of your mute lists and follow lists
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCreateMuteListBackup}
            disabled={isCreating}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Archive size={18} />
            <span className="hidden sm:inline">Backup Mute List</span>
          </button>
          <button
            onClick={handleCreateFollowListBackup}
            disabled={isCreating}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Users size={18} />
            <span className="hidden sm:inline">Backup Follows</span>
          </button>
        </div>
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
          <AlertCircle size={20} className="text-red-600 dark:text-red-400" />
          <span className="text-red-800 dark:text-red-200">{errorMessage}</span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-lg">
              <Shield className="text-red-600 dark:text-red-400" size={24} />
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Mute List Backups</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{muteListBackups.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <Users className="text-blue-600 dark:text-blue-400" size={24} />
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Follow List Backups</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{followListBackups.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
              <Archive className="text-gray-600 dark:text-gray-400" size={24} />
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Total Backups</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{backups.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Actions Bar */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedType('all')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                selectedType === 'all'
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              All ({backups.length})
            </button>
            <button
              onClick={() => setSelectedType('mute-list')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                selectedType === 'mute-list'
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              Mute Lists ({muteListBackups.length})
            </button>
            <button
              onClick={() => setSelectedType('follow-list')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                selectedType === 'follow-list'
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              Follow Lists ({followListBackups.length})
            </button>
          </div>

          <div className="flex gap-2">
            <label className="flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors cursor-pointer">
              <Upload size={18} />
              <span>Import</span>
              <input
                type="file"
                accept=".json"
                onChange={handleImportBackup}
                className="hidden"
              />
            </label>
            {backups.length > 0 && (
              <button
                onClick={handleDeleteAllBackups}
                className="flex items-center gap-2 px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
              >
                <Trash2 size={18} />
                <span className="hidden sm:inline">Delete All</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" size={20} />
          <div className="text-sm text-blue-900 dark:text-blue-200">
            <p className="font-semibold mb-1">About Backups</p>
            <ul className="space-y-1 ml-4 list-disc">
              <li>Backups are stored in your browser&apos;s local storage</li>
              <li>Up to 50 backups per type are kept automatically</li>
              <li>Export backups to your computer for safekeeping</li>
              <li>Import previously exported backups from JSON files</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Backups List */}
      {filteredBackups.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-12 text-center">
          <Archive className="mx-auto text-gray-400 mb-4" size={48} />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No backups found
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Create your first backup to get started
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredBackups.map((backup) => (
            <div
              key={backup.id}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-3 sm:p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between gap-2 sm:gap-4">
                <div className="flex items-start gap-2 sm:gap-3 flex-1 min-w-0">
                  <div className={`p-2 rounded-lg flex-shrink-0 ${
                    backup.type === 'mute-list'
                      ? 'bg-red-100 dark:bg-red-900/30'
                      : 'bg-blue-100 dark:bg-blue-900/30'
                  }`}>
                    {backup.type === 'mute-list' ? (
                      <Shield className="text-red-600 dark:text-red-400" size={20} />
                    ) : (
                      <Users className="text-blue-600 dark:text-blue-400" size={20} />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-semibold text-gray-900 dark:text-white">
                        {backup.type === 'mute-list' ? 'Mute List Backup' : 'Follow List Backup'}
                      </h3>
                      <span className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        ({getBackupItemCount(backup)} items)
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-sm text-gray-600 dark:text-gray-400">
                      <div className="flex items-center gap-1">
                        <Calendar size={14} />
                        <span className="text-xs sm:text-sm">{formatDate(backup.createdAt)}</span>
                      </div>
                      {backup.notes && (
                        <div className="flex items-center gap-1 min-w-0">
                          <FileText size={14} className="flex-shrink-0" />
                          <span className="truncate text-xs sm:text-sm">{backup.notes}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex gap-1 sm:gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleRestoreBackup(backup)}
                    className="p-2 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                    title="Restore and publish this backup"
                  >
                    <RefreshCw size={18} />
                  </button>
                  <button
                    onClick={() => handleExportBackup(backup)}
                    className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                    title="Download backup"
                  >
                    <Download size={18} />
                  </button>
                  <button
                    onClick={() => handleDeleteBackup(backup.id)}
                    className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                    title="Delete backup"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
