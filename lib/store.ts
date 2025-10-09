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

  // UI state
  activeTab: 'myList' | 'publicLists';
  showAuthModal: boolean;

  // Actions
  setAuthState: (state: AuthState) => void;
  setSession: (session: UserSession | null) => void;
  setMuteList: (list: MuteList) => void;
  setMuteListLoading: (loading: boolean) => void;
  setMuteListError: (error: string | null) => void;
  setHasUnsavedChanges: (hasChanges: boolean) => void;
  setPublicLists: (lists: PublicMuteList[]) => void;
  setPublicListsLoading: (loading: boolean) => void;
  setActiveTab: (tab: 'myList' | 'publicLists') => void;
  setShowAuthModal: (show: boolean) => void;

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
      activeTab: 'myList',
      showAuthModal: false,

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

      // UI actions
      setActiveTab: (tab) => set({ activeTab: tab }),

      setShowAuthModal: (show) => set({ showAuthModal: show }),

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
        // Only persist session data, not the full state
        session: state.session
      })
    }
  )
);
