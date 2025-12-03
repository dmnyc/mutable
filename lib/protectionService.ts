// Protection Service for Decimator
// Manages the list of protected users (immunity from decimation)

interface ProtectionRecord {
  pubkey: string;
  addedAt: number;
  note?: string;
}

class ProtectionService {
  private storageKey = 'mutable_protected_users';

  /**
   * Load protected pubkeys from localStorage
   */
  loadProtectedUsers(): Set<string> {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) return new Set();

      const records: ProtectionRecord[] = JSON.parse(stored);
      return new Set(records.map(r => r.pubkey));
    } catch (error) {
      console.error('Failed to load protected users:', error);
      return new Set();
    }
  }

  /**
   * Load all protection records with metadata
   */
  loadProtectionRecords(): ProtectionRecord[] {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) return [];

      return JSON.parse(stored);
    } catch (error) {
      console.error('Failed to load protection records:', error);
      return [];
    }
  }

  /**
   * Save protected pubkeys to localStorage
   */
  private saveProtectionRecords(records: ProtectionRecord[]): boolean {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(records));
      return true;
    } catch (error) {
      console.error('Failed to save protection records:', error);
      return false;
    }
  }

  /**
   * Add a user to the protected list
   */
  addProtection(pubkey: string, note?: string): boolean {
    if (!pubkey) return false;

    const records = this.loadProtectionRecords();

    // Check if already protected
    if (records.some(r => r.pubkey === pubkey)) {
      return true;
    }

    // Add new protection record
    records.push({
      pubkey,
      addedAt: Date.now(),
      note
    });

    return this.saveProtectionRecords(records);
  }

  /**
   * Remove a user from the protected list
   */
  removeProtection(pubkey: string): boolean {
    if (!pubkey) return false;

    const records = this.loadProtectionRecords();
    const filtered = records.filter(r => r.pubkey !== pubkey);

    return this.saveProtectionRecords(filtered);
  }

  /**
   * Check if a user is protected
   */
  isProtected(pubkey: string): boolean {
    const protectedSet = this.loadProtectedUsers();
    return protectedSet.has(pubkey);
  }

  /**
   * Get all protected pubkeys
   */
  getProtectedPubkeys(): string[] {
    return Array.from(this.loadProtectedUsers());
  }

  /**
   * Get count of protected users
   */
  getProtectedCount(): number {
    return this.loadProtectedUsers().size;
  }

  /**
   * Clear all protection records
   */
  clearAllProtection(): boolean {
    try {
      localStorage.removeItem(this.storageKey);
      return true;
    } catch (error) {
      console.error('Failed to clear protection records:', error);
      return false;
    }
  }

  /**
   * Filter users to remove protected ones
   */
  filterProtectedUsers<T extends { pubkey: string }>(users: T[]): T[] {
    const protectedSet = this.loadProtectedUsers();
    return users.filter(user => !protectedSet.has(user.pubkey));
  }
}

// Create singleton instance
export const protectionService = new ProtectionService();
