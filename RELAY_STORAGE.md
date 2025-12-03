# Relay Storage Implementation (NIP-78)

## Overview

This document describes the persistent relay storage system implemented for Mutable using NIP-78 (Application-specific Data). This feature enables multi-device synchronization of important user settings and data.

## Architecture

### Core Components

1. **relayStorage.ts** - Low-level NIP-78 implementation
   - Publishes kind:30078 events with app-specific d-tags
   - Handles encryption/decryption using NIP-04
   - Fetches and syncs data from relays

2. **syncManager.ts** - Coordination service
   - Orchestrates syncing across all data types
   - Provides status tracking and error reporting
   - Exposes unified API for sync operations

3. **Service Layer** - Data-specific services
   - `protectionService.ts` - Protected users (Decimator immunity)
   - `blacklistService.ts` - Blacklisted pubkeys (removed inactive profiles)
   - `preferencesService.ts` - App preferences (theme, onboarding)
   - `importedPacksService.ts` - Imported pack tracking

4. **useRelaySync Hook** - React integration
   - Provides relay-aware methods for UI components
   - Automatically publishes changes after modifications
   - Simplifies integration with existing components

5. **useAuth Hook Integration**
   - Triggers automatic sync on login
   - Syncs on session restore
   - Fire-and-forget approach (non-blocking)

### Data Flow

```
User Action
    ↓
Component calls useRelaySync hook
    ↓
Service updates localStorage
    ↓
Service publishes to relay (async, non-blocking)
    ↓
Relay storage updated across devices
```

## Synced Data Types

### 1. Protected Users
- **D-tag**: `mutable:protected-users`
- **Encryption**: Yes (NIP-04)
- **Purpose**: Users protected from Decimator feature
- **Structure**:
  ```typescript
  {
    version: 1,
    timestamp: number,
    users: [{
      pubkey: string,
      addedAt: number,
      reason?: string
    }]
  }
  ```

### 2. Blacklist
- **D-tag**: `mutable:blacklist`
- **Encryption**: Yes (NIP-04)
- **Purpose**: Prevent re-import of removed inactive profiles
- **Structure**:
  ```typescript
  {
    version: 1,
    timestamp: number,
    pubkeys: string[]
  }
  ```

### 3. Preferences
- **D-tag**: `mutable:preferences`
- **Encryption**: No (non-sensitive)
- **Purpose**: App settings (theme, onboarding status)
- **Structure**:
  ```typescript
  {
    version: 1,
    timestamp: number,
    theme?: 'light' | 'dark',
    hasCompletedOnboarding?: boolean,
    [key: string]: unknown
  }
  ```

### 4. Imported Packs
- **D-tag**: `mutable:imported-packs`
- **Encryption**: No (tracking data)
- **Purpose**: Track which community packs have been imported
- **Structure**:
  ```typescript
  {
    version: 1,
    timestamp: number,
    packs: {
      [packId: string]: {
        importedAt: number,
        itemsImported: number
      }
    }
  }
  ```

## Sync Behavior

### Automatic Sync
- Triggered on login (after successful NIP-07 connection)
- Triggered on session restore (page reload with existing session)
- Non-blocking (doesn't prevent user from using the app)

### Manual Sync
- Available via "Sync Now" button in Settings page
- Shows real-time sync status
- Displays synced services and any errors

### Conflict Resolution
- **Strategy**: Timestamp-based (newest wins)
- **Process**:
  1. Fetch data from relay
  2. Compare timestamps
  3. Use newer version
  4. Publish if local is newer

### Offline Behavior
- localStorage serves as offline cache
- Changes are saved locally immediately
- Synced to relay when connection is available

## Security

### Encrypted Data
- Protected users and blacklist are encrypted using NIP-04
- Data is encrypted to user's own pubkey (self-encryption)
- Requires NIP-07 extension with nip04 support

### Non-Encrypted Data
- Preferences and imported packs are not encrypted
- These contain non-sensitive tracking information
- Allows for future public statistics or analytics

## UI Integration

### Settings Page
- **Relay Storage Sync** section displays:
  - Online/offline status
  - Last sync timestamp
  - Synced services (with checkmarks)
  - Error messages (if any)
  - Manual sync button

### Sync Status Updates
- Polls every 2 seconds for status changes
- Shows spinner during active sync
- Auto-dismisses success/error messages after 5 seconds

## Usage Examples

### In Components

```typescript
import { useRelaySync } from '@/hooks/useRelaySync';

function MyComponent() {
  const { addProtection, isOnline } = useRelaySync();

  const handleProtect = async (pubkey: string) => {
    // This automatically syncs to relay
    await addProtection(pubkey, 'Important user');
  };

  return (
    <div>
      {isOnline && <span>✓ Synced to relays</span>}
      <button onClick={() => handleProtect(somePubkey)}>
        Protect User
      </button>
    </div>
  );
}
```

### Direct Service Usage

```typescript
import { protectionService } from '@/lib/protectionService';

// Sync with relay
await protectionService.syncWithRelay(userPubkey, relays);

// Fetch latest from relay
const records = await protectionService.fetchFromRelay(userPubkey, relays);

// Publish current state
await protectionService.publishToRelay(userPubkey, relays);
```

## Future Enhancements

### Potential Improvements
1. **Backup Storage**: Enhanced imported packs format to include individual item values
2. **Version Migration**: Handle schema version changes gracefully
3. **Selective Sync**: Allow users to choose which data types to sync
4. **Sync Scheduling**: Periodic background sync
5. **Conflict Resolution UI**: Let users manually resolve conflicts
6. **Compression**: Compress large data sets before publishing
7. **Delta Sync**: Only sync changes instead of full state

### Known Limitations
1. **Imported Packs**: Currently only tracks which packs are imported, not individual items
2. **No Conflict UI**: Timestamp-based resolution is automatic (no user choice)
3. **Sync Errors**: Errors are logged but not retried automatically
4. **Large Data**: No compression or pagination for large datasets

## Testing

### Manual Testing Checklist
- [ ] Login triggers sync
- [ ] Page reload restores and syncs data
- [ ] Adding protected user syncs to relay
- [ ] Removing protected user syncs to relay
- [ ] Manual sync button works
- [ ] Sync status updates correctly
- [ ] Multi-device sync works (same account, different browsers)
- [ ] Offline changes sync when back online
- [ ] Encrypted data is encrypted (check relay events)
- [ ] Non-encrypted data is readable (check relay events)

### Verification
```bash
# Build succeeds without errors
npm run build

# Check for TypeScript errors
npx tsc --noEmit

# Check for console errors in browser
# Open DevTools console and watch for errors during sync
```

## References

- [NIP-78 Specification](https://github.com/nostr-protocol/nips/blob/master/78.md)
- [NIP-04 Encrypted Direct Messages](https://github.com/nostr-protocol/nips/blob/master/04.md)
- [NIP-07 Browser Extension](https://github.com/nostr-protocol/nips/blob/master/07.md)

## Credits

Implementation by Claude (Anthropic) with guidance from the Mutable project maintainer.

**Sources:**
- [NIP-78: Application-specific Data](https://github.com/nostr-protocol/nips/blob/master/78.md)
- [NIP-78 Overview](https://nostr-nips.com/nip-78)
- [Nostr Key-Value Storage Example](https://github.com/ShinoharaTa/nostr-key-value)
