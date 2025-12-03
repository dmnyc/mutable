// Preferences Service
// Manages app preferences and settings
// Now with relay storage support for multi-device sync

import {
  publishAppData,
  fetchAppData,
  syncData,
  D_TAGS,
  type PreferencesData,
} from './relayStorage';

export interface AppPreferences {
  theme?: 'light' | 'dark';
  hasCompletedOnboarding?: boolean;
  // Add more preferences as needed
  [key: string]: unknown;
}

class PreferencesService {
  private storageKeys = {
    theme: 'theme',
    onboarding: 'mutable-onboarding-completed',
  };
  private syncInProgress = false;

  /**
   * Load preferences from localStorage
   */
  loadPreferences(): AppPreferences {
    if (typeof window === 'undefined') return {};

    const prefs: AppPreferences = {};

    try {
      // Load theme
      const theme = localStorage.getItem(this.storageKeys.theme);
      if (theme === 'light' || theme === 'dark') {
        prefs.theme = theme;
      }

      // Load onboarding status from Zustand persist storage
      const zustandStorage = localStorage.getItem('mutable-storage');
      if (zustandStorage) {
        const parsed = JSON.parse(zustandStorage);
        if (parsed.state?.hasCompletedOnboarding !== undefined) {
          prefs.hasCompletedOnboarding = parsed.state.hasCompletedOnboarding;
        }
      }
    } catch (error) {
      console.error('Failed to load preferences from localStorage:', error);
    }

    return prefs;
  }

  /**
   * Save preferences to localStorage
   */
  private savePreferences(prefs: AppPreferences): boolean {
    if (typeof window === 'undefined') return false;

    try {
      // Save theme
      if (prefs.theme) {
        localStorage.setItem(this.storageKeys.theme, prefs.theme);
      }

      // Save onboarding status (needs to update Zustand storage)
      if (prefs.hasCompletedOnboarding !== undefined) {
        const zustandStorage = localStorage.getItem('mutable-storage');
        if (zustandStorage) {
          const parsed = JSON.parse(zustandStorage);
          parsed.state = parsed.state || {};
          parsed.state.hasCompletedOnboarding = prefs.hasCompletedOnboarding;
          localStorage.setItem('mutable-storage', JSON.stringify(parsed));
        }
      }

      return true;
    } catch (error) {
      console.error('Failed to save preferences to localStorage:', error);
      return false;
    }
  }

  /**
   * Get a specific preference
   */
  getPreference<T = unknown>(key: string): T | undefined {
    const prefs = this.loadPreferences();
    return prefs[key] as T | undefined;
  }

  /**
   * Set a specific preference
   */
  setPreference(key: string, value: unknown): boolean {
    const prefs = this.loadPreferences();
    prefs[key] = value;
    return this.savePreferences(prefs);
  }

  /**
   * Convert AppPreferences to PreferencesData format
   */
  private toStorageFormat(prefs: AppPreferences): PreferencesData {
    return {
      version: 1,
      timestamp: Date.now(),
      ...prefs,
    };
  }

  /**
   * Convert PreferencesData to AppPreferences format
   */
  private fromStorageFormat(data: PreferencesData): AppPreferences {
    const { version, timestamp, ...prefs } = data;
    return prefs;
  }

  /**
   * Sync preferences data with relay storage
   * Call this on app initialization and after sign-in
   */
  async syncWithRelay(userPubkey: string, relays: string[]): Promise<boolean> {
    if (this.syncInProgress) {
      console.log('Preferences sync already in progress');
      return false;
    }

    this.syncInProgress = true;

    try {
      // Load local data
      const localPrefs = this.loadPreferences();
      const localData = Object.keys(localPrefs).length > 0
        ? this.toStorageFormat(localPrefs)
        : null;

      // Sync with relay
      const syncResult = await syncData<PreferencesData>(
        D_TAGS.PREFERENCES,
        localData,
        userPubkey,
        relays
      );

      // Only update local storage if relay data is newer
      if (syncResult.source === 'relay' || syncResult.source === 'merged') {
        const syncedPrefs = this.fromStorageFormat(syncResult.data);
        this.savePreferences(syncedPrefs);
      }

      // If local was newer, publish to relay
      if (syncResult.needsPublish) {
        await publishAppData(
          D_TAGS.PREFERENCES,
          syncResult.data,
          userPubkey,
          relays,
          false // not encrypted (preferences are not sensitive)
        );
      }

      console.log(`Preferences sync completed (source: ${syncResult.source})`);
      return true;
    } catch (error) {
      console.error('Failed to sync preferences data:', error);
      return false;
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Publish current preferences data to relay
   * Call this after changing preferences
   */
  async publishToRelay(userPubkey: string, relays: string[]): Promise<boolean> {
    try {
      const prefs = this.loadPreferences();
      const data = this.toStorageFormat(prefs);

      await publishAppData(
        D_TAGS.PREFERENCES,
        data,
        userPubkey,
        relays,
        false // not encrypted (preferences are not sensitive)
      );

      console.log('Preferences data published to relay');
      return true;
    } catch (error) {
      console.error('Failed to publish preferences data:', error);
      return false;
    }
  }

  /**
   * Fetch latest preferences data from relay
   * Useful for manual refresh
   */
  async fetchFromRelay(userPubkey: string, relays: string[]): Promise<AppPreferences> {
    try {
      const data = await fetchAppData(
        D_TAGS.PREFERENCES,
        userPubkey,
        relays
      ) as PreferencesData | null;

      if (!data) {
        return {};
      }

      return this.fromStorageFormat(data);
    } catch (error) {
      console.error('Failed to fetch preferences data from relay:', error);
      return {};
    }
  }
}

// Create singleton instance
export const preferencesService = new PreferencesService();
