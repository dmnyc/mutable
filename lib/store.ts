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
  hasUnsavedChanges: boolean;

  // Public lists state
  publicLists: PublicMuteList[];
  publicListsLoading: boolean;
  importedPackItems: Record<string, Set<string>>; // packId -> Set of imported item values

  // UI state
  activeTab: 'myList' | 'publicLists' | 'muteuals' | 'backups' | 'settings';
  showAuthModal: boolean;
  hasCompletedOnboarding: boolean;

  // Actions
  setAuthState: (state: AuthState) => void;
  setSession: (session: UserSession | null) => void;
  setMuteList: (list: MuteList) => void;
  setMuteListLoading: (loading: boolean) => void;
  setMuteListError: (error: string | null) => void;
  setHasUnsavedChanges: (hasChanges: boolean) => void;
  setPublicLists: (lists: PublicMuteList[]) => void;
  setPublicListsLoading: (loading: boolean) => void;
  getImportedCount: (packId: string) => number;
  getNewItemsCount: (pack: PublicMuteList) => number;
  markPackItemsAsImported: (packId: string, items: string[]) => void;
  setActiveTab: (tab: 'myList' | 'publicLists' | 'muteuals' | 'backups' | 'settings') => void;
  setShowAuthModal: (show: boolean) => void;
  setHasCompletedOnboarding: (completed: boolean) => void;

  // Mute list operations
  addMutedItem: (item: MuteList[keyof MuteList][0], category: keyof MuteList) => void;
  removeMutedItem: (value: string, category: keyof MuteList) => void;
  updateMutedItem: (oldValue: string, newValue: string, category: keyof MuteList, reason?: string) => void;

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

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial state
      authState: 'disconnected',
      session: null,
      muteList: initialMuteList,
      muteListLoading: false,
      muteListError: null,
      hasUnsavedChanges: false,
      publicLists: [],
      publicListsLoading: false,
      importedPackItems: {},
      activeTab: 'myList',
      showAuthModal: false,
      hasCompletedOnboarding: false,

      // Auth actions
      setAuthState: (state) => set({ authState: state }),

      setSession: (session) => set({
        session,
        authState: session ? 'connected' : 'disconnected'
      }),

      // Mute list actions
      setMuteList: (list) => set({
        muteList: list,
        hasUnsavedChanges: false
      }),

      setMuteListLoading: (loading) => set({ muteListLoading: loading }),

      setMuteListError: (error) => set({ muteListError: error }),

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
        const existingValues = new Set([
          ...muteList.pubkeys.map(p => p.value),
          ...muteList.words.map(w => w.value),
          ...muteList.tags.map(t => t.value),
          ...muteList.threads.map(t => t.value),
        ]);

        let newCount = 0;
        pack.list.pubkeys.forEach(p => { if (!existingValues.has(p.value)) newCount++; });
        pack.list.words.forEach(w => { if (!existingValues.has(w.value)) newCount++; });
        pack.list.tags.forEach(t => { if (!existingValues.has(t.value)) newCount++; });
        pack.list.threads.forEach(t => { if (!existingValues.has(t.value)) newCount++; });

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

      // Clear/reset
      clearSession: () => set({
        session: null,
        authState: 'disconnected',
        muteList: initialMuteList,
        hasUnsavedChanges: false,
        muteListError: null
      }),

      resetMuteList: () => set({
        muteList: initialMuteList,
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
