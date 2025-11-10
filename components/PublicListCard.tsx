'use client';

import { useState, useEffect } from 'react';
import { PublicMuteList, Profile } from '@/types';
import { useStore } from '@/lib/store';
import { hexToNpub, fetchProfile, deletePublicList } from '@/lib/nostr';
import { Copy, ChevronDown, ChevronUp, User, Calendar, Shield, Check, Tag, Eye, ChevronLeft, ChevronRight, Edit, Trash2, Share2 } from 'lucide-react';
import ImportConfirmationDialog from './ImportConfirmationDialog';
import UserProfileModal from './UserProfileModal';
import { useAuth } from '@/hooks/useAuth';

interface PublicListCardProps {
  list: PublicMuteList;
  isOwner?: boolean;
  onEdit?: (pack: PublicMuteList) => void;
  onDelete?: () => void;
  hideImportFeatures?: boolean;
}

export default function PublicListCard({ list, isOwner = false, onEdit, onDelete, hideImportFeatures = false }: PublicListCardProps) {
  const { session } = useAuth();
  const { muteList, setMuteList, setHasUnsavedChanges, getNewItemsCount, markPackItemsAsImported, isBlacklisted } = useStore();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteSuccess, setDeleteSuccess] = useState(false);
  const [skippedBlacklisted, setSkippedBlacklisted] = useState(0);
  const [creatorProfile, setCreatorProfile] = useState<Profile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [pubkeyProfiles, setPubkeyProfiles] = useState<Map<string, Profile>>(new Map());
  const [loadingPubkeyProfiles, setLoadingPubkeyProfiles] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [pubkeyPage, setPubkeyPage] = useState(1);
  const [wordPage, setWordPage] = useState(1);
  const [tagPage, setTagPage] = useState(1);
  const [linkCopied, setLinkCopied] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  const ITEMS_PER_PAGE = 10;

  // Fetch creator profile
  useEffect(() => {
    const loadCreatorProfile = async () => {
      if (!list.author) return;

      setLoadingProfile(true);
      try {
        // Use session relays if available, otherwise use default relays
        const relays = session?.relays || [
          'wss://relay.damus.io',
          'wss://relay.primal.net',
          'wss://nos.lol',
          'wss://relay.nostr.band',
          'wss://nostr.wine',
          'wss://relay.snort.social'
        ];
        const profile = await fetchProfile(list.author, relays);
        setCreatorProfile(profile);
      } catch (error) {
        console.error('Failed to fetch creator profile:', error);
      } finally {
        setLoadingProfile(false);
      }
    };

    loadCreatorProfile();
  }, [list.author, session]);

  // Fetch pubkey profiles when expanded or page changes
  useEffect(() => {
    const loadPubkeyProfiles = async () => {
      if (!isExpanded || !list.list.pubkeys || list.list.pubkeys.length === 0) return;

      setLoadingPubkeyProfiles(true);
      const profilesMap = new Map<string, Profile>(pubkeyProfiles);

      // Use session relays if available, otherwise use default relays
      const relays = session?.relays || [
        'wss://relay.damus.io',
        'wss://relay.primal.net',
        'wss://nos.lol',
        'wss://relay.nostr.band',
        'wss://nostr.wine',
        'wss://relay.snort.social'
      ];

      // Calculate current page items
      const startIndex = (pubkeyPage - 1) * ITEMS_PER_PAGE;
      const endIndex = startIndex + ITEMS_PER_PAGE;
      const pubkeysToLoad = list.list.pubkeys.slice(startIndex, endIndex);

      const fetchPromises = pubkeysToLoad.map(async (item) => {
        // Always try to fetch even if we have a cached profile, in case it was a failed fetch before
        // Only skip if we successfully loaded it (has name or display_name)
        const existingProfile = profilesMap.get(item.value);
        if (existingProfile && (existingProfile.name || existingProfile.display_name)) {
          return; // Skip if we have a valid profile
        }

        try {
          const profile = await fetchProfile(item.value, relays);
          if (profile) {
            profilesMap.set(item.value, profile);
          }
        } catch (error) {
          console.error(`Failed to fetch profile for ${item.value}:`, error);
        }
      });

      await Promise.allSettled(fetchPromises);
      setPubkeyProfiles(profilesMap);
      setLoadingPubkeyProfiles(false);
    };

    loadPubkeyProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded, list.list.pubkeys, session, pubkeyPage]);

  const totalItems =
    (list.list.pubkeys?.length || 0) +
    (list.list.words?.length || 0) +
    (list.list.tags?.length || 0) +
    (list.list.threads?.length || 0);

  const newItemsCount = getNewItemsCount(list);
  const allImported = newItemsCount === 0;

  const handleImportClick = () => {
    if (allImported) return;
    setShowConfirmDialog(true);
  };

  const handleConfirmImport = async () => {
    // Merge the public list with the user's current mute list
    const itemsToImport: string[] = [];
    const skippedItems: string[] = []; // Track blacklisted items to mark as "imported" so they don't show in count
    let skippedBlacklistedCount = 0;

    const newMuteList = {
      pubkeys: [
        ...muteList.pubkeys,
        ...(list.list.pubkeys || []).filter((item) => {
          // Skip blacklisted pubkeys
          if (isBlacklisted(item.value)) {
            skippedBlacklistedCount++;
            skippedItems.push(item.value); // Track skipped items
            console.log(`Skipping blacklisted pubkey during pack import: ${item.value.substring(0, 8)}...`);
            return false;
          }

          const exists = muteList.pubkeys.some((existing) => existing.value === item.value);
          if (!exists) itemsToImport.push(item.value);
          return !exists;
        })
      ],
      words: [
        ...muteList.words,
        ...(list.list.words || []).filter((item) => {
          const exists = muteList.words.some((existing) => existing.value === item.value);
          if (!exists) itemsToImport.push(item.value);
          return !exists;
        })
      ],
      tags: [
        ...muteList.tags,
        ...(list.list.tags || []).filter((item) => {
          const exists = muteList.tags.some((existing) => existing.value === item.value);
          if (!exists) itemsToImport.push(item.value);
          return !exists;
        })
      ],
      threads: [
        ...muteList.threads,
        ...(list.list.threads || []).filter((item) => {
          const exists = muteList.threads.some((existing) => existing.value === item.value);
          if (!exists) itemsToImport.push(item.value);
          return !exists;
        })
      ]
    };

    setMuteList(newMuteList);
    setHasUnsavedChanges(true);
    // Mark both imported AND skipped items so they don't appear in "new items" count
    markPackItemsAsImported(list.id, [...itemsToImport, ...skippedItems]);
    setSkippedBlacklisted(skippedBlacklistedCount);
    setImportSuccess(true);

    // Clear success message and reset skipped count after 5 seconds
    setTimeout(() => {
      setImportSuccess(false);
      setSkippedBlacklisted(0);
    }, 5000);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString();
  };

  const displayAuthor = () => {
    try {
      const npub = hexToNpub(list.author);
      return `${npub.slice(0, 12)}...${npub.slice(-8)}`;
    } catch {
      return `${list.author.slice(0, 12)}...${list.author.slice(-8)}`;
    }
  };

  const handleDelete = async () => {
    if (!session) return;

    try {
      setDeleting(true);
      await deletePublicList(list.id, session.relays);
      setDeleteSuccess(true);
      setShowDeleteConfirm(false);

      // Show success message briefly, then trigger parent reload
      setTimeout(() => {
        if (onDelete) {
          onDelete();
        }
      }, 1500);
    } catch (error) {
      console.error('Failed to delete pack:', error);
      alert(error instanceof Error ? error.message : 'Failed to delete pack');
      setDeleting(false);
    }
  };

  const handleCopyLink = async () => {
    // Use author+dTag format for stable links that always point to the latest version
    const url = `${window.location.origin}/pack/${list.author}/${list.dTag}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy link:', error);
    }
  };

  return (
    <>
      <div className="bg-gradient-to-br from-white to-gray-50 dark:from-gray-800 dark:to-gray-850 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow">
        <div className="p-6">
          {/* Header */}
          <div className="mb-4">
            {/* Title and Buttons Row */}
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex items-center gap-2 min-w-0 flex-shrink">
                <Shield className="text-red-600 dark:text-red-500 flex-shrink-0" size={20} />
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  {list.name}
                </h3>
                {list.isNostrguardPack && (
                  <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs font-medium border border-blue-200 dark:border-blue-700 whitespace-nowrap flex-shrink-0">
                    nostrguard
                  </span>
                )}
              </div>

              {/* Action Buttons */}
              {isOwner ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleCopyLink}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                    linkCopied
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                  title="Copy link to share"
                >
                  {linkCopied ? (
                    <>
                      <Check size={16} />
                      <span className="hidden sm:inline">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Share2 size={16} />
                      <span className="hidden sm:inline">Share</span>
                    </>
                  )}
                </button>
                <button
                  onClick={handleImportClick}
                  disabled={allImported}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                    importSuccess
                      ? 'bg-green-600 text-white'
                      : allImported
                      ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                      : 'bg-red-600 text-white hover:bg-red-700'
                  }`}
                >
                {importSuccess ? (
                  <>
                    <Check size={16} />
                    <span>Added!</span>
                  </>
                ) : allImported ? (
                  <>
                    <Check size={16} />
                    <span className="hidden sm:inline">All in Your List</span>
                    <span className="sm:hidden">✓</span>
                  </>
                ) : (
                  <>
                    <Copy size={16} />
                    <span className="hidden sm:inline">
                      Add {newItemsCount > 0 && newItemsCount} to My Mute List
                    </span>
                    <span className="sm:hidden">+{newItemsCount}</span>
                  </>
                )}
                </button>
                <button
                  onClick={() => onEdit?.(list)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  title="Edit pack"
                >
                  <Edit size={16} />
                  <span className="hidden sm:inline">Edit</span>
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={deleting || deleteSuccess}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                    deleteSuccess
                      ? 'bg-green-600 text-white'
                      : 'bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed'
                  }`}
                  title="Delete pack"
                >
                  {deleteSuccess ? (
                    <>
                      <Check size={16} />
                      <span className="hidden sm:inline">Deleted!</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={16} />
                      <span className="hidden sm:inline">Delete</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleCopyLink}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                    linkCopied
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                  title="Copy link to share"
                >
                  {linkCopied ? (
                    <>
                      <Check size={16} />
                      <span className="hidden sm:inline">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Share2 size={16} />
                      <span className="hidden sm:inline">Share</span>
                    </>
                  )}
                </button>
                {session && (
                  <button
                    onClick={handleImportClick}
                    disabled={allImported}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                      importSuccess
                        ? 'bg-green-600 text-white'
                        : allImported
                        ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                        : 'bg-red-600 text-white hover:bg-red-700'
                    }`}
                  >
                  {importSuccess ? (
                    <>
                      <Check size={16} />
                      <span>Added!</span>
                    </>
                  ) : allImported ? (
                    <>
                      <Check size={16} />
                      <span className="hidden sm:inline">All in Your List</span>
                      <span className="sm:hidden">✓</span>
                    </>
                  ) : (
                    <>
                      <Copy size={16} />
                      <span className="hidden sm:inline">
                        Add {newItemsCount > 0 && newItemsCount} to My Mute List
                      </span>
                      <span className="sm:hidden">+{newItemsCount}</span>
                    </>
                  )}
                  </button>
                )}
              </div>
            )}
            </div>

            {/* Description Row */}
            {list.description && (
              <div className="mb-3">
                <p className={`text-sm text-gray-600 dark:text-gray-400 ${!descriptionExpanded ? 'line-clamp-4' : ''}`}>
                  {list.description}
                </p>
                {list.description.length > 300 && (
                  <button
                    onClick={() => setDescriptionExpanded(!descriptionExpanded)}
                    className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 mt-1 font-medium"
                  >
                    {descriptionExpanded ? 'Show less' : 'Read more'}
                  </button>
                )}
              </div>
            )}

            {/* Category badges */}
            {list.categories && list.categories.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {list.categories.map((category) => (
                  <span
                    key={category}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-xs font-medium border border-purple-200 dark:border-purple-700"
                  >
                    <Tag size={12} />
                    {category}
                  </span>
                ))}
              </div>
            )}

            {/* Creator info with profile */}
            <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
              <div className="flex items-center gap-2">
                {creatorProfile?.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={creatorProfile.picture}
                    alt={creatorProfile.display_name || creatorProfile.name || 'Creator'}
                    className="w-5 h-5 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <User size={14} />
                )}
                <span className="font-medium">
                  {creatorProfile?.display_name || creatorProfile?.name || displayAuthor()}
                </span>
                {creatorProfile?.nip05 && (
                  <span className="text-green-600 dark:text-green-400" title="NIP-05 Verified">✓</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar size={14} />
                <span>{formatDate(list.createdAt)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Shield size={14} />
                <span>{totalItems} total items</span>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center justify-between py-3 border-t border-gray-200 dark:border-gray-700">
            <div className="grid grid-cols-2 sm:flex sm:space-x-6 gap-2 sm:gap-0 text-sm">
              <div className="flex items-center gap-1">
                <span className="text-gray-600 dark:text-gray-400">Pubkeys:</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {list.list.pubkeys?.length || 0}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-600 dark:text-gray-400">Words:</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {list.list.words?.length || 0}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-600 dark:text-gray-400">Tags:</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {list.list.tags?.length || 0}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-600 dark:text-gray-400">Threads:</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {list.list.threads?.length || 0}
                </span>
              </div>
            </div>

            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1 text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
            >
              <span className="hidden sm:inline">{isExpanded ? 'Hide' : 'Show'} Details</span>
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>

          {/* New items badge */}
          {session && newItemsCount > 0 && !allImported && (
            <div className="mt-3 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>{newItemsCount}</strong> new {newItemsCount === 1 ? 'item' : 'items'} available to import
              </p>
            </div>
          )}

          {/* Blacklisted profiles skipped notification */}
          {skippedBlacklisted > 0 && (
            <div className="mt-3 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                <strong>{skippedBlacklisted}</strong> blacklisted {skippedBlacklisted === 1 ? 'profile' : 'profiles'} skipped during import (removed via List Cleaner)
              </p>
            </div>
          )}

          {/* Expanded Details */}
          {isExpanded && (
            <div className="mt-4 space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              {(list.list.pubkeys?.length || 0) > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <span>Muted Profiles</span>
                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                      ({list.list.pubkeys?.length || 0} total)
                    </span>
                  </h4>
                  <div className="space-y-2">
                    {loadingPubkeyProfiles ? (
                      // Skeleton loaders
                      Array.from({ length: Math.min(3, list.list.pubkeys?.length || 0) }).map((_, i) => (
                        <div key={i} className="flex items-center space-x-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                          <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 animate-pulse" />
                          <div className="flex-1 space-y-2">
                            <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-32 animate-pulse" />
                            <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded w-48 animate-pulse" />
                          </div>
                        </div>
                      ))
                    ) : (
                      (() => {
                        const startIndex = (pubkeyPage - 1) * ITEMS_PER_PAGE;
                        const endIndex = startIndex + ITEMS_PER_PAGE;
                        const currentPageItems = (list.list.pubkeys || []).slice(startIndex, endIndex);

                        return currentPageItems.map((item) => {
                          const profile = pubkeyProfiles.get(item.value);
                          const displayName = profile?.display_name || profile?.name || hexToNpub(item.value).slice(0, 12) + '...' + hexToNpub(item.value).slice(-8);
                          const isAlreadyMuted = muteList.pubkeys.some(p => p.value === item.value);

                          return (
                            <div
                              key={item.value}
                              className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                                isAlreadyMuted
                                  ? 'bg-gray-100 dark:bg-gray-700/30 border-gray-300 dark:border-gray-600'
                                  : 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'
                              }`}
                            >
                              <div className="flex items-center space-x-3 flex-1 min-w-0">
                                {profile?.picture ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={profile.picture}
                                    alt={displayName}
                                    className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).style.display = 'none';
                                    }}
                                  />
                                ) : (
                                  <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
                                    <User size={16} className="text-gray-600 dark:text-gray-300" />
                                  </div>
                                )}

                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                      {displayName}
                                    </p>
                                    {isAlreadyMuted && (
                                      <span className="text-xs bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded">
                                        In your list
                                      </span>
                                    )}
                                  </div>
                                  {profile?.nip05 && (
                                    <p className="text-xs text-green-600 dark:text-green-400 truncate">
                                      ✓ {profile.nip05}
                                    </p>
                                  )}
                                  {!profile?.display_name && !profile?.name && (
                                    <p className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate">
                                      {hexToNpub(item.value).slice(0, 16)}...
                                    </p>
                                  )}
                                  {item.reason && (
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 italic">
                                      {item.reason}
                                    </p>
                                  )}
                                </div>
                              </div>

                              <button
                                onClick={() => setSelectedProfile(profile || { pubkey: item.value })}
                                className="ml-2 p-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                                title="View profile"
                              >
                                <Eye size={16} />
                              </button>
                            </div>
                          );
                        });
                      })()
                    )}
                    {(list.list.pubkeys?.length || 0) > ITEMS_PER_PAGE && (
                      <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Showing {((pubkeyPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(pubkeyPage * ITEMS_PER_PAGE, list.list.pubkeys?.length || 0)} of {list.list.pubkeys?.length || 0}
                        </p>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setPubkeyPage(p => Math.max(1, p - 1))}
                            disabled={pubkeyPage === 1}
                            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title="Previous page"
                          >
                            <ChevronLeft size={16} />
                          </button>
                          <span className="text-xs text-gray-600 dark:text-gray-400 px-2">
                            {pubkeyPage} / {Math.ceil((list.list.pubkeys?.length || 0) / ITEMS_PER_PAGE)}
                          </span>
                          <button
                            onClick={() => setPubkeyPage(p => Math.min(Math.ceil((list.list.pubkeys?.length || 0) / ITEMS_PER_PAGE), p + 1))}
                            disabled={pubkeyPage >= Math.ceil((list.list.pubkeys?.length || 0) / ITEMS_PER_PAGE)}
                            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title="Next page"
                          >
                            <ChevronRight size={16} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {(list.list.words?.length || 0) > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                    <span>Muted Words</span>
                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                      ({list.list.words?.length || 0} total)
                    </span>
                  </h4>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {(() => {
                        const startIndex = (wordPage - 1) * ITEMS_PER_PAGE;
                        const endIndex = startIndex + ITEMS_PER_PAGE;
                        return (list.list.words || []).slice(startIndex, endIndex).map((item) => (
                          <span
                            key={item.value}
                            className="text-xs bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded-full text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600"
                          >
                            {item.value}
                          </span>
                        ));
                      })()}
                    </div>
                    {(list.list.words?.length || 0) > ITEMS_PER_PAGE && (
                      <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Showing {((wordPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(wordPage * ITEMS_PER_PAGE, list.list.words?.length || 0)} of {list.list.words?.length || 0}
                        </p>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setWordPage(p => Math.max(1, p - 1))}
                            disabled={wordPage === 1}
                            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title="Previous page"
                          >
                            <ChevronLeft size={16} />
                          </button>
                          <span className="text-xs text-gray-600 dark:text-gray-400 px-2">
                            {wordPage} / {Math.ceil((list.list.words?.length || 0) / ITEMS_PER_PAGE)}
                          </span>
                          <button
                            onClick={() => setWordPage(p => Math.min(Math.ceil((list.list.words?.length || 0) / ITEMS_PER_PAGE), p + 1))}
                            disabled={wordPage >= Math.ceil((list.list.words?.length || 0) / ITEMS_PER_PAGE)}
                            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title="Next page"
                          >
                            <ChevronRight size={16} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {(list.list.tags?.length || 0) > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                    <span>Muted Tags</span>
                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                      ({list.list.tags?.length || 0} total)
                    </span>
                  </h4>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {(() => {
                        const startIndex = (tagPage - 1) * ITEMS_PER_PAGE;
                        const endIndex = startIndex + ITEMS_PER_PAGE;
                        return (list.list.tags || []).slice(startIndex, endIndex).map((item) => (
                          <span
                            key={item.value}
                            className="text-xs bg-purple-100 dark:bg-purple-900/30 px-3 py-1.5 rounded-full text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700"
                          >
                            #{item.value}
                          </span>
                        ));
                      })()}
                    </div>
                    {(list.list.tags?.length || 0) > ITEMS_PER_PAGE && (
                      <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Showing {((tagPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(tagPage * ITEMS_PER_PAGE, list.list.tags?.length || 0)} of {list.list.tags?.length || 0}
                        </p>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setTagPage(p => Math.max(1, p - 1))}
                            disabled={tagPage === 1}
                            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title="Previous page"
                          >
                            <ChevronLeft size={16} />
                          </button>
                          <span className="text-xs text-gray-600 dark:text-gray-400 px-2">
                            {tagPage} / {Math.ceil((list.list.tags?.length || 0) / ITEMS_PER_PAGE)}
                          </span>
                          <button
                            onClick={() => setTagPage(p => Math.min(Math.ceil((list.list.tags?.length || 0) / ITEMS_PER_PAGE), p + 1))}
                            disabled={tagPage >= Math.ceil((list.list.tags?.length || 0) / ITEMS_PER_PAGE)}
                            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title="Next page"
                          >
                            <ChevronRight size={16} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Dialog */}
      <ImportConfirmationDialog
        isOpen={showConfirmDialog}
        onClose={() => setShowConfirmDialog(false)}
        pack={list}
        onConfirm={handleConfirmImport}
        newItemsCount={newItemsCount}
        totalItemsCount={totalItems}
      />

      {/* User Profile Modal */}
      {selectedProfile && (
        <UserProfileModal
          profile={selectedProfile}
          onClose={() => setSelectedProfile(null)}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Delete Pack?
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Are you sure you want to delete &quot;{list.name}&quot;? This action cannot be undone.
              A deletion event will be published to the network.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? 'Deleting...' : 'Delete Pack'}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors font-medium disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
