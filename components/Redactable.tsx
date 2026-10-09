"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  RefreshCw,
  Search,
  Trash2,
  User,
  Copy,
  ExternalLink,
  AlertCircle,
  Lock,
  LogOut,
  X,
  Check,
  Loader2,
  Bot,
  CheckCircle2,
  Eye,
  EyeOff,
  Radio,
  Plus,
  ChevronDown,
} from "lucide-react";
import { Profile, DeletionEntry, RecoveredNote } from "@/types";
import Footer from "./Footer";
import DashboardNav from "./DashboardNav";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import {
  searchDeletionsBy,
  fetchRecentDeletionsFeed,
  enrichDeletionsWithProfiles,
  fetchNotesByIds,
  buildRecoveredNotes,
  fetchAddressableEvents,
  buildRecoveredAddressables,
  isPostKind,
  hexToNpub,
  hexToNote,
  npubToHex,
  searchProfiles,
  fetchProfile,
  fetchRelayListFromNostr,
  normalizeRelayList,
  normalizeRelayUrl,
  DEFAULT_RELAYS,
  KNOWN_RELAYS,
} from "@/lib/nostr";
import { getDisplayName, getErrorMessage } from "@/lib/utils/format";
import {
  getDeletionEventLink,
  getAddressLink,
  getProfileLink,
} from "@/lib/utils/links";
import { copyToClipboard } from "@/lib/utils/clipboard";

const INITIAL_LOAD_COUNT = 20;
const LOAD_MORE_COUNT = 20;
// How many feed rows each endless-scroll page adds.
const FEED_PAGE_COUNT = 30;

// Feed depth. Deletion-request spam (bots asking relays to delete other
// people's posts) is the large majority of kind:5 traffic, so a shallow
// window is nearly all spam. Fetch deep, then cap each author at a few
// entries so no single account — human or bot — fills the feed.
const FEED_FETCH_LIMIT = 1000;
const FEED_CAP_PER_AUTHOR = 5;
// Target-recovery runs in background waves of this many requests, keeping
// the relay query burst small instead of firing one giant fan-out.
const CLASSIFY_WAVE = 150;

// sessionStorage key for visitor-added session relays (this tab only).
const SESSION_RELAYS_KEY = "redactable-session-relays";

// Some kind:10002 lists are junk catalogs — hundreds of entries including
// localhost IPs and onion addresses that can never connect from a browser.
// Keep only public, resolvable hosts.
function isPublicRelayUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (parsed.protocol !== "wss:" && parsed.protocol !== "ws:") return false;
    if (host.endsWith(".onion") || host.endsWith(".i2p")) return false;
    if (
      /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(
        host,
      ) ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)
    ) {
      return false; // loopback/private/CGNAT ranges
    }
    return host.includes("."); // bare hostnames have no public DNS
  } catch {
    return false;
  }
}

// Cap the NIP-65 fold-in: write+both relays first (that's where the user
// actually publishes), then read relays, up to this many.
const NIP65_RELAY_CAP = 16;

type Tab = "lookup" | "feed";

function formatRelativeDate(timestamp?: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - date.getTime());
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMinutes = Math.floor(diffTime / (1000 * 60));
      return diffMinutes <= 1 ? "just now" : `${diffMinutes}m ago`;
    }
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

/** Short label for a deleted note id — note1…abcd, or a truncated address. */
function shortTarget(target: string): string {
  try {
    const note = hexToNote(target);
    return `${note.slice(0, 10)}…${note.slice(-4)}`;
  } catch {
    // a-tag coordinate — truncate the middle
    return target.length > 18
      ? `${target.slice(0, 12)}…${target.slice(-4)}`
      : target;
  }
}

/** A request's targets that relays still serve, in the order it named them. */
function recoveredTargets(
  entry: DeletionEntry,
  notes: Map<string, RecoveredNote>,
): RecoveredNote[] {
  return entry.deletedEventIds
    .map((id) => notes.get(id))
    .filter((n): n is RecoveredNote => !!n);
}

/** A request's addressable (a-tag) targets that relays still serve. */
function recoveredAddressTargets(
  entry: DeletionEntry,
  notes: Map<string, RecoveredNote>,
): RecoveredNote[] {
  return entry.deletedAddresses
    .map((coord) => notes.get(coord))
    .filter((n): n is RecoveredNote => !!n);
}

// Friendly names for the kinds that show up in deletion targets, so a
// coordinate chip never has to be decoded by the reader.
// Only post kinds can reach a label — everything else is filtered out in
// lib/nostr.ts (a-tag coordinates) or by the display filter in DeletionRow
// (recovered e-tag targets).
const KIND_LABELS: Record<number, string> = {
  1: "note",
  20: "picture",
  21: "video",
  42: "reply",
  1068: "comment",
  1111: "comment",
  30023: "long-form",
};

/** "long-form · 30023" for known kinds, "kind 30090" otherwise. */
function kindLabel(kind: number): string {
  const name = KIND_LABELS[kind];
  return name ? `${name} · ${kind}` : `kind ${kind}`;
}

/**
 * A third-party request names only other people's notes. NIP-09 tells relays
 * to honor deletions only from a note's own author, so these are noise —
 * flood bots live here. Unrecoverable targets don't count against the
 * requester: a note gone from every relay is exactly what an honored
 * self-delete looks like.
 */
function isThirdPartyRequest(
  entry: DeletionEntry,
  notes: Map<string, RecoveredNote>,
  addressNotes: Map<string, RecoveredNote>,
): boolean {
  const recovered = [
    ...recoveredTargets(entry, notes),
    ...recoveredAddressTargets(entry, addressNotes),
  ];
  return (
    recovered.length > 0 && recovered.every((n) => n.author !== entry.deletedBy)
  );
}

/**
 * A request is honored when every target it named — notes by id,
 * addressables by coordinate — has been checked and none is still served by
 * any scanned relay. The deletion did its job (or the events were never
 * widely stored). Requests with nothing checkable never count as honored.
 */
function isHonoredRequest(
  entry: DeletionEntry,
  checked: Set<string>,
  notes: Map<string, RecoveredNote>,
  addressChecked: Set<string>,
  addressNotes: Map<string, RecoveredNote>,
): boolean {
  const checkable =
    entry.deletedEventIds.length + entry.deletedAddresses.length;
  return (
    checkable > 0 &&
    entry.deletedEventIds.every((id) => checked.has(id)) &&
    entry.deletedAddresses.every((coord) => addressChecked.has(coord)) &&
    recoveredTargets(entry, notes).length === 0 &&
    recoveredAddressTargets(entry, addressNotes).length === 0
  );
}

/**
 * A request whose every recovered target is a non-post event — wallet
 * backups, app settings, drafts, reactions, lists. Not spam and not
 * honored: relays may still serve the events, but none of them is a post,
 * so the request has nothing worth surfacing and the row is dropped. An
 * e-tag id hides its kind until recovery, so this can only be known once
 * the targets have been fetched.
 */
function isMetadataOnlyRequest(
  entry: DeletionEntry,
  checked: Set<string>,
  notes: Map<string, RecoveredNote>,
  addressChecked: Set<string>,
  addressNotes: Map<string, RecoveredNote>,
): boolean {
  const recovered = [
    ...recoveredTargets(entry, notes),
    ...recoveredAddressTargets(entry, addressNotes),
  ];
  const checkable =
    entry.deletedEventIds.length + entry.deletedAddresses.length;
  return (
    checkable > 0 &&
    entry.deletedEventIds.every((id) => checked.has(id)) &&
    entry.deletedAddresses.every((coord) => addressChecked.has(coord)) &&
    recovered.length > 0 &&
    recovered.every((n) => !isPostKind(n.kind))
  );
}

// Cap on the fully-expanded rendering of a note body — a machine note can
// carry a multi-kilobyte blob, and "more" should never flood the feed.
const EXPANDED_CHAR_CAP = 1500;

const IMAGE_URL_RE = /^https?:\/\/\S+\.(jpe?g|png|gif|webp|avif)(\?\S*)?$/i;
const VIDEO_URL_RE = /^https?:\/\/\S+\.(mp4|webm|mov|m4v)(\?\S*)?$/i;

/**
 * Split note text into prose and direct media links (images and videos).
 * Matched links are consumed out of the prose (the way clients take media
 * out of the text) and rendered as a compact gallery below it.
 */
function splitMedia(text: string): {
  prose: string;
  media: { url: string; video: boolean }[];
} {
  const media: { url: string; video: boolean }[] = [];
  const prose = text
    .split(/(\s+)/)
    .map((token) => {
      // Sentence punctuation and quoting can hug a URL; strip the edges
      // before matching so "…see this.jpg)." still counts.
      const candidate = token.replace(/^[("'<]+|[.,;:!?)\]"'…]+$/g, "");
      if (IMAGE_URL_RE.test(candidate)) {
        media.push({ url: candidate, video: false });
        return "";
      }
      if (VIDEO_URL_RE.test(candidate)) {
        media.push({ url: candidate, video: true });
        return "";
      }
      return token;
    })
    .join("");
  return { prose: prose.trim(), media };
}

/**
 * Compact gallery for the direct media links a note contains. One item
 * keeps its natural aspect (height-capped); several become a small square
 * grid. Deletion targets are arbitrary content, so pictures and videos
 * start blurred — click to reveal, then blur again or open the original
 * file. Videos never autoplay; the reveal only unmutes the blur, and
 * playback stays under the viewer's finger on the controls.
 */
function NoteMedia({ items }: { items: { url: string; video: boolean }[] }) {
  const [revealed, setRevealed] = useState(false);
  const single = items.length === 1;
  const columns = single
    ? "grid-cols-1"
    : items.length <= 4
      ? "grid-cols-2"
      : "grid-cols-3";
  return (
    <div className={`mt-2 grid gap-1.5 ${columns}`}>
      {items.map(({ url, video }) => (
        <div
          key={url}
          className={`relative block overflow-hidden rounded-md border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-700 ${single ? "" : "aspect-square"}`}
        >
          {/* Relay-hosted files live on arbitrary domains that can't be
              allowlisted for next/image, so these are plain media
              elements. */}
          <a
            href={revealed ? url : undefined}
            target="_blank"
            rel="noopener noreferrer"
            title={revealed ? "Open media" : undefined}
            className="block"
          >
            {video ? (
              <video
                src={url}
                controls={revealed}
                playsInline
                preload="metadata"
                onError={(e) => {
                  const tile = e.currentTarget.closest("div");
                  if (tile) tile.style.display = "none";
                }}
                className={`${single ? "max-h-60 w-auto max-w-full" : "h-full w-full object-cover"} transition-[filter,transform] duration-200 ${revealed ? "" : "blur-xl scale-110"}`}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt="attached image"
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  const tile = e.currentTarget.closest("div");
                  if (tile) tile.style.display = "none";
                }}
                className={`${single ? "max-h-60 w-auto max-w-full" : "h-full w-full object-cover"} transition-[filter,transform] duration-200 ${revealed ? "" : "blur-xl scale-110"}`}
              />
            )}
          </a>
          {!revealed ? (
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/40 text-white/90 text-xs font-medium"
              aria-label={
                video ? "Click to view video" : "Click to view picture"
              }
            >
              <Eye size={16} />
              Click to view
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setRevealed(false)}
              className="absolute top-1.5 right-1.5 p-1.5 rounded-md bg-black/60 text-white hover:bg-black/80"
              aria-label="Blur again"
              title="Blur again"
            >
              <EyeOff size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Note body text, rendered the way a client would. Content that parses as
 * JSON (common for machine notes, which are frequent deletion targets)
 * pretty-prints instead of showing one unreadable minified line. Long
 * bodies clamp with a more/less toggle. Direct media links (images and
 * videos) are taken out of the text and shown as a compact gallery.
 */
function ExpandableNoteContent({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = content.trim();
  const { prose, media } = useMemo(() => splitMedia(trimmed), [trimmed]);
  if (!trimmed) return null;

  let display = prose;
  let isJson = false;
  if (prose.startsWith("{") || prose.startsWith("[")) {
    try {
      display = JSON.stringify(JSON.parse(prose), null, 2);
      isJson = true;
    } catch {
      // looked like JSON but isn't — render as plain text
    }
  }

  const overflow = display.length - EXPANDED_CHAR_CAP;
  const expandedText =
    overflow > 0
      ? `${display.slice(0, EXPANDED_CHAR_CAP)}\n… ${overflow.toLocaleString()} more characters truncated`
      : display;
  const collapsedClamp = isJson ? "line-clamp-3" : "line-clamp-2";
  // JSON always wraps to many lines when pretty-printed; plain text needs
  // the toggle only once it would actually clamp.
  const needsToggle = isJson
    ? display.length > 90
    : prose.length > 120 || prose.includes("\n");

  return (
    <div className="min-w-0">
      {display &&
        (isJson ? (
          <pre
            className={`text-xs font-mono text-gray-600 dark:text-gray-300 whitespace-pre-wrap break-words ${expanded ? "" : collapsedClamp}`}
          >
            {expanded ? expandedText : display}
          </pre>
        ) : (
          <p
            className={`text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap break-words ${expanded ? "" : collapsedClamp}`}
          >
            {expanded ? expandedText : display}
          </p>
        ))}
      {needsToggle && (
        <button
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
        >
          {expanded ? "less" : "more"}
        </button>
      )}
      {media.length > 0 && <NoteMedia items={media} />}
    </div>
  );
}

// Endless scroll: attach the returned ref to a sentinel div below the list;
// when it nears the viewport, onReachEnd fires and the caller grows its
// page. The callback lives in a ref so a new function identity never tears
// the observer down. `enabled` should include the tab check, so observers
// attach only for the list that is on screen. The sentinel node is held in
// state (callback ref), not a useRef: a list can become enabled — results
// land — in an earlier render than the one that mounts its sentinel, and
// only a node dependency makes the observer attach at that later point.
function useInfiniteScroll(onReachEnd: () => void, enabled: boolean) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const onReachEndRef = useRef(onReachEnd);
  onReachEndRef.current = onReachEnd;

  useEffect(() => {
    if (!node || !enabled) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onReachEndRef.current();
        }
      },
      // Load before the sentinel is visible so the feed feels continuous.
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, enabled]);

  return setNode;
}

/**
 * One deletion-request row. Lives at module scope — a component defined
 * inside Redactable would be a brand-new type on every render, so any
 * background state update (recovery, enrichment) would remount every row
 * and wipe local UI state like media reveals and copy flashes.
 */
function DeletionRow({
  entry,
  showRequester,
  recoveredNotes,
  recoveredAddresses,
  checkedTargetIds,
  checkedAddressIds,
  copiedKey,
  onCopy,
}: {
  entry: DeletionEntry;
  showRequester: boolean;
  recoveredNotes: Map<string, RecoveredNote>;
  recoveredAddresses: Map<string, RecoveredNote>;
  checkedTargetIds: Set<string>;
  checkedAddressIds: Set<string>;
  copiedKey: string | null;
  onCopy: (value: string, key: string) => void;
}) {
  const requesterProfile = entry.profile;
  const requesterNpub = hexToNpub(entry.deletedBy);
  // Only posts surface. An e-tag target whose recovery revealed a
  // non-post event (wallet backup, app setting, reaction) drops out of
  // the count and chips; addressable targets were parse-filtered already.
  const chipTargets = [
    ...entry.deletedEventIds.filter((id) => {
      const note = recoveredNotes.get(id);
      return !note || isPostKind(note.kind);
    }),
    ...entry.deletedAddresses,
  ];
  const postCount = chipTargets.length;
  const recovered = [
    ...recoveredTargets(entry, recoveredNotes),
    ...recoveredAddressTargets(entry, recoveredAddresses),
  ].filter((n) => isPostKind(n.kind));
  const thirdParty = isThirdPartyRequest(
    entry,
    recoveredNotes,
    recoveredAddresses,
  );
  const honored = isHonoredRequest(
    entry,
    checkedTargetIds,
    recoveredNotes,
    checkedAddressIds,
    recoveredAddresses,
  );

  // The red count pill and the third-party badge appear in both row
  // layouts — pull them out so the header variants stay readable. No
  // "own posts" badge: that's the default case everywhere now, so the
  // badge would restate it. Only the exception gets marked.
  const postCountPill = (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-full text-sm font-semibold">
      <Trash2 size={14} />
      {postCount} post{postCount === 1 ? "" : "s"}
    </span>
  );
  const classificationBadge =
    recovered.length > 0 && thirdParty ? (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full text-xs font-medium"
        title="NIP-09 relays only honor deletions from a note's own author"
      >
        <Bot size={12} />
        other people&rsquo;s posts
      </span>
    ) : null;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:border-gray-300 dark:hover:border-gray-600 transition-colors">
      {showRequester ? (
        // Client-feed header — avatar, name linking out to Nostr Archives, a
        // copyable npub beside it, and the timestamp on the right, the
        // way a Nostr client lays out a note author.
        <div className="flex items-start gap-3">
          {requesterProfile?.picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={requesterProfile.picture}
              alt=""
              className="w-10 h-10 rounded-full object-cover flex-shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
              <User size={18} className="text-gray-500 dark:text-gray-400" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <a
                href={getProfileLink(entry.deletedBy)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-gray-900 dark:text-white truncate hover:underline"
              >
                {getDisplayName(requesterProfile, "Unknown profile")}
              </a>
              <button
                onClick={() => onCopy(requesterNpub, `npub-${entry.eventId}`)}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 font-mono flex items-center gap-1 flex-shrink-0"
                title="Copy npub"
              >
                {requesterNpub.slice(0, 10)}…{requesterNpub.slice(-4)}
                {copiedKey === `npub-${entry.eventId}` ? (
                  <Check size={10} className="text-green-500" />
                ) : (
                  <Copy size={10} />
                )}
              </button>
              <span
                className="ml-auto text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap flex-shrink-0"
                title={new Date(entry.requestedAt * 1000).toLocaleString()}
              >
                {formatRelativeDate(entry.requestedAt)}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-1.5">
              {postCountPill}
              {classificationBadge}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          {postCountPill}
          {classificationBadge}
          <span
            className="text-xs text-gray-400 dark:text-gray-500"
            title={new Date(entry.requestedAt * 1000).toLocaleString()}
          >
            {formatRelativeDate(entry.requestedAt)}
          </span>
        </div>
      )}

      {entry.content?.trim() && (
        <div className="mt-2">
          <ExpandableNoteContent content={entry.content} />
        </div>
      )}

      {/* The actual posts, recovered live — relays that ignored the
          request still serve them, so you can read what was "deleted"
          and see who really wrote it. Quote-card style, the way a client
          renders the note a deletion tried to remove. */}
      {recovered.length > 0 && (
        <div className="mt-3 space-y-2">
          {recovered.slice(0, 2).map((note) => {
            const authorNpub = hexToNpub(note.author);
            return (
              <div
                key={note.id}
                className="rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/40"
              >
                <div className="flex items-center gap-2 px-3 pt-2.5 min-w-0">
                  {note.profile?.picture ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={note.profile.picture}
                      alt=""
                      className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
                      <User
                        size={12}
                        className="text-gray-500 dark:text-gray-400"
                      />
                    </div>
                  )}
                  <a
                    href={getProfileLink(note.author)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold text-gray-900 dark:text-white truncate hover:underline"
                  >
                    {getDisplayName(note.profile, "Unknown profile")}
                  </a>
                  <button
                    onClick={() => onCopy(authorNpub, `npub-${note.id}`)}
                    className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 font-mono flex items-center gap-0.5 flex-shrink-0"
                    title="Copy author npub"
                  >
                    {authorNpub.slice(0, 10)}…{authorNpub.slice(-4)}
                    {copiedKey === `npub-${note.id}` ? (
                      <Check size={10} className="text-green-500" />
                    ) : (
                      <Copy size={10} />
                    )}
                  </button>
                  <span className="ml-auto text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                    {kindLabel(note.kind)}
                  </span>
                </div>
                {note.content.trim() && (
                  <div className="px-3 pb-1 pt-1.5">
                    <ExpandableNoteContent content={note.content} />
                  </div>
                )}
                <p className="px-3 pb-2.5 text-xs text-gray-400 dark:text-gray-500 flex items-center gap-3">
                  <span>posted {formatRelativeDate(note.createdAt)}</span>
                  <a
                    href={getDeletionEventLink(note.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 hover:underline"
                  >
                    view
                    <ExternalLink size={10} />
                  </a>
                </p>
              </div>
            );
          })}
          {recovered.length > 2 && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              +{recovered.length - 2} more post
              {recovered.length - 2 === 1 ? "" : "s"} still on relays
            </p>
          )}
        </div>
      )}

      {/* Every target checked and none came back — the scanned relays
          already dropped them. That is what an honored deletion looks
          like from the outside. */}
      {honored && (
        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500 italic">
          Targets no longer served by any scanned relay — deletion honored
        </p>
      )}

      {/* Deleted-post targets — first few linked, the rest counted */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {chipTargets.slice(0, 3).map((target) => {
          const isCoord = target.includes(":");
          const name = isCoord
            ? KIND_LABELS[Number(target.split(":")[0])]
            : undefined;
          return (
            <a
              key={target}
              href={
                isCoord ? getAddressLink(target) : getDeletionEventLink(target)
              }
              target="_blank"
              rel="noopener noreferrer"
              title={target}
              className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs font-mono hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              {name ? `${name} · ${shortTarget(target)}` : shortTarget(target)}
            </a>
          );
        })}
        {chipTargets.length > 3 && (
          <span className="px-2 py-0.5 text-xs text-gray-400 dark:text-gray-500">
            +{chipTargets.length - 3} more
          </span>
        )}
      </div>

      {/* Action row, client-style — the request event links out, and
          every target id copies in one tap. */}
      <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-gray-700/60 flex items-center gap-6 text-sm text-gray-500 dark:text-gray-400">
        <a
          href={getDeletionEventLink(entry.eventId)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-gray-800 dark:hover:text-gray-200 font-medium"
        >
          <ExternalLink size={14} />
          njump
        </a>
        <button
          onClick={() => onCopy(chipTargets.join("\n"), `ids-${entry.eventId}`)}
          className="inline-flex items-center gap-1.5 hover:text-gray-800 dark:hover:text-gray-200 font-medium"
          title="Copy all deleted post IDs"
        >
          {copiedKey === `ids-${entry.eventId}` ? (
            <Check size={14} className="text-green-500" />
          ) : (
            <Copy size={14} />
          )}
          IDs
        </button>
      </div>
    </div>
  );
}

export default function Redactable() {
  const searchParams = useSearchParams();
  const { session, disconnect } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("feed");

  // Lookup tab state
  const [searchQuery, setSearchQuery] = useState("");
  const [targetPubkey, setTargetPubkey] = useState<string | null>(null);
  const [targetProfile, setTargetProfile] = useState<Profile | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchCompleted, setSearchCompleted] = useState(false);
  const [allDeletions, setAllDeletions] = useState<DeletionEntry[]>([]);
  const [displayedCount, setDisplayedCount] = useState(INITIAL_LOAD_COUNT);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Profile search dropdown
  const [profileSearchResults, setProfileSearchResults] = useState<Profile[]>(
    [],
  );
  const [showProfileResults, setShowProfileResults] = useState(false);
  const [isSearchingProfiles, setIsSearchingProfiles] = useState(false);
  const searchDropdownRef = useRef<HTMLDivElement>(null);

  // Feed tab state
  const [feedEntries, setFeedEntries] = useState<DeletionEntry[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedEnriching, setFeedEnriching] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedLoaded, setFeedLoaded] = useState(false);
  // Requests whose posts are already gone from every relay — the deletion
  // was honored, so there is nothing left to see. Hidden unless asked for.
  // (Third-party requests need no toggle: they are dropped outright.)
  const [hideHonored, setHideHonored] = useState(true);
  // How many feed rows to render at once — the raw window can hold 1,000
  // requests when the spam filter is toggled off, far too many for one
  // paint.
  const [feedDisplayedCount, setFeedDisplayedCount] = useState(30);

  // Recovered targets — note id -> recovered post, for the rows on screen.
  // The ref marks ids as requested the moment a fetch starts (no duplicate
  // fetches across pages); the state set lands when the batch resolves, so
  // rows can tell "checked and purged" apart from "still checking".
  const [recoveredNotes, setRecoveredNotes] = useState<
    Map<string, RecoveredNote>
  >(new Map());
  const [checkedTargetIds, setCheckedTargetIds] = useState<Set<string>>(
    new Set(),
  );
  const requestedTargetIds = useRef<Set<string>>(new Set());

  // Same machinery for a-tag targets (addressable events — lists, long-form,
  // app data; encrypted kinds never get this far), keyed by coordinate
  // instead of event id.
  const [recoveredAddresses, setRecoveredAddresses] = useState<
    Map<string, RecoveredNote>
  >(new Map());
  const [checkedAddressIds, setCheckedAddressIds] = useState<Set<string>>(
    new Set(),
  );
  const requestedAddressIds = useRef<Set<string>>(new Set());

  // Feed classification progress — the wave classifier below walks
  // feedEntries in background batches, and classifiedCount is how far it
  // has gotten. Counts in the header only speak for classified requests.
  const [classifiedCount, setClassifiedCount] = useState(0);
  // Bumped on each feed load. The classifier keys off this version — NOT
  // the feedEntries array identity — so the profile-enrichment swap (which
  // replaces the array with identical entries) can't abort a walk halfway
  // and strand ids as requested-but-never-recovered.
  const classifyTokenRef = useRef(0);
  const [feedVersion, setFeedVersion] = useState(0);
  const feedEntriesRef = useRef<DeletionEntry[]>([]);

  // Session-scoped relays the visitor adds by hand. sessionStorage on
  // purpose: extras apply to this tab only and never persist beyond it.
  const [sessionRelays, setSessionRelays] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = window.sessionStorage.getItem(SESSION_RELAYS_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? normalizeRelayList(parsed) : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        SESSION_RELAYS_KEY,
        JSON.stringify(sessionRelays),
      );
    } catch {
      // Private mode or storage disabled — extras just won't survive reload.
    }
  }, [sessionRelays]);
  const [relayInput, setRelayInput] = useState("");
  const [relayError, setRelayError] = useState<string | null>(null);
  const [showRelayPanel, setShowRelayPanel] = useState(false);

  // A looked-up user's NIP-65 (kind:10002) relay list. Their kind:5
  // requests and deleted posts are most likely on their own relays, so a
  // lookup folds these in ahead of the wide base set.
  const [targetRelays, setTargetRelays] = useState<string[]>([]);

  // Wide scan set: Mutable's defaults plus the archival/known relays Note
  // Nuke also casts to. Deleted posts surface wherever they were published,
  // so scans go wide rather than default-only.
  const relays = useMemo(
    () =>
      normalizeRelayList([
        ...targetRelays,
        ...sessionRelays,
        ...DEFAULT_RELAYS,
        ...KNOWN_RELAYS,
      ]),
    [targetRelays, sessionRelays],
  );

  // Deep link — /redactable?npub=… searches on load
  useEffect(() => {
    const npub = searchParams.get("npub");
    if (npub && !targetPubkey && !searching) {
      setSearchQuery(npub);
      handleSearch(npub);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Debounced profile search dropdown for partial queries
  useEffect(() => {
    const searchUserProfiles = async () => {
      if (!searchQuery.trim()) {
        setProfileSearchResults([]);
        setShowProfileResults(false);
        return;
      }
      if (
        searchQuery.startsWith("npub") ||
        searchQuery.startsWith("nprofile") ||
        searchQuery.match(/^[0-9a-f]{64}$/i)
      ) {
        setProfileSearchResults([]);
        setShowProfileResults(false);
        return;
      }
      setIsSearchingProfiles(true);
      setShowProfileResults(true);
      try {
        const results = await searchProfiles(searchQuery, relays, 10);
        setProfileSearchResults(results);
      } catch {
        setProfileSearchResults([]);
      } finally {
        setIsSearchingProfiles(false);
      }
    };
    const timeoutId = setTimeout(searchUserProfiles, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, relays]);

  // Auto-search the moment a full npub lands in the box
  useEffect(() => {
    const query = searchQuery.trim();
    const isCompleteNpub = query.startsWith("npub") && query.length === 63;
    const isCompleteNprofile = query.startsWith("nprofile");
    const isCompleteHex = query.match(/^[0-9a-f]{64}$/i);
    if (
      (isCompleteNpub || isCompleteNprofile || isCompleteHex) &&
      !searching &&
      !targetPubkey
    ) {
      const timeoutId = setTimeout(() => handleSearch(), 500);
      return () => clearTimeout(timeoutId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searching, targetPubkey]);

  // Close the dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchDropdownRef.current &&
        !searchDropdownRef.current.contains(event.target as Node)
      ) {
        setShowProfileResults(false);
      }
    };
    if (showProfileResults) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showProfileResults]);

  const handleSearch = async (override?: string) => {
    const raw = (override ?? searchQuery).trim();
    if (!raw) return;

    // Search results live on the lookup tab — the feed is the landing tab,
    // so a deep link or "Check my Deletions" has to switch over.
    setActiveTab("lookup");
    setSearching(true);
    setError(null);
    setProgress("");
    setSearchCompleted(false);
    setAllDeletions([]);
    setDisplayedCount(INITIAL_LOAD_COUNT);
    setShowProfileResults(false);

    try {
      let pubkey = raw;
      if (raw.startsWith("npub") || raw.startsWith("nprofile")) {
        try {
          const decoded = npubToHex(raw);
          if (!decoded) throw new Error("decode failed");
          pubkey = decoded;
        } catch {
          setError("Invalid npub format. Please check the npub and try again.");
          setSearching(false);
          return;
        }
      } else if (!pubkey.match(/^[0-9a-f]{64}$/i)) {
        // Treat as NIP-05 or username
        setProgress("Resolving user...");
        const profiles = await searchProfiles(raw, relays, 10);
        if (profiles.length === 0) {
          setError(`No user found with username or NIP-05: "${raw}"`);
          setSearching(false);
          return;
        }
        pubkey = profiles[0].pubkey;
        setTargetProfile(profiles[0]);
      }

      setTargetPubkey(pubkey);

      // Keep the URL shareable
      const searchedNpub = hexToNpub(pubkey);
      window.history.replaceState(null, "", `/redactable?npub=${searchedNpub}`);

      if (!targetProfile || targetProfile.pubkey !== pubkey) {
        setProgress("Loading profile...");
        const profile = await fetchProfile(pubkey, relays);
        setTargetProfile(profile);
      }

      setProgress("Searching network for deletion requests...");

      // Fold the user's own NIP-65 relay list into the scan — kind:5
      // requests and deleted posts live wherever the user publishes.
      setProgress("Checking the user's relay list (NIP-65)...");
      let nip65Relays: string[] = [];
      try {
        const { metadata } = await fetchRelayListFromNostr(pubkey);
        if (metadata) {
          nip65Relays = normalizeRelayList(
            [...metadata.both, ...metadata.write, ...metadata.read].filter(
              isPublicRelayUrl,
            ),
          ).slice(0, NIP65_RELAY_CAP);
        }
      } catch {
        // No relay list or it can't be fetched — the wide base set stands.
      }
      setTargetRelays(nip65Relays);

      // Merge explicitly: the `relays` value in this closure predates the
      // setTargetRelays call above, so it doesn't include them yet.
      const scanRelays = normalizeRelayList([
        ...nip65Relays,
        ...sessionRelays,
        ...DEFAULT_RELAYS,
        ...KNOWN_RELAYS,
      ]);

      const results = await searchDeletionsBy(pubkey, scanRelays, (count) => {
        setProgress(
          `Scanning ${scanRelays.length} relays... ${count} deletion request${count === 1 ? "" : "s"} found`,
        );
      });

      setAllDeletions(results);
      setProgress("");
      setSearchCompleted(true);

      if (results.length > 0) {
        // Patch profiles into the visible rows as they resolve
        const visible = results.slice(0, INITIAL_LOAD_COUNT);
        const enriched = await enrichDeletionsWithProfiles(visible, relays);
        setAllDeletions((prev) =>
          prev.map((d) => enriched.find((e) => e.eventId === d.eventId) || d),
        );
      }
    } catch (err) {
      console.error("Search error:", err);
      setError(getErrorMessage(err, "Failed to search for deletion requests"));
      setProgress("");
    } finally {
      setSearching(false);
    }
  };

  const handleReset = () => {
    window.history.replaceState(null, "", "/redactable");
    setSearchQuery("");
    setTargetPubkey(null);
    setTargetProfile(null);
    setTargetRelays([]);
    setAllDeletions([]);
    setDisplayedCount(INITIAL_LOAD_COUNT);
    setError(null);
    setProgress("");
    setSearchCompleted(false);
    setProfileSearchResults([]);
    setShowProfileResults(false);
  };

  const handleCheckMine = () => {
    if (!session?.pubkey) return;
    setSearchQuery(session.pubkey);
    handleSearch(session.pubkey);
  };

  const handleAddSessionRelay = () => {
    const normalized = normalizeRelayUrl(relayInput);
    if (!normalized) {
      setRelayError("Enter a relay URL starting with wss:// (or ws://).");
      return;
    }
    if (relays.includes(normalized)) {
      setRelayError("That relay is already in the scan set.");
      return;
    }
    setSessionRelays((prev) =>
      prev.includes(normalized) ? prev : [...prev, normalized],
    );
    setRelayInput("");
    setRelayError(null);
  };

  const handleRemoveSessionRelay = (relay: string) => {
    setSessionRelays((prev) => prev.filter((r) => r !== relay));
  };

  const loadFeed = async () => {
    setFeedLoading(true);
    setFeedError(null);
    try {
      // Render raw entries immediately — profiles patch in below, so a slow
      // archive lookup can never blank the feed. Fetch deep (1,000 per
      // relay) and cap each author at 5: without the cap a few spam bots
      // fill the whole window and real deletions never surface.
      const raw = await fetchRecentDeletionsFeed(
        relays,
        FEED_FETCH_LIMIT,
        30,
        FEED_CAP_PER_AUTHOR,
      );

      // kind:5 traffic never stops — a zero-event round means the relays
      // failed or rate-limited the query, not that nobody deleted anything.
      // Report it as an error instead of an empty feed.
      if (raw.length === 0) {
        throw new Error(
          "The scanned relays returned no deletion requests — they may be unreachable or rate-limiting. Try refreshing.",
        );
      }

      // New feed data invalidates everything the old classifier found.
      classifyTokenRef.current++;
      requestedTargetIds.current = new Set();
      setRecoveredNotes(new Map());
      setCheckedTargetIds(new Set());
      requestedAddressIds.current = new Set();
      setRecoveredAddresses(new Map());
      setCheckedAddressIds(new Set());
      setClassifiedCount(0);
      setFeedDisplayedCount(FEED_PAGE_COUNT);
      feedEntriesRef.current = raw;
      setFeedVersion((v) => v + 1);

      setFeedEntries(raw);
      setFeedLoaded(true);
      setFeedLoading(false);

      setFeedEnriching(true);
      // Deliberately NO token bump here: the enrichment swap replaces the
      // feedEntries array with identical entries, and aborting the walk on
      // it would strand in-flight target ids as requested-but-never-
      // recovered. The walk survives; only a real reload aborts it.
      const enriched = await enrichDeletionsWithProfiles(raw, relays);
      setFeedEntries((prev) =>
        prev.map((e) => enriched.find((n) => n.eventId === e.eventId) || e),
      );
    } catch (err) {
      console.error("Failed to load deletions feed:", err);
      setFeedError(getErrorMessage(err, "Failed to load deletions feed"));
    } finally {
      setFeedLoading(false);
      setFeedEnriching(false);
    }
  };

  useEffect(() => {
    if (activeTab === "feed" && !feedLoaded && !feedLoading) {
      loadFeed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Rows whose recovered targets are all non-post metadata (drafts,
  // backups, settings) never surface — same rule as the feed. Honored
  // requests (every target checked, none still served — the deletion
  // worked) are hidden behind the same toggle the feed uses.
  const visibleDeletions = useMemo(
    () =>
      allDeletions.filter(
        (e) =>
          !isMetadataOnlyRequest(
            e,
            checkedTargetIds,
            recoveredNotes,
            checkedAddressIds,
            recoveredAddresses,
          ) &&
          !(
            hideHonored &&
            isHonoredRequest(
              e,
              checkedTargetIds,
              recoveredNotes,
              checkedAddressIds,
              recoveredAddresses,
            )
          ),
      ),
    [
      allDeletions,
      checkedTargetIds,
      recoveredNotes,
      checkedAddressIds,
      recoveredAddresses,
      hideHonored,
    ],
  );
  // Honored rows in the current lookup (excluding metadata-only ones) —
  // drives the toggle copy and the end-of-list count.
  const lookupHonoredCount = useMemo(
    () =>
      allDeletions.filter(
        (e) =>
          isHonoredRequest(
            e,
            checkedTargetIds,
            recoveredNotes,
            checkedAddressIds,
            recoveredAddresses,
          ) &&
          !isMetadataOnlyRequest(
            e,
            checkedTargetIds,
            recoveredNotes,
            checkedAddressIds,
            recoveredAddresses,
          ),
      ).length,
    [
      allDeletions,
      checkedTargetIds,
      recoveredNotes,
      checkedAddressIds,
      recoveredAddresses,
    ],
  );
  const displayedDeletions = useMemo(
    () => visibleDeletions.slice(0, displayedCount),
    [visibleDeletions, displayedCount],
  );

  // Feed classifier — walk the feed in background waves, recovering the
  // posts each request names so rows can be split into real deletions vs
  // void third-party spam. Waves keep the relay fan-out small. The token
  // only changes on a real feed reload, which first clears the requested-
  // id set — so an aborted walk can never strand ids as requested-but-
  // never-recovered. Ids that come back empty are remembered as checked
  // (purged), so a resumed walk never re-asks for them.
  useEffect(() => {
    if (feedVersion === 0) return;
    const token = classifyTokenRef.current;
    const entries = feedEntriesRef.current;

    (async () => {
      for (let idx = 0; idx < entries.length; idx += CLASSIFY_WAVE) {
        if (token !== classifyTokenRef.current) return;
        const wave = entries.slice(idx, idx + CLASSIFY_WAVE);
        const missing = [
          ...new Set(wave.flatMap((e) => e.deletedEventIds)),
        ].filter((id) => !requestedTargetIds.current.has(id));

        if (missing.length > 0) {
          for (const id of missing) requestedTargetIds.current.add(id);
          const markChecked = () =>
            setCheckedTargetIds((prev) => {
              const next = new Set(prev);
              for (const id of missing) next.add(id);
              return next;
            });
          try {
            const found = await fetchNotesByIds(missing, relays);
            if (token !== classifyTokenRef.current) return;
            const recovered = await buildRecoveredNotes(
              [...found.values()],
              relays,
            );
            if (token !== classifyTokenRef.current) return;
            setRecoveredNotes((prev) => {
              const next = new Map(prev);
              for (const [id, note] of recovered) next.set(id, note);
              return next;
            });
            markChecked();
          } catch (err) {
            console.error("Failed to recover deleted-post targets:", err);
            markChecked();
          }
        }

        const missingAddresses = [
          ...new Set(wave.flatMap((e) => e.deletedAddresses)),
        ].filter((coord) => !requestedAddressIds.current.has(coord));
        if (missingAddresses.length > 0) {
          for (const coord of missingAddresses)
            requestedAddressIds.current.add(coord);
          const markChecked = () =>
            setCheckedAddressIds((prev) => {
              const next = new Set(prev);
              for (const coord of missingAddresses) next.add(coord);
              return next;
            });
          try {
            const found = await fetchAddressableEvents(
              missingAddresses,
              relays,
            );
            if (token !== classifyTokenRef.current) return;
            const recovered = await buildRecoveredAddressables(
              [...found.values()],
              relays,
            );
            if (token !== classifyTokenRef.current) return;
            setRecoveredAddresses((prev) => {
              const next = new Map(prev);
              for (const [coord, note] of recovered) next.set(coord, note);
              return next;
            });
            markChecked();
          } catch (err) {
            console.error("Failed to recover addressable targets:", err);
            markChecked();
          }
        }

        setClassifiedCount(Math.min(idx + CLASSIFY_WAVE, entries.length));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedVersion]);

  // Lookup recovery — fetch targets for whichever rows are on screen, so
  // paging through a user's history reveals previews incrementally.
  useEffect(() => {
    if (activeTab === "feed") return;
    const missing = displayedDeletions
      .flatMap((e) => e.deletedEventIds)
      .filter((id) => !requestedTargetIds.current.has(id));
    const missingAddresses = displayedDeletions
      .flatMap((e) => e.deletedAddresses)
      .filter((coord) => !requestedAddressIds.current.has(coord));
    if (missing.length === 0 && missingAddresses.length === 0) return;
    for (const id of missing) requestedTargetIds.current.add(id);
    for (const coord of missingAddresses)
      requestedAddressIds.current.add(coord);

    (async () => {
      try {
        if (missing.length > 0) {
          const found = await fetchNotesByIds(missing, relays);
          const recovered = await buildRecoveredNotes(
            [...found.values()],
            relays,
          );
          setRecoveredNotes((prev) => {
            const next = new Map(prev);
            for (const [id, note] of recovered) next.set(id, note);
            return next;
          });
        }
        if (missingAddresses.length > 0) {
          const found = await fetchAddressableEvents(missingAddresses, relays);
          const recovered = await buildRecoveredAddressables(
            [...found.values()],
            relays,
          );
          setRecoveredAddresses((prev) => {
            const next = new Map(prev);
            for (const [coord, note] of recovered) next.set(coord, note);
            return next;
          });
        }
      } catch (err) {
        console.error("Failed to recover deleted-post targets:", err);
      } finally {
        setCheckedTargetIds((prev) => {
          const next = new Set(prev);
          for (const id of missing) next.add(id);
          return next;
        });
        setCheckedAddressIds((prev) => {
          const next = new Set(prev);
          for (const coord of missingAddresses) next.add(coord);
          return next;
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, displayedDeletions]);

  const handleCopyValue = async (value: string, key: string) => {
    const success = await copyToClipboard(value);
    if (success) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  // Distinct posts targeted across every request — one note named in three
  // kind:5 events counts once.
  const distinctDeletedCount = useMemo(() => {
    const targets = new Set<string>();
    for (const entry of allDeletions) {
      for (const id of entry.deletedEventIds) targets.add(id);
      for (const addr of entry.deletedAddresses) targets.add(addr);
    }
    return targets.size;
  }, [allDeletions]);

  // Feed classification — which requests name only other people's notes.
  // Only classified requests count: the wave classifier is still walking
  // the window when the feed first renders, and an unclassified entry is
  // neither spam nor real yet.
  const classifiedFeedEntries = useMemo(
    () => feedEntries.slice(0, classifiedCount),
    [feedEntries, classifiedCount],
  );
  const thirdPartyFeedIds = useMemo(
    () =>
      new Set(
        classifiedFeedEntries
          .filter((e) =>
            isThirdPartyRequest(e, recoveredNotes, recoveredAddresses),
          )
          .map((e) => e.eventId),
      ),
    [classifiedFeedEntries, recoveredNotes, recoveredAddresses],
  );
  const honoredFeedIds = useMemo(
    () =>
      new Set(
        classifiedFeedEntries
          .filter((e) =>
            isHonoredRequest(
              e,
              checkedTargetIds,
              recoveredNotes,
              checkedAddressIds,
              recoveredAddresses,
            ),
          )
          .map((e) => e.eventId),
      ),
    [
      classifiedFeedEntries,
      checkedTargetIds,
      recoveredNotes,
      checkedAddressIds,
      recoveredAddresses,
    ],
  );
  // Requests whose recovered targets are all non-post metadata (drafts,
  // backups, settings) are dropped like third-party spam: there is no post
  // in them to show.
  const metadataFeedIds = useMemo(
    () =>
      new Set(
        classifiedFeedEntries
          .filter((e) =>
            isMetadataOnlyRequest(
              e,
              checkedTargetIds,
              recoveredNotes,
              checkedAddressIds,
              recoveredAddresses,
            ),
          )
          .map((e) => e.eventId),
      ),
    [
      classifiedFeedEntries,
      checkedTargetIds,
      recoveredNotes,
      checkedAddressIds,
      recoveredAddresses,
    ],
  );
  // Third-party requests are dropped outright, not filtered: NIP-09 relays
  // ignore them, they are pure spam, and there is nothing worth showing.
  // Metadata-only requests are dropped the same way. Honored requests are
  // only hidden behind a toggle — some people want to browse completed
  // deletions.
  const visibleFeedEntries = useMemo(
    () =>
      classifiedFeedEntries.filter(
        (e) =>
          !thirdPartyFeedIds.has(e.eventId) &&
          !metadataFeedIds.has(e.eventId) &&
          !(hideHonored && honoredFeedIds.has(e.eventId)),
      ),
    [
      classifiedFeedEntries,
      thirdPartyFeedIds,
      metadataFeedIds,
      honoredFeedIds,
      hideHonored,
    ],
  );
  const hiddenThirdPartyCount = thirdPartyFeedIds.size;
  // Metadata-only rows that are not also third-party — keeps the summary's
  // dropped-count from double-counting the overlap.
  const hiddenMetadataCount = classifiedFeedEntries.filter(
    (e) => metadataFeedIds.has(e.eventId) && !thirdPartyFeedIds.has(e.eventId),
  ).length;
  // Honored rows that are not also third-party or metadata-only — same
  // overlap hygiene for the honored count.
  const hiddenHonoredCount = classifiedFeedEntries.filter(
    (e) =>
      honoredFeedIds.has(e.eventId) &&
      !thirdPartyFeedIds.has(e.eventId) &&
      !metadataFeedIds.has(e.eventId),
  ).length;

  // Endless scroll — each list grows a page when its sentinel nears the
  // viewport. As classification waves complete, the enabled flag flips back
  // on, so the observer reattaches and keeps feeding rows while the user
  // sits at the bottom.
  const lookupSentinel = useInfiniteScroll(
    () => setDisplayedCount((prev) => prev + LOAD_MORE_COUNT),
    activeTab === "lookup" && displayedCount < allDeletions.length,
  );
  const feedSentinel = useInfiniteScroll(
    () => setFeedDisplayedCount((prev) => prev + FEED_PAGE_COUNT),
    activeTab === "feed" && visibleFeedEntries.length > feedDisplayedCount,
  );

  // Lookup honesty split — of the targets relays still serve, how many are
  // the user's own posts versus other people's. Grows as rows are paged in,
  // since only displayed rows get recovered.
  const lookupTargetStats = useMemo(() => {
    let own = 0;
    let others = 0;
    // Own targets recovery exposed as non-posts (backups, drafts,
    // settings) — they are not posts, so the headline must not count them.
    let nonPosts = 0;
    const seen = new Set<string>();
    for (const entry of displayedDeletions) {
      for (const id of entry.deletedEventIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        const note = recoveredNotes.get(id);
        if (!note) continue;
        if (note.author !== entry.deletedBy) {
          others++;
        } else if (isPostKind(note.kind)) {
          own++;
        } else {
          nonPosts++;
        }
      }
      for (const coord of entry.deletedAddresses) {
        if (seen.has(coord)) continue;
        seen.add(coord);
        const note = recoveredAddresses.get(coord);
        if (!note) continue;
        if (note.author !== entry.deletedBy) {
          others++;
        } else if (isPostKind(note.kind)) {
          own++;
        } else {
          nonPosts++;
        }
      }
    }
    return { own, others, nonPosts, checked: own + others };
  }, [displayedDeletions, recoveredNotes, recoveredAddresses]);

  // Headline count — the user's own posts only. Targets verified to still
  // exist and belong to someone else are omitted: NIP-09 makes those
  // requests void, so counting them as posts "they requested to delete"
  // overstates their history. Targets revealed as non-posts are omitted
  // the same way. Settles as recovery pages in.
  const ownDeletedCount = Math.max(
    0,
    distinctDeletedCount -
      lookupTargetStats.others -
      lookupTargetStats.nonPosts,
  );
  const targetNpub = targetPubkey ? hexToNpub(targetPubkey) : "";

  // Identity header — avatar, name, npub, and the Redactable by Mutable
  // lockup on the row so a screenshot of the header alone tells the whole
  // story of who was searched and with what tool.
  const targetIdentityHeader = targetPubkey ? (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-4 min-w-0 flex-1">
        {targetProfile?.picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={targetProfile.picture}
            alt=""
            className="w-12 h-12 rounded-full object-cover flex-shrink-0"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
            <User size={24} className="text-gray-500 dark:text-gray-400" />
          </div>
        )}
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white truncate">
            <a
              href={getProfileLink(targetPubkey)}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {getDisplayName(targetProfile, "Unknown profile")}
            </a>
          </h3>
          {targetProfile?.nip05 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
              {targetProfile.nip05}
            </p>
          )}
          <button
            onClick={() => handleCopyValue(targetNpub, "target-npub")}
            className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 font-mono truncate flex items-center gap-1"
            title="Copy npub"
          >
            {targetNpub.slice(0, 16)}…{targetNpub.slice(-8)}
            {copiedKey === "target-npub" ? (
              <Check size={12} className="text-green-500" />
            ) : (
              <Copy size={12} />
            )}
          </button>
        </div>
      </div>

      {/* Right column — brand lockup on top, and the self-lookup shortcut
          tucked under it so the user's identity block stays clean. */}
      <div className="flex flex-col items-end gap-2 flex-shrink-0 self-end sm:self-auto">
        {/* Brand lockup — matches Mute-o-Scope's: tool name, then the
            Mutable mark and wordmark (wordmark hidden below sm so phones
            show the icon only). Always visible so mobile screenshots
            carry the brand. */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-gray-700 dark:text-gray-200 whitespace-nowrap leading-none">
              Redactable
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500">by</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Image
              src="/mutable_logo.svg"
              alt="Mutable"
              width={18}
              height={18}
            />
            <Image
              src="/mutable_text_dark.svg"
              alt=""
              width={74}
              height={14}
              className="hidden sm:block dark:hidden"
            />
            <Image
              src="/mutable_text.svg"
              alt=""
              width={74}
              height={14}
              className="hidden sm:dark:block"
            />
          </div>
        </div>

        {/* Signed in and browsing someone else — jump straight to your
            own deletion history. */}
        {session?.pubkey && targetPubkey !== session.pubkey && (
          <button
            onClick={handleCheckMine}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 transition-colors"
            title="Look up your own deletion history"
          >
            <User size={12} />
            Look up yourself
          </button>
        )}
      </div>
    </div>
  ) : null;

  /** A deletion-request row — works for lookup (own deletions) and feed. */
  return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16 gap-4">
            <Link
              href="/"
              className="flex items-center space-x-3 flex-shrink-0 hover:opacity-80 transition-opacity"
              title="Go to Home"
            >
              <Image
                src="/mutable_logo.svg"
                alt="Mutable"
                width={40}
                height={40}
              />
              <Image
                src="/mutable_text_dark.svg"
                alt="Mutable"
                width={120}
                height={24}
                className="hidden sm:block dark:hidden"
              />
              <Image
                src="/mutable_text.svg"
                alt="Mutable"
                width={120}
                height={24}
                className="hidden sm:dark:block"
              />
            </Link>
            <Link
              href="/"
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex-shrink-0"
              title="Back to the Mutable home screen"
            >
              <ArrowLeft size={16} />
              <span className="hidden sm:inline">Back</span>
            </Link>

            <div className="flex-1" />

            {session ? (
              <button
                onClick={disconnect}
                className="flex items-center space-x-2 px-4 py-2 text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors border border-gray-200 dark:border-gray-700 rounded-lg"
                title="Disconnect"
              >
                <LogOut size={16} />
                <span className="hidden sm:inline">Disconnect</span>
              </button>
            ) : (
              <Link
                href="/"
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium flex items-center gap-2"
              >
                <Lock size={16} />
                Connect with Nostr
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* The dashboard tool menu is for signed-in users only — anonymous
          visitors navigate from the homepage lookup instead. */}
      {session && <DashboardNav activePage="redactable" />}

      <div className="flex-1 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <div className="container mx-auto px-4 py-8 max-w-6xl">
          {/* Page Header */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <div className="flex items-start gap-4 mb-4">
              <div className="flex-shrink-0 mt-1 w-10 h-10 rounded-lg bg-red-600 flex items-center justify-center">
                <Trash2 className="text-white" size={22} />
              </div>
              <div className="flex-1">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                  Redactable
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  See which posts Nostr users are asking relays to delete — look
                  up a pubkey&apos;s deletion history or browse the live feed
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {!session && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-sm font-medium border border-green-200 dark:border-green-700">
                  🔓 No sign-in required
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm font-medium border border-blue-200 dark:border-blue-700">
                🗑️ NIP-09 deletion requests · kind:5
              </span>
            </div>

            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>Note:</strong> A deletion request is a public kind:5
                event asking relays to forget a post — relays and archives may
                ignore it, and anything already copied can persist. A request is
                a wish, not an eraser.
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 mb-6">
            <div className="flex border-b border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setActiveTab("feed")}
                className={`flex-1 px-6 py-4 text-sm font-semibold transition-colors border-b-2 ${
                  activeTab === "feed"
                    ? "border-red-600 text-red-600 dark:border-red-500 dark:text-red-500"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                }`}
              >
                Live Feed
              </button>
              <button
                onClick={() => setActiveTab("lookup")}
                className={`flex-1 px-6 py-4 text-sm font-semibold transition-colors border-b-2 ${
                  activeTab === "lookup"
                    ? "border-red-600 text-red-600 dark:border-red-500 dark:text-red-500"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                }`}
              >
                Look Up a User
              </button>
            </div>

            {/* Relay coverage — the scan set is wide on purpose; this strip
                makes it visible and lets visitors widen it further. */}
            <div className="px-4 sm:px-6 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
              <button
                onClick={() => setShowRelayPanel(!showRelayPanel)}
                className="flex items-center gap-2 w-full text-left text-sm text-gray-600 dark:text-gray-300"
              >
                <Radio size={14} className="flex-shrink-0" />
                <span>
                  Scanning {relays.length} relays
                  {targetRelays.length > 0 &&
                    ` — includes ${targetRelays.length} from this user's NIP-65 list`}
                  {sessionRelays.length > 0 &&
                    ` — plus ${sessionRelays.length} added this session`}
                </span>
                <ChevronDown
                  size={14}
                  className={`ml-auto flex-shrink-0 transition-transform ${showRelayPanel ? "rotate-180" : ""}`}
                />
              </button>

              {showRelayPanel && (
                <div className="mt-3">
                  <div className="flex flex-wrap gap-1.5">
                    {relays.map((relay) => {
                      const isSession = sessionRelays.includes(relay);
                      const isTarget = targetRelays.includes(relay);
                      return (
                        <span
                          key={relay}
                          title={relay}
                          className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${
                            isSession
                              ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                              : isTarget
                                ? "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                                : "border-gray-200 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400"
                          }`}
                        >
                          {relay.replace(/^wss?:\/\//, "")}
                          {isSession && (
                            <button
                              onClick={() => handleRemoveSessionRelay(relay)}
                              aria-label={`Remove ${relay}`}
                              className="text-emerald-700 dark:text-emerald-400 hover:text-red-600 dark:hover:text-red-400"
                            >
                              <X size={11} />
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </div>

                  <div className="mt-3 flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={relayInput}
                      onChange={(e) => {
                        setRelayInput(e.target.value);
                        setRelayError(null);
                      }}
                      onKeyPress={(e) => {
                        if (e.key === "Enter") handleAddSessionRelay();
                      }}
                      placeholder="wss://relay.example.com"
                      className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    />
                    <button
                      onClick={handleAddSessionRelay}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                    >
                      <Plus size={14} />
                      Add for this session
                    </button>
                  </div>
                  {relayError && (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                      {relayError}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    Session relays apply to the feed and lookups in this tab
                    only. Refresh the feed or re-run a lookup to scan with a
                    relay you just added.
                  </p>
                </div>
              )}
            </div>

            {/* Lookup tab */}
            {activeTab === "lookup" && (
              <div className="p-6">
                <div
                  className="flex flex-col sm:flex-row gap-3"
                  ref={searchDropdownRef}
                >
                  <div className="relative w-full sm:flex-1">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        if (targetPubkey) handleReset();
                      }}
                      onKeyPress={(e) => {
                        if (e.key === "Enter") handleSearch();
                      }}
                      placeholder="Enter npub, NIP-05, or username..."
                      className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    />
                    {showProfileResults && (
                      <div className="absolute z-20 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-80 overflow-y-auto">
                        {isSearchingProfiles ? (
                          <div className="p-3 text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
                            <Loader2 size={16} className="animate-spin" />
                            Searching profiles...
                          </div>
                        ) : profileSearchResults.length > 0 ? (
                          profileSearchResults.map((profile) => (
                            <button
                              key={profile.pubkey}
                              onClick={() => {
                                setSearchQuery(
                                  profile.display_name ||
                                    profile.name ||
                                    profile.nip05 ||
                                    "",
                                );
                                setShowProfileResults(false);
                                handleSearch(hexToNpub(profile.pubkey));
                              }}
                              className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-3"
                            >
                              {profile.picture ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={profile.picture}
                                  alt=""
                                  className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                                />
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
                              )}
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                  {getDisplayName(profile, "Unknown")}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                  {profile.nip05 ||
                                    hexToNpub(profile.pubkey).slice(0, 16) +
                                      "…"}
                                </p>
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="p-3 text-sm text-gray-500 dark:text-gray-400">
                            No matching profiles
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Buttons wrap under the input on phones; from sm up the
                      wrapper dissolves (display:contents) so the buttons
                      join the input on one row like the classic layout. */}
                  <div className="flex flex-wrap gap-2 sm:contents">
                    <button
                      onClick={() => handleSearch()}
                      disabled={searching || !searchQuery.trim()}
                      className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 flex-1 sm:flex-initial"
                    >
                      {searching ? (
                        <>
                          <RefreshCw className="animate-spin" size={20} />
                          <span>Searching...</span>
                        </>
                      ) : (
                        <>
                          <Search size={20} />
                          <span>Search</span>
                        </>
                      )}
                    </button>
                    {session && !searching && (
                      <button
                        onClick={handleCheckMine}
                        className="px-4 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 flex-1 sm:flex-initial"
                        title="Check your own deletion history"
                      >
                        <User size={20} />
                        <span>Check my Deletions</span>
                      </button>
                    )}
                    {(searchQuery || allDeletions.length > 0) && !searching && (
                      <button
                        onClick={handleReset}
                        className="px-4 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium flex items-center justify-center gap-2 flex-1 sm:flex-initial"
                        title="Reset search"
                      >
                        <X size={20} />
                        <span>Reset</span>
                      </button>
                    )}
                  </div>
                </div>

                {searching && progress && (
                  <div className="mt-4 p-4 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-2 border-blue-200 dark:border-blue-700 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <RefreshCw
                        className="animate-spin text-blue-600 dark:text-blue-400"
                        size={20}
                      />
                      <div className="text-blue-900 dark:text-blue-100 font-medium">
                        {progress}
                      </div>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 rounded text-red-700 dark:text-red-200 text-sm flex items-start gap-2">
                    <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Lookup results */}
          {activeTab === "lookup" && !searching && searchCompleted && (
            <>
              {allDeletions.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                  {targetIdentityHeader}
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                      No Deletion Requests Found
                    </h3>
                    <p className="text-gray-600 dark:text-gray-400 text-sm">
                      This user has not published any kind:5 deletion requests
                      that the scanned relays still have. Either they have never
                      deleted anything — or the requests aged off every relay.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
                  {targetIdentityHeader}

                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                      Requested deletion of {ownDeletedCount} post
                      {ownDeletedCount === 1 ? "" : "s"} across{" "}
                      {allDeletions.length} deletion request
                      {allDeletions.length === 1 ? "" : "s"}
                    </h3>
                    {/* Honored filter — same rule and toggle as the feed. */}
                    {lookupHonoredCount > 0 && (
                      <button
                        onClick={() => setHideHonored((prev) => !prev)}
                        className={`w-full mt-2 mb-1 p-3 rounded-lg border text-sm font-medium transition-colors text-left flex items-center gap-2 ${
                          hideHonored
                            ? "bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                            : "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 hover:bg-yellow-100 dark:hover:bg-yellow-900/30"
                        }`}
                      >
                        <CheckCircle2 size={16} className="flex-shrink-0" />
                        {hideHonored ? (
                          <span>
                            {lookupHonoredCount} already-honored request
                            {lookupHonoredCount === 1 ? "" : "s"} (posts gone
                            from every relay) hidden — click to show
                          </span>
                        ) : (
                          <span>
                            Showing already-honored deletions — posts gone from
                            every relay — click to hide
                          </span>
                        )}
                      </button>
                    )}
                    {lookupTargetStats.checked > 0 &&
                      (lookupTargetStats.others > 0 ? (
                        <p className="text-sm text-amber-600 dark:text-amber-400 mb-1">
                          ⚠️ {lookupTargetStats.others} of{" "}
                          {lookupTargetStats.checked} post
                          {lookupTargetStats.checked === 1 ? "" : "s"} still on
                          relays belong to other people — not counted above.
                          NIP-09 relays ignore third-party deletion requests
                        </p>
                      ) : (
                        <p className="text-sm text-green-600 dark:text-green-400 mb-1">
                          ✓ {lookupTargetStats.checked} deleted post
                          {lookupTargetStats.checked === 1 ? "" : "s"} still on
                          relays and every one is their own — the rest are no
                          longer served by any scanned relay
                        </p>
                      ))}
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Newest requests first
                    </p>
                  </div>

                  {visibleDeletions.length === 0 ? (
                    /* History exists, but every request was honored or
                        metadata cleanup — nothing left to look at. */
                    <div className="py-12 text-center text-gray-500 dark:text-gray-400">
                      <CheckCircle2
                        size={32}
                        className="mx-auto mb-3 opacity-40"
                      />
                      <p className="text-sm mb-1">
                        Nothing left to see — every request was honored (posts
                        gone from every scanned relay) or was metadata cleanup.
                      </p>
                      {hideHonored && lookupHonoredCount > 0 && (
                        <p className="text-xs">
                          Use the toggle above to show already-honored
                          deletions.
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="space-y-3">
                        {displayedDeletions.map((entry) => (
                          <DeletionRow
                            key={entry.eventId}
                            entry={entry}
                            showRequester={false}
                            recoveredNotes={recoveredNotes}
                            recoveredAddresses={recoveredAddresses}
                            checkedTargetIds={checkedTargetIds}
                            checkedAddressIds={checkedAddressIds}
                            copiedKey={copiedKey}
                            onCopy={handleCopyValue}
                          />
                        ))}
                      </div>

                      {/* Endless-scroll sentinel — pages in more rows as the
                          user nears the bottom. */}
                      <div
                        ref={lookupSentinel}
                        className="py-6 text-center text-xs text-gray-400 dark:text-gray-500"
                      >
                        {displayedCount < allDeletions.length ? (
                          <span className="inline-flex items-center gap-2">
                            <Loader2 size={14} className="animate-spin" />
                            Loading more…
                          </span>
                        ) : hideHonored && lookupHonoredCount > 0 ? (
                          <span>
                            {visibleDeletions.length} deletion request
                            {visibleDeletions.length === 1 ? "" : "s"} still
                            standing — {lookupHonoredCount} already honored,
                            hidden
                          </span>
                        ) : (
                          <span>
                            All {visibleDeletions.length} deletion request
                            {visibleDeletions.length === 1 ? "" : "s"} shown
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {/* Feed tab */}
          {activeTab === "feed" && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Recent Deletion Requests
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {feedEnriching
                      ? "Loading profiles..."
                      : feedEntries.length > 0
                        ? hideHonored
                          ? `${visibleFeedEntries.length} deletion request${visibleFeedEntries.length === 1 ? "" : "s"} with posts still up in ${classifiedFeedEntries.length} checked so far — ${hiddenThirdPartyCount + hiddenMetadataCount} spam & metadata-only dropped, ${hiddenHonoredCount} already honored, hidden${classifiedCount < feedEntries.length ? ` (checking ${classifiedCount}/${feedEntries.length}…)` : ""}`
                          : `${visibleFeedEntries.length} real deletion request${visibleFeedEntries.length === 1 ? "" : "s"} in ${classifiedFeedEntries.length} checked so far — ${hiddenThirdPartyCount + hiddenMetadataCount} spam & metadata-only dropped${classifiedCount < feedEntries.length ? ` (checking ${classifiedCount}/${feedEntries.length}…)` : ""}`
                        : "Across the network"}
                  </p>
                </div>
                <button
                  onClick={() => loadFeed()}
                  disabled={feedLoading}
                  className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-50"
                  title="Refresh feed"
                >
                  <RefreshCw
                    size={18}
                    className={feedLoading ? "animate-spin" : ""}
                  />
                </button>
              </div>

              {/* Honored filter — requests whose posts every scanned relay
                  already dropped. The deletion worked; there is nothing
                  left to look at, so they are hidden unless asked for. */}
              {hiddenHonoredCount > 0 && (
                <button
                  onClick={() => setHideHonored((prev) => !prev)}
                  className={`w-full mb-4 p-3 rounded-lg border text-sm font-medium transition-colors text-left flex items-center gap-2 ${
                    hideHonored
                      ? "bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      : "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 hover:bg-yellow-100 dark:hover:bg-yellow-900/30"
                  }`}
                >
                  <CheckCircle2 size={16} className="flex-shrink-0" />
                  {hideHonored ? (
                    <span>
                      {hiddenHonoredCount} already-honored request
                      {hiddenHonoredCount === 1 ? "" : "s"} (posts gone from
                      every relay) hidden — click to show
                    </span>
                  ) : (
                    <span>
                      Showing already-honored deletions — posts gone from every
                      relay — click to hide
                    </span>
                  )}
                </button>
              )}

              {feedError && (
                <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 rounded text-red-700 dark:text-red-200 text-sm flex items-start gap-2">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  <span>{feedError}</span>
                </div>
              )}

              {feedLoading && feedEntries.length === 0 ? (
                <div className="py-12 flex flex-col items-center gap-3 text-gray-500 dark:text-gray-400">
                  <Loader2 size={24} className="animate-spin" />
                  <p className="text-sm">
                    Scanning relays for deletion requests...
                  </p>
                </div>
              ) : feedEntries.length === 0 && !feedError ? (
                <div className="py-12 text-center text-gray-500 dark:text-gray-400">
                  <Trash2 size={32} className="mx-auto mb-3 opacity-40" />
                  <p className="text-sm">
                    No deletion requests found on the scanned relays.
                  </p>
                </div>
              ) : visibleFeedEntries.length === 0 ? (
                <div className="py-12 text-center text-gray-500 dark:text-gray-400">
                  <Bot size={32} className="mx-auto mb-3 opacity-40" />
                  <p className="text-sm mb-1">
                    Nothing left in this window — every request was third-party
                    spam (which relays ignore), cleanup of drafts and app data,
                    or already honored, with the posts gone.
                  </p>
                  {hiddenHonoredCount > 0 && (
                    <p className="text-xs">
                      Use the toggle above to show already-honored deletions.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    {visibleFeedEntries
                      .slice(0, feedDisplayedCount)
                      .map((entry) => (
                        <DeletionRow
                          key={entry.eventId}
                          entry={entry}
                          showRequester
                          recoveredNotes={recoveredNotes}
                          recoveredAddresses={recoveredAddresses}
                          checkedTargetIds={checkedTargetIds}
                          checkedAddressIds={checkedAddressIds}
                          copiedKey={copiedKey}
                          onCopy={handleCopyValue}
                        />
                      ))}
                  </div>

                  {/* Endless-scroll sentinel — pages in more rows as the
                      user nears the bottom. While the classifier is still
                      walking, the feed itself keeps growing, so the
                      sentinel waits rather than declaring the end. */}
                  <div
                    ref={feedSentinel}
                    className="py-6 text-center text-xs text-gray-400 dark:text-gray-500"
                  >
                    {visibleFeedEntries.length > feedDisplayedCount ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" />
                        Loading more…
                      </span>
                    ) : classifiedCount < feedEntries.length ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" />
                        Checking more requests…
                      </span>
                    ) : (
                      <span>
                        That&rsquo;s all the data the connected relays will
                        serve us
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}
