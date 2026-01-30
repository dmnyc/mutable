import { Event } from "nostr-tools";

// Mute list item types
export type MuteItemType = "pubkey" | "word" | "tag" | "thread";

export interface MutedPubkey {
  type: "pubkey";
  value: string; // hex pubkey
  reason?: string;
  eventRef?: string; // hex event ID (converted from nevent/note)
  private?: boolean; // true = encrypted in content, false/undefined = public in tags
}

export interface MutedWord {
  type: "word";
  value: string;
  reason?: string;
  eventRef?: string; // hex event ID (converted from nevent/note)
  private?: boolean; // true = encrypted in content, false/undefined = public in tags
}

export interface MutedTag {
  type: "tag";
  value: string; // hashtag without #
  reason?: string;
  eventRef?: string; // hex event ID (converted from nevent/note)
  private?: boolean; // true = encrypted in content, false/undefined = public in tags
}

export interface MutedThread {
  type: "thread";
  value: string; // event id
  reason?: string;
  eventRef?: string; // hex event ID (converted from nevent/note)
  private?: boolean; // true = encrypted in content, false/undefined = public in tags
}

export type MuteItem = MutedPubkey | MutedWord | MutedTag | MutedThread;

// Mute list structure with all categories
export interface MuteList {
  pubkeys: MutedPubkey[];
  words: MutedWord[];
  tags: MutedTag[];
  threads: MutedThread[];
}

// Public mute list metadata
export interface PublicMuteList {
  id: string; // event id
  dTag: string; // unique identifier from d tag
  name: string;
  description?: string;
  author: string; // pubkey
  createdAt: number;
  list: MuteList;
  categories?: string[]; // Pack category tags
  isMutablePack?: boolean; // true if has ['L', 'mutable'] namespace tag
  isNostrguardPack?: boolean; // true if has ['L', 'nostrguard'] namespace tag
  namespace?: string; // The actual namespace value from ['L', ...] tag
}

// Relay list metadata from NIP-65
export interface RelayListMetadata {
  read: string[];
  write: string[];
  both: string[];
  timestamp: number;
}

// User session
export interface UserSession {
  pubkey: string;
  relays: string[];
  connected: boolean;
  signerType: "nip07" | "nip46" | null;
  relayListMetadata?: RelayListMetadata; // Cached NIP-65 relay list details
}

// Authentication state
export type AuthState = "disconnected" | "connecting" | "connected" | "error";

// Nostr event kinds used in the app
// Per NIP-51: kind 10000 is the mute list
// - Public items are in the 'tags' array
// - Private items are encrypted in the 'content' field using NIP-44
// - A single event can contain both public and private mutes
export const MUTE_LIST_KIND = 10000; // Mute list (NIP-51) - can have public tags AND encrypted content
export const PUBLIC_LIST_KIND = 30001; // Generic public lists (deprecated for mutes)
export const FOLLOW_LIST_KIND = 3;
export const RELAY_LIST_KIND = 10002; // NIP-65: Relay List Metadata

// Type guards
export function isMutedPubkey(item: MuteItem): item is MutedPubkey {
  return item.type === "pubkey";
}

export function isMutedWord(item: MuteItem): item is MutedWord {
  return item.type === "word";
}

export function isMutedTag(item: MuteItem): item is MutedTag {
  return item.type === "tag";
}

export function isMutedThread(item: MuteItem): item is MutedThread {
  return item.type === "thread";
}

// Extended Nostr Event type with our specific kinds
export interface MuteListEvent extends Event {
  kind: 10000;
}

export interface PublicListEvent extends Event {
  kind: 30001;
}

// Profile metadata (kind 0)
export interface Profile {
  pubkey: string; // hex pubkey
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  lud16?: string;
  website?: string;
}

export const PROFILE_KIND = 0;

// Muteal result (user who has muted you)
export interface MutealResult {
  mutedBy: string; // pubkey who muted you
  profile?: Profile;
  listName?: string;
  listDescription?: string;
  mutedAt?: number; // timestamp
  isFollowing: boolean;
  eventId: string; // the mute list event id
}

// Account activity status (for cleanup/inactive detection)
export interface AccountActivityStatus {
  pubkey: string;
  lastActivityTimestamp: number | null;
  lastActivityType: string | null; // 'profile', 'note', 'reaction', etc.
  daysInactive: number | null;
  hasProfile: boolean;
  isLikelyAbandoned: boolean;
}

// Domain purge result (user with specific NIP-05 domain)
export interface DomainPurgeResult {
  pubkey: string;
  profile?: Profile;
  nip05: string;
  isFollowing: boolean;
}

// Reciprocal follow result (user you follow who doesn't follow back)
export interface ReciprocalResult {
  pubkey: string;
  profile?: Profile;
  followsBack: boolean;
  checkedAt: number; // timestamp when checked
}

// Client filter result (user publishing with a specific client tag)
export interface ClientFilterResult {
  pubkey: string;
  profile?: Profile;
  clientTag: string; // The actual client tag value found
  eventCount: number; // Number of events found with this client
  lastSeen: number; // Timestamp of most recent event with this client
}

// Hellthread result (user who has posted top-level notes with excessive p tags)
export interface HellthreadResult {
  pubkey: string;
  profile?: Profile;
  hellthreadCount: number; // Total hellthread posts found
  maxTagCount: number; // Highest p-tag count in any single post
  worstEventId: string; // Event ID of the worst offender
  lastSeen: number; // Timestamp of most recent hellthread
}

// DM contact analysis result (Snoopable feature)
export interface DMContact {
  pubkey: string;
  profile?: Profile;
  sentCount: number; // DMs sent TO this person
  receivedCount: number; // DMs received FROM this person
  totalCount: number; // Total exchanges
  firstExchange: number; // Unix timestamp
  lastExchange: number; // Unix timestamp
  recencyScore?: number; // Time-decay weighted score for ranking
  title?: string; // Fun title (BFF, Ghost, etc.)
}

// Heatmap data point for DM activity
export interface DMActivityDay {
  date: string; // YYYY-MM-DD
  count: number;
  sentCount: number;
  receivedCount: number;
}

// Overall DM analysis result
export interface DMAnalysis {
  targetPubkey: string;
  targetProfile?: Profile;
  contacts: DMContact[];
  totalSent: number;
  totalReceived: number;
  heatmapData: DMActivityDay[];
  scanTimestamp: number;
  oldestDM?: number;
  newestDM?: number;
}
