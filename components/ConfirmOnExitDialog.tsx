'use client';

import { Save, Trash2, X } from 'lucide-react';

interface ConfirmOnExitDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export default function ConfirmOnExitDialog({
  isOpen,
  onConfirm,
  onDiscard,
  onCancel,
}: ConfirmOnExitDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
        <div className="p-6">
          <div className="flex justify-between items-start">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Unsaved Changes
            </h2>
            <button
              onClick={onCancel}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X size={24} />
            </button>
          </div>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            You have unsaved changes. Do you want to save them before leaving?
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button
              onClick={onConfirm}
              className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              <Save size={16} />
              <span>Save and Leave</span>
            </button>
            <button
              onClick={onDiscard}
              className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              <Trash2 size={16} />
              <span>Leave without Saving</span>
            </button>
          </div>
          <div className="mt-3 text-center">
            <button
              onClick={onCancel}
              className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}