'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { MuteItem, MuteList } from '@/types';
import { Plus, Trash2, Edit2, X, Check } from 'lucide-react';
import { npubToHex, hexToNpub } from '@/lib/nostr';

interface MuteListCategoryProps {
  category: keyof MuteList;
  title: string;
  items: MuteItem[];
  placeholder: string;
}

export default function MuteListCategory({
  category,
  title,
  items,
  placeholder
}: MuteListCategoryProps) {
  const { addMutedItem, removeMutedItem, updateMutedItem } = useStore();
  const [isAdding, setIsAdding] = useState(false);
  const [newValue, setNewValue] = useState('');
  const [newReason, setNewReason] = useState('');
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editReason, setEditReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleAdd = () => {
    if (!newValue.trim()) {
      setError('Value cannot be empty');
      return;
    }

    try {
      let finalValue = newValue.trim();

      // Convert npub to hex for pubkeys
      if (category === 'pubkeys' && finalValue.startsWith('npub')) {
        finalValue = npubToHex(finalValue);
      }

      const newItem: MuteItem = {
        type: category === 'pubkeys' ? 'pubkey' :
              category === 'words' ? 'word' :
              category === 'tags' ? 'tag' : 'thread',
        value: finalValue,
        reason: newReason.trim() || undefined
      } as MuteItem;

      addMutedItem(newItem, category);
      setNewValue('');
      setNewReason('');
      setIsAdding(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid format');
    }
  };

  const handleEdit = (item: MuteItem) => {
    setEditingValue(item.value);
    setEditValue(item.value);
    setEditReason(item.reason || '');
    setError(null);
  };

  const handleSaveEdit = () => {
    if (!editValue.trim() || !editingValue) return;

    try {
      let finalValue = editValue.trim();

      // Convert npub to hex for pubkeys
      if (category === 'pubkeys' && finalValue.startsWith('npub')) {
        finalValue = npubToHex(finalValue);
      }

      updateMutedItem(
        editingValue,
        finalValue,
        category,
        editReason.trim() || undefined
      );

      setEditingValue(null);
      setEditValue('');
      setEditReason('');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid format');
    }
  };

  const handleCancelEdit = () => {
    setEditingValue(null);
    setEditValue('');
    setEditReason('');
    setError(null);
  };

  const handleRemove = (value: string) => {
    removeMutedItem(value, category);
  };

  const displayValue = (item: MuteItem) => {
    if (category === 'pubkeys') {
      try {
        const npub = hexToNpub(item.value);
        return `${npub.slice(0, 12)}...${npub.slice(-8)}`;
      } catch {
        return `${item.value.slice(0, 12)}...${item.value.slice(-8)}`;
      }
    }
    return item.value;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {title}
          </h3>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 rounded text-red-700 dark:text-red-200 text-sm">
            {error}
          </div>
        )}

        {/* Items List */}
        <div className="space-y-2 mb-4">
          {items.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-sm italic text-center py-4">
              No items in this category
            </p>
          ) : (
            items.map((item) => (
              <div
                key={item.value}
                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg"
              >
                {editingValue === item.value ? (
                  <div className="flex-1 space-y-2">
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-900 dark:text-white"
                      placeholder={placeholder}
                    />
                    <input
                      type="text"
                      value={editReason}
                      onChange={(e) => setEditReason(e.target.value)}
                      className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-900 dark:text-white"
                      placeholder="Reason (optional)"
                    />
                    <div className="flex space-x-2">
                      <button
                        onClick={handleSaveEdit}
                        className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                      >
                        <Check size={16} />
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex-1">
                      <p className="text-sm font-mono text-gray-900 dark:text-white">
                        {displayValue(item)}
                      </p>
                      {item.reason && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {item.reason}
                        </p>
                      )}
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleEdit(item)}
                        className="p-2 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => handleRemove(item.value)}
                        className="p-2 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        {/* Add New Item */}
        {isAdding ? (
          <div className="space-y-2">
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-900 dark:text-white"
              placeholder={placeholder}
              autoFocus
            />
            <input
              type="text"
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-900 dark:text-white"
              placeholder="Reason (optional)"
            />
            <div className="flex space-x-2">
              <button
                onClick={handleAdd}
                className="px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700 font-medium"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setIsAdding(false);
                  setNewValue('');
                  setNewReason('');
                  setError(null);
                }}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            <Plus size={16} />
            <span>Add Item</span>
          </button>
        )}
      </div>
    </div>
  );
}
