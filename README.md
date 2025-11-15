# Mutable

A web-based client for managing Nostr mute lists. Mutable allows users to back up, edit, discover, and share mute lists seamlessly.

## Features

### Mute-o-Scope 🔍 NEW
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

### Authentication
- **NIP-07**: Connect using browser extensions (Alby, nos2x)
- **NIP-46**: Remote signer support (coming soon)
- **Session Persistence**: Automatic reconnection using localStorage

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
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Landing page
├── components/            # React components
│   ├── AuthModal.tsx      # Authentication modal
│   ├── BackupRestore.tsx  # Backup/restore functionality
│   ├── CreatePublicList.tsx
│   ├── MuteListCategory.tsx
│   ├── Mute-o-Scope.tsx   # Mute-o-Scope component
│   ├── MuteScoreModal.tsx # Mute Score info modal
│   ├── MyMuteList.tsx
│   ├── PublicListCard.tsx
│   ├── PublicLists.tsx
│   ├── ShareResultsModal.tsx  # Share results to Nostr
│   └── UserProfileModal.tsx   # User profile viewer
├── hooks/                 # Custom React hooks
│   └── useAuth.ts
├── lib/                   # Library code
│   ├── nostr.ts          # Nostr protocol functions
│   └── store.ts          # Zustand state management
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

### Personal Mute List Management
1. **Connect**: Click "Connect with Nostr" and authorize with your NIP-07 extension
2. **View Your List**: See your current mute list organized by category
3. **Edit**: Add, remove, or modify muted items
4. **Publish**: Save changes to Nostr relays
5. **Backup**: Export your list or save to browser storage
6. **Discover**: Search for public lists created by other users
7. **Share**: Create and publish your own public mute lists

## Nostr Event Kinds

- **kind:10000**: Personal mute list (replaceable event)
- **kind:30001**: Public/categorized mute list (parameterized replaceable event)
- **kind:1**: Text note (for sharing Mute-o-Scope results)

## Default Relays

- wss://relay.damus.io
- wss://relay.primal.net
- wss://nos.lol
- wss://relay.nostr.band
- wss://nostr.wine
- wss://relay.snort.social

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Built for the Nostr protocol
- From the creator of [Plebs vs. Zombies](https://plebsvszombies.cc)

## Author

- Created by The Daniel⚡️
- Vibed with Claude
