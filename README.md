# Mutable

A web-based client for managing Nostr mute lists. Mutable allows users to back up, edit, discover, and share mute lists seamlessly. Features Mute-o-Scope, a powerful tool to search who is publicly muting any Nostr profile.

## Features

### Mute-o-Scope 🔍 NEW

Discover who is publicly muting any Nostr profile. Mute-o-Scope searches across public mute lists (kind:10000) to show you exactly who has muted a specific npub, complete with a color-coded Mute Score that indicates the profile's overall visibility on Nostr.

- **No Login Required**: Search any npub to see who is publicly muting them
- **Real-time Profile Search**: Dynamic profile search with autocomplete
- **Mute Score System**: Color-coded scoring system with 9 levels based on public mute list count
  - ⬜ Pristine (0) → 🟦 Low (1-25) → 🟩 Average (26-50) → 🟨 Moderate (51-75) → 🟧 High (76-100) → 🟥 Severe (101-200) → 🟪 Legendary (201-300) → 🟫 Shitlisted (301-400) → ⬛ Blacklisted (401+)
- **Share Results**: Share Mute-o-Scope results directly to Nostr
- **Session-Aware**: Uses your configured relays when signed in
- **Profile Enrichment**: View detailed profiles of who is muting whom

### Personal Mute List Management (kind:10000)
- **View & Edit**: Fetch and display your current mute list with items organized into four categories:
  - Muted Pubkeys
  - Muted Words
  - Muted Tags (hashtags)
  - Muted Threads (event IDs)
- **CRUD Operations**: Add, edit, or delete entries in any category
- **Publish**: Sign and broadcast your updated mute list to Nostr relays

### Backup & Restore
- **JSON Export**: Download your mute list as a portable `.json` file
- **JSON Import**: Restore a previously exported mute list
- **Browser Storage**: Save snapshots to localStorage for quick recovery

### Public Mute Lists (kind:30001)
- **Discovery**: Search for public mute lists by creator npub or list name
- **Subscribe**: Copy public list contents into your personal mute list
- **Create**: Publish your own public mute lists for others to use

### Advanced List Management Tools
- **Muteuals**: Discover users who have publicly muted you in their mute lists
- **Reciprocals**: Find users you follow who don't follow you back
- **Decimator**: Randomly remove a percentage of your follows to cull your list down to a manageable size
- **Domain Purge**: Find and remove all users with a specific NIP-05 domain from your follow list
- **List Cleaner**: Scan your mute list for inactive or abandoned profiles
- **Note Nuke** ☢️ **NEW**: Delete Nostr events across multiple relays with a single click

### Multi-Device Sync via Relay Storage (NIP-78) ☁️ NEW
- **Persistent Settings**: Your protected users, blacklist, preferences, and imported packs are automatically synced to your Nostr relays
- **Seamless Multi-Device**: Access your data across all devices without manual backups
- **Encrypted Storage**: Sensitive data (protected users, blacklist) is encrypted using NIP-04
- **Manual Sync**: Trigger manual sync from Settings page
- **Sync Status**: View real-time sync status and last sync time

### Purgatory 🔥 NEW
Find follows using specific Nostr clients or posting in hellthreads:
- **Client Search**: Find follows using specific apps (Damus, Primal, Amethyst, etc.)
- **Hellthread Detection**: Discover follows posting in conversation threads over a configurable size threshold
- **NIP-65 Relay Discovery**: Intelligent per-user relay lookup for comprehensive results
- **Bulk Actions**: Mute or unfollow multiple users at once

### Snoopable 👀 NEW

Analyze public NIP-04 DM metadata to see who someone talks to most (without decrypting message content).

- **DM Circle**: Visualize top contacts in a shareable image
- **Leaderboard + Heatmap**: Rank frequent contacts and view activity timing
- **Shareable Notes**: Copy a ready-to-post note or publish directly to Nostr
- **No Login Required**: Analyze any npub using public relay data

### Authentication
- **NIP-07**: Connect using browser extensions (Alby, nos2x)
- **NIP-46**: Connect with remote signers like Amber for enhanced key security
- **Session Persistence**: Automatic reconnection with signer restoration

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Nostr Library**: nostr-tools
- **State Management**: Zustand with persistence
- **Icons**: lucide-react
- **Deployment**: Vercel

## Getting Started

### Prerequisites
- Node.js 18+ and npm
- A Nostr browser extension (Alby or nos2x) for authentication (optional - Mute-o-Scope works without login)

### Installation

```bash
# Clone the repository
git clone https://github.com/dmnyc/mutable.git
cd mutable

# Install dependencies
npm install

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
npm run build
npm start
```

## Deployment

The app is configured for deployment on Vercel:

1. Push your code to GitHub
2. Import the project in Vercel
3. Deploy with default settings
4. Your app will be live at `mutable.top`

## Project Structure

```
mutable/
├── app/                    # Next.js app directory
│   ├── dashboard/         # Dashboard page
│   ├── mute-o-scope/      # Mute-o-Scope standalone page
│   ├── note-nuke/         # Note Nuke standalone page
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Landing page
├── components/            # React components
│   ├── AuthModal.tsx      # Authentication modal
│   ├── BackupRestore.tsx  # Backup/restore functionality
│   ├── Backups.tsx        # Backup management component
│   ├── CreatePublicList.tsx
│   ├── Decimator.tsx      # Tool to aggressively filter mute lists
│   ├── DecimatorShareModal.tsx # Share options for Decimator results
│   ├── DomainPurge.tsx    # Tool to remove users by NIP-05 domain
│   ├── Footer.tsx         # Application footer
│   ├── GlobalUserSearch.tsx # Global search for Nostr profiles
│   ├── ImportConfirmationDialog.tsx
│   ├── ListCleaner.tsx    # Tool to identify and remove inactive profiles
│   ├── Mute-o-Scope.tsx   # Mute-o-Scope component
│   ├── MuteListCategory.tsx
│   ├── MuteScoreModal.tsx # Mute Score info modal
│   ├── Muteuals.tsx       # Component to discover mutual mutes
│   ├── MyMuteList.tsx
│   ├── NoteNuke.tsx       # Note Nuke component for event deletion
│   ├── NoteNukeSuccessModal.tsx # Success modal for event deletion
│   ├── NoteNukeWrapper.tsx # Wrapper with navigation for standalone route
│   ├── OnboardingModal.tsx # Onboarding flow for new users
│   ├── PrivacyControls.tsx
│   ├── PublicListCard.tsx
│   ├── PublicLists.tsx
│   ├── PublishSuccessModal.tsx # Success modal for publishing mute list
│   ├── Reciprocals.tsx    # Component to find non-reciprocal follows
│   ├── Settings.tsx       # User settings
│   ├── ShareResultsModal.tsx  # Share results to Nostr
│   ├── UnsavedChangesBanner.tsx # Banner for unsaved changes notification
│   ├── UserProfileModal.tsx   # User profile viewer with mute/unmute and reason input
│   └── UserSearchInput.tsx
├── hooks/                 # Custom React hooks
│   ├── useAuth.ts        # Authentication hook
│   └── useRelaySync.ts   # Relay storage sync hook
├── lib/                   # Library code
│   ├── nostr.ts          # Nostr protocol functions
│   ├── store.ts          # Zustand state management
│   ├── relayStorage.ts   # NIP-78 relay storage implementation
│   ├── syncManager.ts    # Sync coordination service
│   ├── protectionService.ts  # Protected users management
│   ├── blacklistService.ts   # Blacklist management
│   ├── preferencesService.ts # App preferences management
│   ├── importedPacksService.ts # Imported packs tracking
│   └── signers/          # Signer implementations
│       ├── types.ts      # Signer interface
│       ├── Nip07Signer.ts # NIP-07 browser extension signer
│       ├── Nip46Signer.ts # NIP-46 remote signer
│       └── index.ts      # Signer exports
├── types/                 # TypeScript type definitions
│   └── index.ts
└── public/               # Static assets
    ├── mutable_logo.svg
    ├── mute_o_scope_icon.svg
    └── plebs_vs_zombies_logo.svg
```

## Usage

### Mute-o-Scope
1. **Search**: Enter any npub, username, or hex pubkey
2. **View Results**: See who is publicly muting the searched profile
3. **Check Score**: Click the Mute Score badge to see all scoring levels
4. **Share**: Share results directly to Nostr with automatic tagging

### Note Nuke
1. **Paste**: Enter a note ID or paste a direct note link
2. **Preview**: Review the note before deletion
3. **Select Relays**: Choose which relays to publish the deletion event to
4. **Deploy**: Broadcast deletion event to selected relays
5. **Reason**: Optionally add a reason for the deletion

### Personal Mute List Management
1. **Connect**: Click "Connect with Nostr" and authorize with your NIP-07 extension
2. **View Your List**: See your current mute list organized by category
3. **Edit**: Add, remove, or modify muted items
4. **Publish**: Save changes to Nostr relays
5. **Backup**: Export your list or save to browser storage
6. **Discover**: Search for public lists created by other users
7. **Share**: Create and publish your own public mute lists

### Nostr Event Kinds

- **kind:10000**: Personal mute list (replaceable event)
- **kind:30001**: Public/categorized mute list (parameterized replaceable event)
- **kind:30078**: Application-specific data (NIP-78) - used for relay storage sync
- **kind:5**: Delete event marker (for Note Nuke)
- **kind:1**: Text note (for sharing Mute-o-Scope results)

## Relay Storage Implementation

Mutable implements NIP-78 (Application-specific Data) to sync your settings across devices:

### Synced Data Types

1. **Protected Users** (`d-tag: mutable:protected-users`)
   - Users protected from the Decimator feature
   - Encrypted with NIP-04

2. **Blacklist** (`d-tag: mutable:blacklist`)
   - Pubkeys prevented from re-import (removed inactive profiles)
   - Encrypted with NIP-04

3. **Preferences** (`d-tag: mutable:preferences`)
   - Theme, onboarding status, and other app settings
   - Not encrypted (non-sensitive data)

4. **Imported Packs** (`d-tag: mutable:imported-packs`)
   - Tracking of which community packs have been imported
   - Not encrypted (tracking data)

### How It Works

- **Automatic Sync**: Data syncs automatically on login and session restore
- **Timestamp Resolution**: Conflicts are resolved using timestamp (newest wins)
- **Local Cache**: localStorage serves as offline cache for quick access
- **Manual Sync**: Available in Settings for on-demand synchronization
- **Encryption**: Sensitive data encrypted to your own pubkey using NIP-04

## Default Relays

- wss://relay.damus.io
- wss://relay.primal.net
- wss://nos.lol
- wss://relay.snort.social
- wss://purplepag.es
- wss://relay.nostr.net

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Built for the Nostr protocol
- From the creator of [Plebs vs. Zombies](https://plebsvszombies.cc) and [Ghostr](https://ghostr.org)

## Author

- Created by The Daniel⚡️
- Vibed mostly with Claude and a bit with Gemini
