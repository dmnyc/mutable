"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_RELAYS,
  KNOWN_RELAYS,
  fetchEventByAddress,
  fetchEventById,
  fetchUserPostsSince,
  getExpandedRelayList,
  getNip07Relays,
  hasNip07,
  hexToNote,
  hexToNpub,
  normalizeRelayList,
  normalizeRelayUrl,
  parseEventTarget,
  publishEventToRelay,
  signWithNip07,
} from "@/lib/nostr";
import { getEventLink } from "@/lib/utils/links";
import { useAuth } from "@/hooks/useAuth";
import { Event, EventTemplate, nip19 } from "nostr-tools";
import NoteNukeSuccessModal from "@/components/NoteNukeSuccessModal";
import {
  AlertTriangle,
  Radiation,
  Clipboard,
  ExternalLink,
  FileText,
  ListChecks,
  RefreshCw,
  Search,
  Shield,
  X,
} from "lucide-react";

type RelayStatus =
  | "idle"
  | "publishing"
  | "success"
  | "error"
  | "timeout"
  | "rejected"
  | "ignored";

type RelayTarget = {
  url: string;
  selected: boolean;
  status: RelayStatus;
  message?: string;
  sources: string[];
};

type RelaySource = {
  key: string;
  label: string;
  relays: string[];
};

const statusStyles: Record<RelayStatus, string> = {
  idle: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  publishing:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200",
  success:
    "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200",
  error: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200",
  timeout:
    "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-200",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200",
  ignored: "bg-gray-50 text-gray-400 dark:bg-gray-800 dark:text-gray-500",
};

const sourceLabels: Record<string, string> = {
  hint: "hint",
  user: "user",
  nip65: "nip-65",
  nip07: "nip-07",
  default: "default",
  known: "known",
};

function extractRelayHints(reference: string | null): string[] {
  if (!reference) return [];
  try {
    const decoded = nip19.decode(reference.toLowerCase());
    if (
      (decoded.type === "nevent" || decoded.type === "naddr") &&
      Array.isArray(decoded.data.relays)
    ) {
      return decoded.data.relays;
    }
  } catch (error) {
    // Ignore decode errors
  }
  return [];
}

function buildRelayTargets(sources: RelaySource[]) {
  const relayMap = new Map<string, RelayTarget>();
  const order: RelayTarget[] = [];
  const sourceCounts: Record<string, number> = {};

  sources.forEach((source) => {
    const unique = new Set<string>();
    source.relays.forEach((relay) => {
      const normalized = normalizeRelayUrl(relay);
      if (!normalized) return;
      unique.add(normalized);

      if (!relayMap.has(normalized)) {
        const target: RelayTarget = {
          url: normalized,
          selected: true,
          status: "idle",
          sources: [source.key],
        };
        relayMap.set(normalized, target);
        order.push(target);
      } else {
        const existing = relayMap.get(normalized)!;
        if (!existing.sources.includes(source.key)) {
          existing.sources.push(source.key);
        }
      }
    });
    sourceCounts[source.key] = unique.size;
  });

  return { targets: order, sourceCounts };
}

function mergeRelayTargets(previous: RelayTarget[], next: RelayTarget[]) {
  const previousMap = new Map(previous.map((relay) => [relay.url, relay]));
  return next.map((relay) => {
    const existing = previousMap.get(relay.url);
    if (!existing) return relay;
    return {
      ...relay,
      selected: existing.selected,
      status: existing.status,
      message: existing.message,
    };
  });
}

function formatTimestamp(timestamp: number) {
  try {
    return new Date(timestamp * 1000).toLocaleString();
  } catch {
    return "Unknown time";
  }
}

function formatRelativeDate(timestamp: number) {
  const diffMs = Date.now() - timestamp * 1000;
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return diffDays === 1 ? "yesterday" : `${diffDays}d ago`;
}

const KIND_LABELS: Record<number, string> = {
  1: "note",
  20: "picture",
  21: "video",
  42: "reply",
  1068: "comment",
  1111: "comment",
  30023: "long-form",
};

/** "long-form" for known post kinds, "kind 30090" otherwise. */
function kindLabel(kind: number) {
  return KIND_LABELS[kind] || `kind ${kind}`;
}

// Look-back windows offered by the feed. Deleting a note is usually
// something you decide about soon after posting, so the default window is
// short and the widest option still keeps one relay round cheap.
const LOOKBACK_OPTIONS = [1, 7, 30];
const DEFAULT_LOOKBACK_DAYS = 7;

// The feed reads from the user's own relays plus Mutable's defaults — a
// read that has to answer in seconds, not the wide publish set the nuke
// itself fans out to.
const FEED_RELAY_CAP = 16;
const FEED_PAGE_SIZE = 25;

// Past this many targets in one request, warn: relays cap event size and
// tag counts, and a rejected batch is worse than two accepted ones.
const BATCH_WARNING_THRESHOLD = 50;

// Parameterized replaceable events are deleted by coordinate: a kind:5
// naming only the id leaves the addressable version in place, so those
// targets carry both an e and an a tag.
function coordinateFor(event: Event): string | undefined {
  if (event.kind < 30000 || event.kind >= 40000) return undefined;
  const dTag = event.tags.find((tag) => tag[0] === "d")?.[1] ?? "";
  return `${event.kind}:${event.pubkey}:${dTag}`;
}

type NukeTarget = {
  key: string;
  eventId?: string;
  address?: string;
  label: string;
};

export default function NoteNuke() {
  const { session } = useAuth();
  const [noteInput, setNoteInput] = useState("");
  const [eventId, setEventId] = useState<string | null>(null);
  const [eventAddress, setEventAddress] = useState<string | null>(null);
  const [relayHints, setRelayHints] = useState<string[]>([]);
  const [nip07Relays, setNip07Relays] = useState<string[]>([]);
  const [relayTargets, setRelayTargets] = useState<RelayTarget[]>([]);
  const [relayUrls, setRelayUrls] = useState<string[]>([]);
  const [relaySourceCounts, setRelaySourceCounts] = useState<
    Record<string, number>
  >({});
  const [filterText, setFilterText] = useState("");
  const [reason, setReason] = useState("");
  const [previewEvent, setPreviewEvent] = useState<Event | null>(null);
  const [previewStatus, setPreviewStatus] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [lastPublishSummary, setLastPublishSummary] = useState<string | null>(
    null,
  );
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successSnapshot, setSuccessSnapshot] = useState({
    success: 0,
    total: 0,
  });
  const previewRequestRef = useRef<number | null>(null);

  // Feed of the signed-in user's own recent posts — the pick-and-nuke path.
  const [feedNotes, setFeedNotes] = useState<Event[]>([]);
  const [feedSelection, setFeedSelection] = useState<Set<string>>(new Set());
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedLoaded, setFeedLoaded] = useState(false);
  const [lookbackDays, setLookbackDays] = useState(DEFAULT_LOOKBACK_DAYS);
  const [feedFilter, setFeedFilter] = useState("");
  const [feedVisibleCount, setFeedVisibleCount] = useState(FEED_PAGE_SIZE);
  // Notes a deletion request has already named this session. They stay in
  // the feed until a refresh drops them, badged so a second pass through the
  // list doesn't look like the request never went out.
  const [nukedIds, setNukedIds] = useState<Set<string>>(new Set());
  const autoLoadedRef = useRef<string | null>(null);
  const lastTargetsRef = useRef<NukeTarget[]>([]);

  useEffect(() => {
    let active = true;
    if (!hasNip07()) return;
    getNip07Relays()
      .then((relays) => {
        if (!active) return;
        setNip07Relays(relays);
      })
      .catch(() => {
        if (!active) return;
        setNip07Relays([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const sources: RelaySource[] = [
      { key: "hint", label: "Event hints", relays: relayHints },
      {
        key: "user",
        label: "Session write relays",
        relays: session?.relays || [],
      },
      {
        key: "nip65",
        label: "NIP-65 metadata",
        relays: session?.relayListMetadata
          ? [
              ...session.relayListMetadata.read,
              ...session.relayListMetadata.write,
              ...session.relayListMetadata.both,
            ]
          : [],
      },
      { key: "nip07", label: "NIP-07 relays", relays: nip07Relays },
      { key: "default", label: "Mutable defaults", relays: DEFAULT_RELAYS },
      { key: "known", label: "Known relays", relays: KNOWN_RELAYS },
    ];

    const { targets, sourceCounts } = buildRelayTargets(sources);
    setRelayTargets((previous) => mergeRelayTargets(previous, targets));
    setRelayUrls(targets.map((relay) => relay.url));
    setRelaySourceCounts(sourceCounts);
  }, [relayHints, nip07Relays, session]);

  useEffect(() => {
    if (!noteInput.trim()) {
      setEventId(null);
      setEventAddress(null);
      setRelayHints([]);
      setInputError(null);
      setPreviewEvent(null);
      setPreviewStatus("");
      return;
    }

    const parsedTarget = parseEventTarget(noteInput);
    setEventId(parsedTarget.eventId);
    setEventAddress(parsedTarget.address);
    setRelayHints(extractRelayHints(parsedTarget.reference));

    if (!parsedTarget.eventId && !parsedTarget.address) {
      setInputError(
        "Enter a valid event reference (note/nevent/naddr, 64-char id, or event URL).",
      );
      setPreviewEvent(null);
      setPreviewStatus("");
      return;
    }

    setInputError(null);
  }, [noteInput]);

  useEffect(() => {
    if (!eventId && !eventAddress) return;
    if (relayUrls.length === 0) return;

    if (previewRequestRef.current) {
      window.clearTimeout(previewRequestRef.current);
    }

    setPreviewLoading(true);
    setPreviewStatus(`Scanning ${relayUrls.length} relays for a preview...`);

    previewRequestRef.current = window.setTimeout(async () => {
      try {
        const event = eventId
          ? await fetchEventById(eventId, relayUrls, 8000)
          : await fetchEventByAddress(eventAddress!, relayUrls, 8000);
        if (event) {
          setPreviewEvent(event);
          setPreviewStatus(`Event found (kind ${event.kind})`);
        } else {
          setPreviewEvent(null);
          setPreviewStatus(
            "Event not found on scanned relays (it may still exist elsewhere).",
          );
        }
      } finally {
        setPreviewLoading(false);
      }
    }, 400);

    return () => {
      if (previewRequestRef.current) {
        window.clearTimeout(previewRequestRef.current);
      }
    };
  }, [eventId, eventAddress, relayUrls]);

  // Read relays for the feed: the user's own (session, NIP-65 read/both,
  // NIP-07) topped up with Mutable's defaults. Deliberately not the full
  // publish set — a hundred-relay query would make the feed crawl.
  const feedRelays = useMemo(() => {
    const userRelays = normalizeRelayList([
      ...(session?.relays || []),
      ...(session?.relayListMetadata
        ? [...session.relayListMetadata.read, ...session.relayListMetadata.both]
        : []),
      ...nip07Relays,
    ]);
    return getExpandedRelayList(userRelays, FEED_RELAY_CAP);
  }, [session, nip07Relays]);

  const loadFeed = useCallback(
    async (days: number) => {
      const pubkey = session?.pubkey;
      if (!pubkey) return;

      setFeedLoading(true);
      setFeedError(null);
      try {
        const posts = await fetchUserPostsSince(pubkey, feedRelays, days);
        setFeedNotes(posts);
        setFeedVisibleCount(FEED_PAGE_SIZE);
        setFeedLoaded(true);
        // A selection can only name notes the feed still holds — a note
        // that dropped out of the window (or off the relays) must not stay
        // a silent deletion target.
        const available = new Set(posts.map((post) => post.id));
        setFeedSelection((previous) => {
          const next = new Set<string>();
          previous.forEach((id) => {
            if (available.has(id)) next.add(id);
          });
          return next;
        });
      } catch (error) {
        console.error("Failed to load note feed:", error);
        setFeedError(
          "Could not read your notes from these relays. Try refreshing.",
        );
      } finally {
        setFeedLoading(false);
      }
    },
    [session?.pubkey, feedRelays],
  );

  // Load once per signed-in pubkey; every later fetch is an explicit
  // refresh or window change, so relay-list updates don't re-query.
  useEffect(() => {
    const pubkey = session?.pubkey;
    if (!pubkey) return;
    if (autoLoadedRef.current === pubkey) return;
    autoLoadedRef.current = pubkey;
    loadFeed(lookbackDays);
  }, [session?.pubkey, lookbackDays, loadFeed]);

  const handleLookbackChange = (days: number) => {
    if (days === lookbackDays) return;
    setLookbackDays(days);
    loadFeed(days);
  };

  const filteredFeedNotes = useMemo(() => {
    const needle = feedFilter.trim().toLowerCase();
    if (!needle) return feedNotes;
    return feedNotes.filter((note) =>
      note.content.toLowerCase().includes(needle),
    );
  }, [feedNotes, feedFilter]);

  const visibleFeedNotes = useMemo(
    () => filteredFeedNotes.slice(0, feedVisibleCount),
    [filteredFeedNotes, feedVisibleCount],
  );

  const toggleFeedNote = (id: string) => {
    setFeedSelection((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Selects everything the current filter matches, not just the rendered
  // page — otherwise "select all" would quietly mean "select all 25".
  const handleSelectAllNotes = () => {
    setFeedSelection(new Set(filteredFeedNotes.map((note) => note.id)));
  };

  const visibleRelays = useMemo(() => {
    const lowerFilter = filterText.trim().toLowerCase();
    if (!lowerFilter) return relayTargets;
    return relayTargets.filter((relay) => relay.url.includes(lowerFilter));
  }, [relayTargets, filterText]);

  const selectedRelays = useMemo(
    () => relayTargets.filter((relay) => relay.selected),
    [relayTargets],
  );

  const mismatchAuthor = Boolean(
    previewEvent && session?.pubkey && previewEvent.pubkey !== session.pubkey,
  );

  const selectedFeedNotes = useMemo(
    () => feedNotes.filter((note) => feedSelection.has(note.id)),
    [feedNotes, feedSelection],
  );

  // Everything one Sign & Nuke will name: the notes ticked in the feed plus
  // a pasted reference, deduped. A reference whose author isn't the signed-in
  // user is left out — relays reject those, so it would only pad the request.
  const nukeTargets = useMemo<NukeTarget[]>(() => {
    const targets: NukeTarget[] = [];
    const seen = new Set<string>();

    selectedFeedNotes.forEach((note) => {
      seen.add(note.id);
      targets.push({
        key: note.id,
        eventId: note.id,
        address: coordinateFor(note),
        label: `${kindLabel(note.kind)} · ${formatRelativeDate(note.created_at)}`,
      });
    });

    const manualKey = eventId || eventAddress;
    if (manualKey && !seen.has(manualKey) && !mismatchAuthor) {
      targets.push({
        key: manualKey,
        eventId: eventId ?? undefined,
        address: eventAddress ?? undefined,
        label: "pasted reference",
      });
    }

    return targets;
  }, [selectedFeedNotes, eventId, eventAddress, mismatchAuthor]);

  const publishStats = useMemo(() => {
    const stats = {
      total: relayTargets.length,
      selected: selectedRelays.length,
      success: 0,
      error: 0,
      timeout: 0,
      rejected: 0,
    };
    relayTargets.forEach((relay) => {
      if (relay.status === "success") stats.success += 1;
      if (relay.status === "error") stats.error += 1;
      if (relay.status === "timeout") stats.timeout += 1;
      if (relay.status === "rejected") stats.rejected += 1;
    });
    return stats;
  }, [relayTargets, selectedRelays.length]);

  const updateRelay = (url: string, changes: Partial<RelayTarget>) => {
    setRelayTargets((previous) =>
      previous.map((relay) =>
        relay.url === url ? { ...relay, ...changes } : relay,
      ),
    );
  };

  const resetRelayStatuses = () => {
    setRelayTargets((previous) =>
      previous.map((relay) => ({
        ...relay,
        status: relay.selected ? "idle" : "ignored",
        message: undefined,
      })),
    );
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setNoteInput(text);
    } catch (error) {
      console.error("Failed to read clipboard:", error);
    }
  };

  const handleSelectAll = (selected: boolean) => {
    setRelayTargets((previous) =>
      previous.map((relay) => ({
        ...relay,
        selected,
        status: selected ? "idle" : "ignored",
        message: undefined,
      })),
    );
  };

  const handleRetryFailed = async () => {
    if (isPublishing) return;
    const retryRelays = relayTargets.filter((relay) =>
      ["error", "timeout", "rejected"].includes(relay.status),
    );
    if (retryRelays.length === 0) return;
    // Retry the request that was actually published: the selection is
    // cleared once a nuke goes out, so current targets would be empty.
    const targets = lastTargetsRef.current.length
      ? lastTargetsRef.current
      : nukeTargets;
    if (targets.length === 0) return;
    await publishDeletion(retryRelays, targets);
  };

  const publishDeletion = async (
    relays: RelayTarget[],
    targets: NukeTarget[],
  ) => {
    if (targets.length === 0) return;

    setIsPublishing(true);
    setLastPublishSummary(null);
    lastTargetsRef.current = targets;

    // NIP-09 lets one request name many events, so a multi-note nuke costs
    // one signature and one publish round per relay instead of N of each.
    const tags: string[][] = [];
    const seenTags = new Set<string>();
    targets.forEach((target) => {
      if (target.eventId && !seenTags.has(`e:${target.eventId}`)) {
        seenTags.add(`e:${target.eventId}`);
        tags.push(["e", target.eventId]);
      }
      if (target.address && !seenTags.has(`a:${target.address}`)) {
        seenTags.add(`a:${target.address}`);
        tags.push(["a", target.address]);
      }
    });
    // Attribution — clients that surface client tags show which tool
    // filed the request.
    tags.push(["client", "Note Nuke by Mutable"]);

    const eventTemplate: EventTemplate = {
      kind: 5,
      tags,
      content: reason.trim(),
      created_at: Math.floor(Date.now() / 1000),
    };

    let signedEvent: Event;
    try {
      signedEvent = await signWithNip07(eventTemplate);
    } catch (error) {
      setIsPublishing(false);
      alert(
        "Failed to sign deletion event. Make sure your NIP-07 extension is unlocked.",
      );
      return;
    }

    const queue = [...relays];
    const concurrency = 8;
    let successCount = 0;
    const runNext = async (): Promise<void> => {
      const relay = queue.shift();
      if (!relay) return;
      updateRelay(relay.url, { status: "publishing", message: undefined });

      const result = await publishEventToRelay(relay.url, signedEvent);
      if (result.status === "success") {
        successCount += 1;
      }
      updateRelay(relay.url, {
        status: result.status,
        message: result.message,
      });

      if (queue.length > 0) {
        await runNext();
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, queue.length) }, () =>
        runNext(),
      ),
    );

    setIsPublishing(false);
    setLastPublishSummary(
      `Published a deletion request naming ${targets.length} event${
        targets.length === 1 ? "" : "s"
      } to ${relays.length} relays. See relay statuses below.`,
    );
    setSuccessSnapshot({
      success: successCount,
      total: relays.length,
    });
    setShowSuccessModal(true);

    if (successCount > 0) {
      // Flag the nuked notes and drop them from the selection so a second
      // Sign & Nuke can't re-file the same request by accident.
      const nukedNow = targets
        .map((target) => target.eventId)
        .filter((id): id is string => Boolean(id));
      setNukedIds((previous) => new Set([...previous, ...nukedNow]));
      setFeedSelection((previous) => {
        const next = new Set(previous);
        nukedNow.forEach((id) => next.delete(id));
        return next;
      });
    }
  };

  const handleNuke = async () => {
    if (nukeTargets.length === 0) return;
    if (!hasNip07()) {
      alert("NIP-07 signer not available.");
      return;
    }
    if (selectedRelays.length === 0) {
      alert("Select at least one relay.");
      return;
    }

    const targetSummary =
      nukeTargets.length === 1
        ? `Event: ${nukeTargets[0].address || nukeTargets[0].eventId}`
        : `Events: ${nukeTargets.length} selected`;
    const confirmMessage =
      `NOTE NUKE\n\n` +
      `This will publish a deletion request naming ${nukeTargets.length} event${
        nukeTargets.length === 1 ? "" : "s"
      } to ${selectedRelays.length} relays.\n` +
      `${targetSummary}\n\n` +
      `Proceed?`;
    if (!confirm(confirmMessage)) return;

    resetRelayStatuses();
    await publishDeletion(
      selectedRelays.map((relay) => ({ ...relay })),
      nukeTargets,
    );
  };

  const displaySources = Object.entries(relaySourceCounts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${sourceLabels[key] || key}: ${count}`);

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/30">
            <Radiation className="text-red-600 dark:text-red-300" size={28} />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              Note Nuke
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 max-w-3xl">
              Pick notes from your recent feed — or paste any event reference —
              and publish a kind 5 deletion to every relay we can reach. This
              uses your NIP-65 relay list, NIP-07 relays, Mutable defaults, plus
              a wide catalog of known public relays for maximum coverage.
            </p>
            <div className="flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
              {displaySources.map((label) => (
                <span
                  key={label}
                  className="px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {session?.pubkey && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
              <FileText size={16} />
              Your recent notes
            </div>
            <div className="flex items-center gap-1 sm:ml-auto">
              {LOOKBACK_OPTIONS.map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => handleLookbackChange(days)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    days === lookbackDays
                      ? "bg-red-600 text-white"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
                  }`}
                >
                  {days === 1 ? "24h" : `${days}d`}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => loadFeed(lookbackDays)}
              disabled={feedLoading}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw
                size={14}
                className={feedLoading ? "animate-spin" : ""}
              />
              Refresh
            </button>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Notes you published in the last{" "}
            {lookbackDays === 1 ? "24 hours" : `${lookbackDays} days`}, read
            from {feedRelays.length} of your relays. Tick the ones to delete —
            one deletion request can name them all.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={feedFilter}
              onChange={(e) => {
                setFeedFilter(e.target.value);
                setFeedVisibleCount(FEED_PAGE_SIZE);
              }}
              placeholder="Filter notes by text..."
              className="flex-1 min-w-[12rem] px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200"
            />
            <button
              type="button"
              onClick={handleSelectAllNotes}
              disabled={filteredFeedNotes.length === 0}
              className="px-3 py-2 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50"
            >
              Select all ({filteredFeedNotes.length})
            </button>
            <button
              type="button"
              onClick={() => setFeedSelection(new Set())}
              disabled={feedSelection.size === 0}
              className="px-3 py-2 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50"
            >
              Clear
            </button>
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
              {feedSelection.size} selected
            </span>
          </div>

          {feedError && (
            <div className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
              <AlertTriangle size={16} />
              {feedError}
            </div>
          )}

          {feedLoading && feedNotes.length === 0 && (
            <div className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
              <RefreshCw size={14} className="animate-spin" />
              Reading your notes from {feedRelays.length} relays...
            </div>
          )}

          {!feedLoading &&
            !feedError &&
            feedLoaded &&
            feedNotes.length === 0 && (
              <div className="text-sm text-gray-600 dark:text-gray-400">
                No notes from the last{" "}
                {lookbackDays === 1 ? "24 hours" : `${lookbackDays} days`} on
                these relays. Try a wider window, or paste an event reference
                below.
              </div>
            )}

          {feedNotes.length > 0 && filteredFeedNotes.length === 0 && (
            <div className="text-sm text-gray-600 dark:text-gray-400">
              No notes match that filter.
            </div>
          )}

          {visibleFeedNotes.length > 0 && (
            <div className="space-y-2 max-h-96 overflow-auto pr-1">
              {visibleFeedNotes.map((note) => {
                const selected = feedSelection.has(note.id);
                const nuked = nukedIds.has(note.id);
                return (
                  <label
                    key={note.id}
                    className={`flex gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selected
                        ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/20"
                        : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900/40"
                    } ${nuked ? "opacity-60" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleFeedNote(note.id)}
                      className="mt-0.5 h-4 w-4 flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                        <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700">
                          {kindLabel(note.kind)}
                        </span>
                        <span title={formatTimestamp(note.created_at)}>
                          {formatRelativeDate(note.created_at)}
                        </span>
                        {nuked && (
                          <span className="px-2 py-0.5 rounded-full font-semibold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200">
                            deletion requested
                          </span>
                        )}
                        <a
                          href={getEventLink(note.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="ml-auto inline-flex items-center gap-0.5 hover:underline"
                        >
                          jumble
                          <ExternalLink size={10} />
                        </a>
                      </div>
                      <div className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap break-words line-clamp-3">
                        {note.content.trim() || (
                          <span className="italic text-gray-400 dark:text-gray-500">
                            (no text content)
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          {filteredFeedNotes.length > feedVisibleCount && (
            <button
              type="button"
              onClick={() =>
                setFeedVisibleCount((count) => count + FEED_PAGE_SIZE)
              }
              className="w-full px-3 py-2 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
            >
              Show more ({filteredFeedNotes.length - feedVisibleCount} left)
            </button>
          )}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 shadow-sm space-y-5">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Event reference
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Paste a single event to add it to the targets — optional when you
            have notes ticked in the feed above.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="note1... / nevent1... / naddr1... / event URL / 64-char id"
              className="flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100"
            />
            <button
              type="button"
              onClick={handlePaste}
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <Clipboard size={18} />
            </button>
          </div>
          {inputError && (
            <div className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
              <X size={16} />
              {inputError}
            </div>
          )}
          {eventId && (
            <div className="text-xs text-gray-500 dark:text-gray-400 break-all">
              Parsed event id: <span className="font-mono">{eventId}</span>
            </div>
          )}
          {eventAddress && (
            <div className="text-xs text-gray-500 dark:text-gray-400 break-all">
              Parsed event address:{" "}
              <span className="font-mono">{eventAddress}</span>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Deletion reason (optional)
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason stored in deletion event content"
            className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100"
          />
        </div>

        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-900/40">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
            <Search size={16} />
            Event preview
          </div>
          {previewLoading && (
            <div className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
              <RefreshCw size={14} className="animate-spin" />
              {previewStatus}
            </div>
          )}
          {!previewLoading && previewStatus && (
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {previewStatus}
            </div>
          )}
          {previewEvent && (
            <div className="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-200">
              <div className="flex flex-wrap gap-2">
                <span className="px-2 py-1 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  kind {previewEvent.kind}
                </span>
                <span className="px-2 py-1 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  {formatTimestamp(previewEvent.created_at)}
                </span>
                <span className="px-2 py-1 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  tags {previewEvent.tags.length}
                </span>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 break-all">
                Author: {hexToNpub(previewEvent.pubkey)}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 break-all">
                note: {hexToNote(previewEvent.id)}
              </div>
              {previewEvent.content && (
                <div className="text-sm text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800 max-h-40 overflow-auto whitespace-pre-wrap">
                  {previewEvent.content}
                </div>
              )}
              {mismatchAuthor && (
                <div className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                  <AlertTriangle size={16} />
                  Your pubkey does not match this event author. Relays will
                  reject deletion, so this reference is left out of the targets.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
            <ListChecks size={16} />
            Deletion targets ({nukeTargets.length})
          </div>
          {nukeTargets.length === 0 ? (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Tick notes in the feed above, or paste an event reference, to pick
              what gets nuked.
            </p>
          ) : (
            <ul className="mt-2 space-y-1 max-h-40 overflow-auto pr-1">
              {nukeTargets.map((target) => (
                <li
                  key={target.key}
                  className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300"
                >
                  <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 flex-shrink-0">
                    {target.label}
                  </span>
                  <span className="font-mono break-all">
                    {target.address || target.eventId}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {nukeTargets.length > BATCH_WARNING_THRESHOLD && (
            <p className="mt-2 text-xs text-orange-600 dark:text-orange-400 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              That is a large request. Some relays cap event size or tag counts
              — if relays reject it, nuke in smaller batches.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          <div>Total relays: {publishStats.total}</div>
          <div>Selected: {publishStats.selected}</div>
          <div>Success: {publishStats.success}</div>
          <div>Rejected: {publishStats.rejected}</div>
          <div>Errors: {publishStats.error + publishStats.timeout}</div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleSelectAll(true)}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => handleSelectAll(false)}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={resetRelayStatuses}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
          >
            Reset status
          </button>
          <button
            type="button"
            onClick={handleRetryFailed}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
          >
            Retry failed
          </button>
        </div>

        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              Relay targets
            </div>
            <div className="flex-1">
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter relays..."
                className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200"
              />
            </div>
          </div>

          <div className="max-h-72 overflow-auto space-y-2 pr-2">
            {visibleRelays.map((relay) => (
              <div
                key={relay.url}
                className="flex items-start gap-3 text-xs text-gray-700 dark:text-gray-200"
              >
                <input
                  type="checkbox"
                  checked={relay.selected}
                  onChange={(e) =>
                    updateRelay(relay.url, {
                      selected: e.target.checked,
                      status: e.target.checked ? "idle" : "ignored",
                    })
                  }
                  className="h-4 w-4"
                />
                <div className="flex-1 sm:flex sm:items-center sm:gap-3">
                  <div className="flex-1 break-all font-mono">{relay.url}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 sm:mt-0 sm:justify-end">
                    {relay.sources.map((source) => (
                      <span
                        key={`${relay.url}-${source}`}
                        className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-[10px] uppercase"
                      >
                        {sourceLabels[source] || source}
                      </span>
                    ))}
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusStyles[relay.status]}`}
                      title={relay.message || relay.status}
                    >
                      {relay.status}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleNuke}
            disabled={nukeTargets.length === 0 || isPublishing || !hasNip07()}
            className="px-5 py-3 rounded-lg bg-red-600 text-white font-semibold text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPublishing ? (
              <RefreshCw size={18} className="animate-spin" />
            ) : (
              <Radiation size={18} />
            )}
            Sign &amp; Nuke
            {nukeTargets.length > 1 ? ` (${nukeTargets.length})` : ""}
          </button>
          {lastPublishSummary && (
            <div className="text-sm text-gray-600 dark:text-gray-300">
              {lastPublishSummary}
            </div>
          )}
          {!hasNip07() && (
            <div className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
              <Shield size={16} />
              NIP-07 signer required.
            </div>
          )}
        </div>

        <div className="text-xs text-gray-500 dark:text-gray-400 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5" />
          Deletion requests are best-effort. Some relays are read-only, ignore
          deletes, or keep cached copies.
        </div>
      </div>
      <NoteNukeSuccessModal
        isOpen={showSuccessModal}
        onClose={() => setShowSuccessModal(false)}
        successCount={successSnapshot.success}
        totalCount={successSnapshot.total}
      />
    </div>
  );
}
