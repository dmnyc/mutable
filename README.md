# Mutable

A web-based client for managing Nostr mute lists. Mutable allows users to back up, edit, discover, and share mute lists seamlessly.

## Features

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
- A Nostr browser extension (Alby or nos2x) for authentication

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/mutable.git
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
4. Your app will be live at `mutable-nostr.vercel.app`

## Project Structure

```
mutable/
├── app/                    # Next.js app directory
│   ├── dashboard/         # Dashboard page
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Landing page
├── components/            # React components
│   ├── AuthModal.tsx      # Authentication modal
│   ├── BackupRestore.tsx  # Backup/restore functionality
│   ├── CreatePublicList.tsx
│   ├── MuteListCategory.tsx
│   ├── MyMuteList.tsx
│   ├── PublicListCard.tsx
│   └── PublicLists.tsx
├── hooks/                 # Custom React hooks
│   └── useAuth.ts
├── lib/                   # Library code
│   ├── nostr.ts          # Nostr protocol functions
│   └── store.ts          # Zustand state management
├── types/                 # TypeScript type definitions
│   └── index.ts
└── public/               # Static assets
    └── mutable_logo.svg
```

## Usage

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

## Default Relays

- wss://relay.damus.io
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
- Inspired by [plebs-vs-zombies](https://github.com/dmnyc/plebs-vs-zombies)
