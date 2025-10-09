## Project Spec: Mutable

**Mutable** is a web-based client for managing Nostr mute lists. It allows users to back up, edit, discover, and share mute lists seamlessly.

### 1. Core Objective

The primary goal of Mutable is to provide users with robust tools to control their Nostr experience by making mute list management intuitive and shareable. Users can manage their personal mute list (`kind:10000`) and discover, subscribe to, or create public mute lists (`kind:30001`).

---

### 2. Key Features

#### User & Session Management
* **Sign-In:** Users will connect their Nostr account using a **NIP-07** browser extension (e.g., Alby, nos2x) or a **NIP-46** remote signer by providing a connection string. The application should be client-side only and not store any private keys.
* **Session Persistence:** The user's public key and relay list should be saved in browser storage to maintain the session.

#### Personal Mute List Management
* **View & Edit:** The app will fetch, parse, and display the user's current mute list from their `kind:10000` event. The UI will separate muted items into four categories for clarity: **Pubkeys**, **Words**, **Tags**, and **Threads**.
* **CRUD Operations:** Users can add, edit, or delete entries in any of the four categories.
* **Publish:** Changes made to the list can be published back to the user's relays by signing a new `kind:10000` event.

#### Backup & Restore
* **Local Storage Backup:** Users can save a snapshot of their current mute list to the browser's `localStorage`.
* **JSON Export/Import:** Users can download their list as a `.json` file for portability and backup. They can also restore a list by uploading a previously exported file.
    * **Note:** The export/restore logic can be adapted from the existing implementation at `https://github.com/dmnyc/plebs-vs-zombies`.

#### Public Mute Lists
* **Discovery:** Users can search for public mute lists (`kind:30001`) by the creator's npub or by the list name (e.g., "NSFW Bots," "Spammers").
* **Copy/Subscribe:** Users can view the contents of a public list and choose to copy its contents into their own personal mute list.
* **Creation:** Users can create their own public lists (e.g., a curated list of spam bots) and publish them as `kind:30001` events for others to use. The list must have a unique name, which will be stored in the `d` tag for discoverability.

---

### 3. Technical Stack & Architecture

* **Framework:** **React** (or Next.js for its file-based routing and performance optimizations, which works well with Vercel).
* **Nostr Protocol Library:** **nostr-tools** or **nostr-dev-kit (NDK)** for handling communication with relays, event creation, and signer integration.
* **Styling:** **Tailwind CSS** for a utility-first approach to building the user interface quickly and efficiently.
* **State Management:** React Context or Zustand for managing application state like user sessions and the active mute list.
* **Deployment:** The application will be a Single Page Application (SPA) hosted on **Vercel** at `mutable-nostr.vercel.app`.

---

### 4. Data Model

The application will primarily interact with two Nostr event kinds:

* **`kind:10000` (Mute List):** A replaceable event representing the user's personal mute list. Muted items are stored in the event's `tags` array.
    * Muted pubkey: `["p", "<hex_pubkey>"]`
    * Muted event/thread: `["e", "<hex_event_id>"]`
    * Muted word: `["word", "spam"]`
    * Muted tag: `["t", "bad-hashtag"]`

* **`kind:30001` (Categorized People List / Mute List):** A parameterized replaceable event for public, shareable lists.
    * The `d` tag identifies the list's unique name (e.g., `d: "spam-bots"`).
    * Additional tags like `name` or `description` can provide human-readable metadata.
    * The list's contents use the same `p`, `e`, `word`, and `t` tag formats as `kind:10000`.

---

### 5. User Flow & UI Outline

1.  **Landing Page:**
    * A clean interface with a single call-to-action: "**Connect with Nostr**".
2.  **Authentication:**
    * Clicking "Connect" prompts the user to use a browser extension (NIP-07) or provides an input for a NIP-46 connection string.
3.  **Dashboard:**
    * Once connected, the user is taken to their main dashboard.
    * **"My List" Tab:** Displays their personal `kind:10000` list, with controls to add, edit, delete, and publish changes.
    * **"Backup/Restore" Section:** Buttons for "Export to JSON," "Import from JSON," and "Save to Browser."
    * **"Public Lists" Tab:** A search interface to find public lists and a section to create a new public list.
    * Viewing a public list shows its contents and provides a "**Copy to My List**" button.