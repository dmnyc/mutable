'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { MuteItem, MuteList, Profile } from '@/types';
import { Plus, Trash2, Edit2, X, Check, User, Copy, Lock, Unlock } from 'lucide-react';
import { npubToHex, hexToNpub, fetchProfile } from '@/lib/nostr';
import { useAuth } from '@/hooks/useAuth';
import UserSearchInput from './UserSearchInput';
import UserProfileModal from './UserProfileModal';

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
  const { session } = useAuth();
  const { addMutedItem, removeMutedItem, updateMutedItem, toggleItemPrivacy } = useStore();
  const [isAdding, setIsAdding] = useState(false);
  const [useSearchInput, setUseSearchInput] = useState(false);
  const [newValue, setNewValue] = useState('');
  const [newReason, setNewReason] = useState('');
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editReason, setEditReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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
      setUseSearchInput(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid format');
    }
  };

  const handleProfileSelect = (profile: Profile) => {
    const newItem: MuteItem = {
      type: 'pubkey',
      value: profile.pubkey,
      reason: newReason.trim() || undefined
    } as MuteItem;

    addMutedItem(newItem, category);
    setNewValue('');
    setNewReason('');
    setIsAdding(false);
    setUseSearchInput(false);
    setError(null);
  };

  const handleEdit = (item: MuteItem) => {
    setEditingValue(item.value);
    setEditReason(item.reason || '');
    setError(null);
  };

  const handleSaveEdit = () => {
    if (!editingValue) return;

    try {
      // For pubkeys, we only update the reason, not the value
      if (category === 'pubkeys') {
        updateMutedItem(
          editingValue,
          editingValue, // Keep the same pubkey
          category,
          editReason.trim() || undefined
        );
      } else {
        // For other categories, allow value editing
        if (!editValue.trim()) {
          setError('Value cannot be empty');
          return;
        }
        updateMutedItem(
          editingValue,
          editValue.trim(),
          category,
          editReason.trim() || undefined
        );
      }

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

  // Load profiles for pubkeys (only for current page)
  useEffect(() => {
    const loadProfiles = async () => {
      if (category !== 'pubkeys' || !session) return;

      setLoadingProfiles(true);
      const profilesMap = new Map<string, Profile>(profiles);

      // Calculate current page items
      const startIndex = (currentPage - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const currentPageItems = items.slice(startIndex, endIndex);

      const fetchPromises = currentPageItems.map(async (item) => {
        // Skip if already loaded
        if (profilesMap.has(item.value)) return;

        try {
          const profile = await fetchProfile(item.value, session.relays);
          if (profile) {
            profilesMap.set(item.value, profile);
          }
        } catch (error) {
          console.error(`Failed to fetch profile for ${item.value}:`, error);
        }
      });

      await Promise.allSettled(fetchPromises);
      setProfiles(profilesMap);
      setLoadingProfiles(false);
    };

    loadProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, items, session, currentPage, pageSize]);

  const displayValue = (item: MuteItem) => {
    if (category === 'pubkeys') {
      try {
        const npub = hexToNpub(item.value);
        return `${npub.slice(0, 16)}...${npub.slice(-8)}`;
      } catch {
        return `${item.value.slice(0, 16)}...${item.value.slice(-8)}`;
      }
    }
    return item.value;
  };

  const handleCopyNpub = async (pubkey: string) => {
    try {
      const npub = hexToNpub(pubkey);
      await navigator.clipboard.writeText(npub);
      setCopySuccess(pubkey);
      setTimeout(() => setCopySuccess(null), 2000);
    } catch (error) {
      console.error('Failed to copy npub:', error);
    }
  };

  const handleViewProfile = (pubkey: string) => {
    const profile = profiles.get(pubkey);
    if (profile) {
      setSelectedProfile(profile);
    } else {
      // Create a minimal profile if we don't have full data
      setSelectedProfile({
        pubkey,
        name: undefined,
        display_name: undefined,
        about: undefined,
        picture: undefined,
        nip05: undefined
      });
    }
  };

  // Pagination calculations
  const totalPages = Math.ceil(items.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const currentItems = items.slice(startIndex, endIndex);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1); // Reset to first page
  };

  // Skeleton loader component
  const SkeletonLoader = () => (
    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg animate-pulse">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex-shrink-0"></div>
        <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-32 max-w-full"></div>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <div className="w-8 h-8 bg-gray-300 dark:bg-gray-600 rounded"></div>
        <div className="w-8 h-8 bg-gray-300 dark:bg-gray-600 rounded"></div>
        <div className="w-8 h-8 bg-gray-300 dark:bg-gray-600 rounded"></div>
        <div className="w-8 h-8 bg-gray-300 dark:bg-gray-600 rounded"></div>
      </div>
    </div>
  );

  return (
    <>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 w-full max-w-full">
        <div className="p-4 sm:p-6 w-full max-w-full">
        <div className="flex items-center justify-between mb-4 gap-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex-shrink">
            {title}
          </h3>
          <div className="flex items-center gap-3 flex-shrink-0">
            {items.length > 0 && (
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600 dark:text-gray-400">Show:</label>
                <select
                  value={pageSize}
                  onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                  className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value={10}>10</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            )}
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {items.length} {items.length === 1 ? 'item' : 'items'}
            </span>
          </div>
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
          ) : loadingProfiles && category === 'pubkeys' ? (
            // Show skeletons while loading profiles
            currentItems.map((item, idx) => <SkeletonLoader key={idx} />)
          ) : (
            currentItems.map((item) => {
              const profile = category === 'pubkeys' ? profiles.get(item.value) : null;
              const displayName = profile?.display_name || profile?.name;

              return (
                <div
                  key={item.value}
                  className="flex flex-col p-2 sm:p-3 bg-gray-50 dark:bg-gray-700 rounded-lg w-full max-w-full gap-2"
                >
                  {/* User Info Row - Always Displayed */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between w-full gap-2">
                    <div
                      className={`flex items-center space-x-2 sm:space-x-3 flex-1 min-w-0 w-full ${category === 'pubkeys' ? 'cursor-pointer hover:opacity-80' : ''}`}
                      onClick={() => category === 'pubkeys' && handleViewProfile(item.value)}
                    >
                      {category === 'pubkeys' && (
                        <>
                          {profile?.picture ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={profile.picture}
                              alt={displayName || 'User'}
                              className="w-8 h-8 sm:w-10 sm:h-10 rounded-full object-cover flex-shrink-0"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/%3E%3Cpath d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/%3E%3C/svg%3E';
                              }}
                            />
                          ) : (
                            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
                              <User size={14} className="text-gray-600 dark:text-gray-300 sm:w-4 sm:h-4" />
                            </div>
                          )}
                        </>
                      )}
                      <div className="flex-1 min-w-0 w-full">
                        {category === 'pubkeys' && displayName ? (
                          <>
                            <p className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white truncate">
                              {displayName}
                            </p>
                            {profile?.nip05 && (
                              <p className="text-[10px] sm:text-xs text-green-600 dark:text-green-400 break-all leading-tight">
                                ✓ {profile.nip05}
                              </p>
                            )}
                            <p className="text-[10px] sm:text-xs text-gray-400 dark:text-gray-500 font-mono break-all leading-tight">
                              {displayValue(item)}
                            </p>
                          </>
                        ) : category === 'pubkeys' ? (
                          <p className="text-xs sm:text-sm font-mono text-gray-900 dark:text-white break-all">
                            {displayValue(item)}
                          </p>
                        ) : (
                          <p className="text-xs sm:text-sm text-gray-900 dark:text-white break-all">
                            {displayValue(item)}
                          </p>
                        )}
                        {item.reason && (
                          <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 mt-1 italic break-words leading-tight">
                            {item.reason}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex space-x-1 sm:space-x-2 flex-shrink-0 justify-end w-full sm:w-auto">
                      {/* Privacy Toggle */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleItemPrivacy(item.value, category);
                        }}
                        className={`p-1.5 sm:p-2 transition-colors ${
                          item.private
                            ? 'text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300'
                            : 'text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300'
                        }`}
                        title={item.private ? 'Private (encrypted) - Click to make public' : 'Public (visible to all) - Click to make private'}
                      >
                        {item.private ? <Lock size={16} /> : <Unlock size={16} />}
                      </button>
                      {category === 'pubkeys' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyNpub(item.value);
                          }}
                          className="p-1.5 sm:p-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                          title="Copy npub"
                        >
                          {copySuccess === item.value ? <Check size={16} /> : <Copy size={16} />}
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(item);
                        }}
                        className="p-1.5 sm:p-2 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                        title={category === 'pubkeys' ? 'Edit reason' : 'Edit'}
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemove(item.value);
                        }}
                        className="p-1.5 sm:p-2 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Edit Form - Stacked Below User Info */}
                  {editingValue === item.value && (
                    <div className="flex-1 space-y-2 w-full border-t border-gray-300 dark:border-gray-600 pt-2">
                      {category !== 'pubkeys' && (
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-900 dark:text-white"
                          placeholder={placeholder}
                        />
                      )}
                      <input
                        type="text"
                        value={editReason}
                        onChange={(e) => setEditReason(e.target.value)}
                        className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-900 dark:text-white"
                        placeholder="Reason (optional)"
                        autoFocus
                      />
                      <div className="flex space-x-2">
                        <button
                          onClick={handleSaveEdit}
                          className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 flex items-center gap-1"
                        >
                          <Check size={16} />
                          <span>Save</span>
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700 flex items-center gap-1"
                        >
                          <X size={16} />
                          <span>Cancel</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Pagination */}
        {items.length > 0 && totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-4 pt-2 border-t border-gray-200 dark:border-gray-600 overflow-hidden">
            <div className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
              Showing {startIndex + 1}-{Math.min(endIndex, items.length)} of {items.length}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-600"
              >
                Previous
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                  // Show first page, last page, current page, and adjacent pages
                  if (
                    page === 1 ||
                    page === totalPages ||
                    (page >= currentPage - 1 && page <= currentPage + 1)
                  ) {
                    return (
                      <button
                        key={page}
                        onClick={() => handlePageChange(page)}
                        className={`px-3 py-1 text-sm rounded ${
                          currentPage === page
                            ? 'bg-red-600 text-white'
                            : 'border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
                        }`}
                      >
                        {page}
                      </button>
                    );
                  } else if (page === currentPage - 2 || page === currentPage + 2) {
                    return <span key={page} className="px-1">...</span>;
                  }
                  return null;
                })}
              </div>
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-600"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Add New Item */}
        {isAdding ? (
          <div className="space-y-2">
            {/* Show user search for pubkeys category */}
            {category === 'pubkeys' && useSearchInput ? (
              <>
                <UserSearchInput
                  onSelect={handleProfileSelect}
                  onCancel={() => {
                    setIsAdding(false);
                    setUseSearchInput(false);
                    setNewValue('');
                    setNewReason('');
                    setError(null);
                  }}
                />
                <input
                  type="text"
                  value={newReason}
                  onChange={(e) => setNewReason(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-900 dark:text-white"
                  placeholder="Reason (optional)"
                />
                <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2">
                  <button
                    onClick={() => setUseSearchInput(false)}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline text-center sm:text-left"
                  >
                    Enter pubkey manually
                  </button>
                  <button
                    onClick={() => {
                      setIsAdding(false);
                      setUseSearchInput(false);
                      setNewValue('');
                      setNewReason('');
                      setError(null);
                    }}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 whitespace-nowrap"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
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
                <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2">
                  {category === 'pubkeys' && (
                    <button
                      onClick={() => setUseSearchInput(true)}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline text-center sm:text-left"
                    >
                      Search for user by name
                    </button>
                  )}
                  <div className="flex space-x-2 ml-auto">
                    <button
                      onClick={handleAdd}
                      className="px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700 font-medium whitespace-nowrap"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => {
                        setIsAdding(false);
                        setUseSearchInput(false);
                        setNewValue('');
                        setNewReason('');
                        setError(null);
                      }}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 whitespace-nowrap"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <button
            onClick={() => {
              setIsAdding(true);
              // Default to search input for pubkeys
              setUseSearchInput(category === 'pubkeys');
            }}
            className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            <Plus size={16} />
            <span>Add Item</span>
          </button>
        )}
        </div>
      </div>

      {/* User Profile Modal */}
      {selectedProfile && category === 'pubkeys' && (
        <UserProfileModal
          profile={selectedProfile}
          onClose={() => setSelectedProfile(null)}
        />
      )}
    </>
  );
}
