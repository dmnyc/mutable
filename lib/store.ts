import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { MuteList, UserSession, AuthState, PublicMuteList } from '@/types';

interface AppState {
  // Auth state
  authState: AuthState;
  session: UserSession | null;

  // Mute list state
  muteList: MuteList;
  muteListLoading: boolean;
  muteListError: string | null;
  muteListLastFetched: number | null;
  hasUnsavedChanges: boolean;

  // Public lists state
  publicLists: PublicMuteList[];
  publicListsLoading: boolean;
  importedPackItems: Record<string, Set<string>>; // packId -> Set of imported item values

  // UI state
  activeTab: 'myList' | 'publicLists' | 'muteuals' | 'backups' | 'settings' | 'listCleaner' | 'muteOScope' | 'domainPurge';
  showAuthModal: boolean;
  hasCompletedOnboarding: boolean;

  // Blacklist state (for preventing re-import of removed inactive profiles)
  blacklistedPubkeys: Set<string>;

  // Actions
  setAuthState: (state: AuthState) => void;
  setSession: (session: UserSession | null) => void;
  setMuteList: (list: MuteList) => void;
  setMuteListLoading: (loading: boolean) => void;
  setMuteListError: (error: string | null) => void;
  setMuteListLastFetched: (timestamp: number | null) => void;
  setHasUnsavedChanges: (hasChanges: boolean) => void;
  setPublicLists: (lists: PublicMuteList[]) => void;
  setPublicListsLoading: (loading: boolean) => void;
  getImportedCount: (packId: string) => number;
  getNewItemsCount: (pack: PublicMuteList) => number;
  markPackItemsAsImported: (packId: string, items: string[]) => void;
  setActiveTab: (tab: 'myList' | 'publicLists' | 'muteuals' | 'backups' | 'settings' | 'listCleaner' | 'muteOScope' | 'domainPurge') => void;
  setShowAuthModal: (show: boolean) => void;
  setHasCompletedOnboarding: (completed: boolean) => void;

  // Blacklist operations
  addToBlacklist: (pubkey: string) => void;
  removeFromBlacklist: (pubkey: string) => void;
  clearBlacklist: () => void;
  isBlacklisted: (pubkey: string) => boolean;

  // Mute list operations
  addMutedItem: (item: MuteList[keyof MuteList][0], category: keyof MuteList) => void;
  removeMutedItem: (value: string, category: keyof MuteList) => void;
  updateMutedItem: (oldValue: string, newValue: string, category: keyof MuteList, reason?: string) => void;
  toggleItemPrivacy: (value: string, category: keyof MuteList) => void;
  bulkSetPrivacy: (isPrivate: boolean) => void;

  // Reset/clear
  clearSession: () => void;
  resetMuteList: () => void;
}

const initialMuteList: MuteList = {
  pubkeys: [],
  words: [],
  tags: [],
  threads: []
};

// Load blacklist from localStorage on initialization
const loadBlacklistFromStorage = (): Set<string> => {
  if (typeof window === 'undefined') return new Set<string>();

  try {
    const stored = localStorage.getItem('mutable_blacklisted_pubkeys');
    if (stored) {
      const array = JSON.parse(stored);
      return new Set<string>(array);
    }
  } catch (error) {
    console.error('Failed to load blacklist from localStorage:', error);
  }

  return new Set<string>();
};

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial state
      authState: 'disconnected',
      session: null,
      muteList: initialMuteList,
      muteListLoading: false,
      muteListError: null,
      muteListLastFetched: null,
      hasUnsavedChanges: false,
      publicLists: [],
      publicListsLoading: false,
      importedPackItems: {},
      activeTab: 'myList',
      showAuthModal: false,
      hasCompletedOnboarding: false,
      blacklistedPubkeys: loadBlacklistFromStorage(),

      // Auth actions
      setAuthState: (state) => set({ authState: state }),

      setSession: (session) => set({
        session,
        authState: session ? 'connected' : 'disconnected'
      }),

      // Mute list actions
      setMuteList: (list) => set({
        muteList: list,
        muteListLastFetched: Date.now(),
        hasUnsavedChanges: false
      }),

      setMuteListLoading: (loading) => set({ muteListLoading: loading }),

      setMuteListError: (error) => set({ muteListError: error }),

      setMuteListLastFetched: (timestamp) => set({ muteListLastFetched: timestamp }),

      setHasUnsavedChanges: (hasChanges) => set({ hasUnsavedChanges: hasChanges }),

      // Public lists actions
      setPublicLists: (lists) => set({ publicLists: lists }),

      setPublicListsLoading: (loading) => set({ publicListsLoading: loading }),

      getImportedCount: (packId) => {
        const state = get();
        return state.importedPackItems[packId]?.size || 0;
      },

      getNewItemsCount: (pack) => {
        const state = get();
        const muteList = state.muteList;
        const importedItems = state.importedPackItems[pack.id] || new Set();

        const existingValues = new Set([
          ...muteList.pubkeys.map(p => p.value),
          ...muteList.words.map(w => w.value),
          ...muteList.tags.map(t => t.value),
          ...muteList.threads.map(t => t.value),
        ]);

        let newCount = 0;
        // Count items that are neither in the mute list nor marked as imported (including blacklisted)
        (pack.list.pubkeys || []).forEach(p => {
          if (!existingValues.has(p.value) && !importedItems.has(p.value)) newCount++;
        });
        (pack.list.words || []).forEach(w => {
          if (!existingValues.has(w.value) && !importedItems.has(w.value)) newCount++;
        });
        (pack.list.tags || []).forEach(t => {
          if (!existingValues.has(t.value) && !importedItems.has(t.value)) newCount++;
        });
        (pack.list.threads || []).forEach(t => {
          if (!existingValues.has(t.value) && !importedItems.has(t.value)) newCount++;
        });

        return newCount;
      },

      markPackItemsAsImported: (packId, items) => set((state) => {
        const imported = { ...state.importedPackItems };
        if (!imported[packId]) {
          imported[packId] = new Set();
        }
        items.forEach(item => imported[packId].add(item));
        return { importedPackItems: imported };
      }),

      // UI actions
      setActiveTab: (tab) => set({ activeTab: tab }),

      setShowAuthModal: (show) => set({ showAuthModal: show }),

      setHasCompletedOnboarding: (completed) => set({ hasCompletedOnboarding: completed }),

      // Mute list CRUD operations
      addMutedItem: (item, category) => set((state) => {
        const newList = { ...state.muteList };
        newList[category] = [...newList[category], item as any];
        return { muteList: newList, hasUnsavedChanges: true };
      }),

      removeMutedItem: (value, category) => set((state) => {
        const newList = { ...state.muteList };
        (newList[category] as any) = newList[category].filter((item) => item.value !== value);
        return { muteList: newList, hasUnsavedChanges: true };
      }),

      updateMutedItem: (oldValue, newValue, category, reason) => set((state) => {
        const newList = { ...state.muteList };
        const index = newList[category].findIndex((item) => item.value === oldValue);
        if (index !== -1) {
          (newList[category] as any)[index] = {
            ...newList[category][index],
            value: newValue,
            reason
          };
        }
        return { muteList: newList, hasUnsavedChanges: true };
      }),

      toggleItemPrivacy: (value, category) => set((state) => {
        const newList = { ...state.muteList };
        const index = newList[category].findIndex((item) => item.value === value);
        if (index !== -1) {
          (newList[category] as any)[index] = {
            ...newList[category][index],
            private: !(newList[category][index] as any).private
          };
        }
        return { muteList: newList, hasUnsavedChanges: true };
      }),

      bulkSetPrivacy: (isPrivate) => set((state) => {
        const newList = { ...state.muteList };
        newList.pubkeys = newList.pubkeys.map(item => ({ ...item, private: isPrivate }));
        newList.words = newList.words.map(item => ({ ...item, private: isPrivate }));
        newList.tags = newList.tags.map(item => ({ ...item, private: isPrivate }));
        newList.threads = newList.threads.map(item => ({ ...item, private: isPrivate }));
        return { muteList: newList, hasUnsavedChanges: true };
      }),

      // Blacklist operations
      addToBlacklist: (pubkey) => set((state) => {
        const newBlacklist = new Set(state.blacklistedPubkeys);
        newBlacklist.add(pubkey);
        // Persist to localStorage
        if (typeof window !== 'undefined') {
          localStorage.setItem('mutable_blacklisted_pubkeys', JSON.stringify(Array.from(newBlacklist)));
        }
        return { blacklistedPubkeys: newBlacklist };
      }),

      removeFromBlacklist: (pubkey) => set((state) => {
        const newBlacklist = new Set(state.blacklistedPubkeys);
        newBlacklist.delete(pubkey);
        // Persist to localStorage
        if (typeof window !== 'undefined') {
          localStorage.setItem('mutable_blacklisted_pubkeys', JSON.stringify(Array.from(newBlacklist)));
        }
        return { blacklistedPubkeys: newBlacklist };
      }),

      clearBlacklist: () => set(() => {
        const newBlacklist = new Set<string>();
        // Persist to localStorage
        if (typeof window !== 'undefined') {
          localStorage.setItem('mutable_blacklisted_pubkeys', JSON.stringify([]));
        }
        return { blacklistedPubkeys: newBlacklist };
      }),

      isBlacklisted: (pubkey) => {
        const state = get();
        return state.blacklistedPubkeys.has(pubkey);
      },

      // Clear/reset
      clearSession: () => set({
        session: null,
        authState: 'disconnected',
        muteList: initialMuteList,
        muteListLastFetched: null,
        hasUnsavedChanges: false,
        muteListError: null
      }),

      resetMuteList: () => set({
        muteList: initialMuteList,
        muteListLastFetched: null,
        hasUnsavedChanges: false,
        muteListError: null
      })
    }),
    {
      name: 'mutable-storage',
      partialize: (state) => ({
        // Persist session, mute list, and unsaved changes flag
        session: state.session,
        muteList: state.muteList,
        hasUnsavedChanges: state.hasUnsavedChanges,
        activeTab: state.activeTab,
        hasCompletedOnboarding: state.hasCompletedOnboarding
      })
    }
  )
);
