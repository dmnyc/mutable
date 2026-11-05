"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DEFAULT_RELAYS,
  KNOWN_RELAYS,
  fetchProfilesBulk,
  getNip07Pubkey,
  getNip07Relays,
  hasNip07,
  hexToNpub,
  normalizeRelayUrl,
  publishEventToRelay,
  signWithNip07,
} from "@/lib/nostr";
import {
  MAX_E_TAGS_PER_DELETION,
  buildDeletionGroups,
  buildDeletionTemplates,
  createNip04Decryptor,
  createNip44Decryptor,
  fetchDeletableDMs,
  groupNip04ByCounterparty,
  hasNip04DecryptSupport,
  hasNip44DecryptSupport,
  revealNip04Messages,
  unwrapGiftWraps,
  DeletableDMs,
  DMConversation,
  DeletionGroup,
  RevealedMessage,
} from "@/lib/burnAfterReading";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store";
import { Event } from "nostr-tools";
import Link from "next/link";
import { getDisplayName, truncateNpub } from "@/lib/utils/format";
import type { Profile } from "@/types";
import AppShell from "@/components/system/AppShell";
import PageHeader from "@/components/system/PageHeader";
import BurnAfterReadingSuccessModal from "@/components/BurnAfterReadingSuccessModal";
import UserProfileModal from "@/components/UserProfileModal";
import { copyToClipboard } from "@/lib/utils/clipboard";
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  Flame,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
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
  user: "user",
  nip65: "nip-65",
  nip07: "nip-07",
  default: "default",
  known: "known",
};

type ResultsTab = "standard" | "wraps";
type SortKey = "recent" | "name" | "count";

/** One row in the unified conversation list (standard DMs and gift wraps). */
interface ConversationEntry {
  key: string;
  type: "nip04" | "wrap";
  counterparty: string;
  count: number;
  lastAt: number;
  /** Set for gift-wrap rows: the kind:1059 event this row represents. */
  wrapId?: string;
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

export default function BurnAfterReading() {
  const { session } = useAuth();
  const { signer } = useStore();
  const [nip07Relays, setNip07Relays] = useState<string[]>([]);
  const [relayTargets, setRelayTargets] = useState<RelayTarget[]>([]);
  const [relayUrls, setRelayUrls] = useState<string[]>([]);
  const [filterText, setFilterText] = useState("");
  const [includeReason, setIncludeReason] = useState(true);
  const [isPublishing, setIsPublishing] = useState(false);
  const [lastPublishSummary, setLastPublishSummary] = useState<string | null>(
    null,
  );
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successSnapshot, setSuccessSnapshot] = useState({
    success: 0,
    total: 0,
  });

  // Scan state
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<DeletableDMs | null>(null);
  const [conversations, setConversations] = useState<DMConversation[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reveal state (decrypts content locally, on demand)
  const [expandedConvos, setExpandedConvos] = useState<Set<string>>(new Set());
  const [revealed, setRevealed] = useState<Record<string, RevealedMessage>>({});
  const [revealingKey, setRevealingKey] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [revealedWraps, setRevealedWraps] = useState<
    Record<string, RevealedMessage>
  >({});
  const [openWrapIds, setOpenWrapIds] = useState<Set<string>>(new Set());
  const [revealingWrapIds, setRevealingWrapIds] = useState<Set<string>>(
    new Set(),
  );
  const [unwrapProgress, setUnwrapProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  // Counterparty name resolution
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [resolvingNames, setResolvingNames] = useState(false);

  // List controls
  const [activeTab, setActiveTab] = useState<ResultsTab>("standard");
  const [sortBy, setSortBy] = useState<SortKey>("recent");
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [copiedNpub, setCopiedNpub] = useState<string | null>(null);

  // Post-burn refresh timer
  const rescanTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rescanTimerRef.current !== null) {
        window.clearTimeout(rescanTimerRef.current);
      }
    };
  }, []);

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
  }, [nip07Relays, session]);

  const allDMIds = useMemo(() => {
    if (!scanResult) return [];
    return [
      ...scanResult.nip04Sent.map((event) => event.id),
      ...scanResult.giftWraps.map((event) => event.id),
    ];
  }, [scanResult]);

  const canRevealNip04 = useMemo(
    () => hasNip04DecryptSupport(signer),
    [signer],
  );
  const canRevealWraps = useMemo(
    () => hasNip44DecryptSupport(signer),
    [signer],
  );

  // Gift wraps grouped by the rumor author once unwrapped.
  const unwrapFailureCount = Object.values(revealedWraps).filter(
    (message) => message.error,
  ).length;
  const revealedWrapCount = Object.keys(revealedWraps).length;

  const displayName = (pubkey: string) =>
    getDisplayName(profiles[pubkey], truncateNpub(pubkey));

  const listEntries = useMemo<ConversationEntry[]>(() => {
    const entries: ConversationEntry[] = conversations.map((conversation) => ({
      key: `nip04:${conversation.counterparty}`,
      type: "nip04" as const,
      counterparty: conversation.counterparty,
      count: conversation.events.length,
      lastAt: conversation.events[conversation.events.length - 1].created_at,
    }));
    scanResult?.giftWraps.forEach((wrap) => {
      entries.push({
        key: `wrap:${wrap.id}`,
        type: "wrap" as const,
        counterparty: revealedWraps[wrap.id]?.counterparty || "",
        count: 1,
        lastAt: revealedWraps[wrap.id]?.createdAt || wrap.created_at,
        wrapId: wrap.id,
      });
    });
    return entries;
  }, [scanResult, conversations, revealedWraps]);

  const visibleEntries = useMemo(() => {
    const tabType = activeTab === "standard" ? "nip04" : "wrap";
    const filtered = listEntries.filter((entry) => entry.type === tabType);
    const sorted = [...filtered];
    if (sortBy === "name") {
      sorted.sort((a, b) =>
        displayName(a.counterparty).localeCompare(
          displayName(b.counterparty),
          undefined,
          { sensitivity: "base" },
        ),
      );
    } else if (sortBy === "count") {
      sorted.sort((a, b) => b.count - a.count);
    } else {
      sorted.sort((a, b) => b.lastAt - a.lastAt);
    }
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listEntries, activeTab, sortBy, profiles]);

  const openProfile = (pubkey: string) =>
    setSelectedProfile(profiles[pubkey] || { pubkey });

  const handleCopyNpub = async (pubkey: string) => {
    const success = await copyToClipboard(hexToNpub(pubkey));
    if (success) {
      setCopiedNpub(pubkey);
      setTimeout(() => setCopiedNpub(null), 2000);
    }
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

  const handleScan = async () => {
    if (scanning) return;
    if (!hasNip07()) {
      alert("NIP-07 signer not available.");
      return;
    }

    setScanning(true);
    setScanError(null);
    setScanResult(null);
    setConversations([]);
    setSelectedIds(new Set());
    setExpandedConvos(new Set());
    setRevealed({});
    setRevealingKey(null);
    setRevealError(null);
    setRevealedWraps({});
    setOpenWrapIds(new Set());
    setUnwrapProgress(null);

    try {
      const pubkey = session?.pubkey || (await getNip07Pubkey());
      const result = await fetchDeletableDMs(
        pubkey,
        relayUrls,
        (phase, count) =>
          setScanStatus(count > 0 ? `${phase} (${count} found)` : phase),
      );
      setScanResult(result);
      setConversations(groupNip04ByCounterparty(result.nip04Sent));
      enrichProfiles(
        groupNip04ByCounterparty(result.nip04Sent)
          .map((conversation) => conversation.counterparty)
          .filter(Boolean),
      );
    } catch (error) {
      if (error instanceof Error && error.message === "Aborted") {
        // User cancelled — nothing to report
      } else {
        console.error("DM scan failed:", error);
        setScanError(
          error instanceof Error ? error.message : "Failed to scan for DMs.",
        );
      }
    } finally {
      setScanning(false);
      setScanStatus("");
    }
  };

  const toggleConversation = (conversation: DMConversation) => {
    const ids = conversation.events.map((event) => event.id);
    const allSelected = ids.every((id) => selectedIds.has(id));
    setSelectedIds((previous) => {
      const next = new Set(previous);
      ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const toggleWrapOne = (id: string) =>
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const handleRevealWrap = async (wrap: Event) => {
    if (revealedWraps[wrap.id]) {
      // Already unwrapped — toggle the inline content display.
      setOpenWrapIds((previous) => {
        const next = new Set(previous);
        if (next.has(wrap.id)) {
          next.delete(wrap.id);
        } else {
          next.add(wrap.id);
        }
        return next;
      });
      return;
    }

    setRevealingWrapIds((previous) => new Set(previous).add(wrap.id));
    try {
      const [message] = await unwrapGiftWraps(
        [wrap],
        createNip44Decryptor(signer),
      );
      setRevealedWraps((previous) => ({
        ...previous,
        [wrap.id]: message,
      }));
      if (!message.error && message.counterparty) {
        enrichProfiles([message.counterparty]);
      }
      setOpenWrapIds((previous) => new Set(previous).add(wrap.id));
    } catch (error) {
      setRevealError(
        error instanceof Error ? error.message : "Couldn't unwrap gift wrap.",
      );
    } finally {
      setRevealingWrapIds((previous) => {
        const next = new Set(previous);
        next.delete(wrap.id);
        return next;
      });
    }
  };

  const handleRevealAllWraps = async () => {
    if (!scanResult) return;
    const wraps = scanResult.giftWraps;
    const missing = wraps.filter((wrap) => !revealedWraps[wrap.id]);
    if (missing.length === 0) {
      setOpenWrapIds(new Set(wraps.map((wrap) => wrap.id)));
      return;
    }
    setUnwrapProgress({ done: 0, total: missing.length });
    try {
      const results = await unwrapGiftWraps(
        missing,
        createNip44Decryptor(signer),
        (done, total) => setUnwrapProgress({ done, total }),
      );
      setRevealedWraps((previous) => {
        const next = { ...previous };
        results.forEach((message) => {
          next[message.eventId] = message;
        });
        return next;
      });
      enrichProfiles(
        results
          .filter((message) => !message.error && message.counterparty)
          .map((message) => message.counterparty),
      );
      setOpenWrapIds(new Set(wraps.map((wrap) => wrap.id)));
    } catch (error) {
      setRevealError(
        error instanceof Error ? error.message : "Couldn't unwrap gift wraps.",
      );
    } finally {
      setUnwrapProgress(null);
    }
  };

  const handleHideAllWraps = () => setOpenWrapIds(new Set());

  const handleToggleConversation = async (conversation: DMConversation) => {
    const key = conversation.counterparty;
    const isExpanded = expandedConvos.has(key);
    setExpandedConvos((previous) => {
      const next = new Set(previous);
      if (isExpanded) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    if (isExpanded) return;

    const missing = conversation.events.filter((event) => !revealed[event.id]);
    if (missing.length === 0) return;

    setRevealingKey(key);
    setRevealError(null);
    try {
      const messages = await revealNip04Messages(
        missing,
        key,
        createNip04Decryptor(signer),
      );
      setRevealed((previous) => {
        const next = { ...previous };
        messages.forEach((message) => {
          next[message.eventId] = message;
        });
        return next;
      });
    } catch (error) {
      setRevealError(
        error instanceof Error ? error.message : "Decryption failed.",
      );
    } finally {
      setRevealingKey(null);
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

  const handleSelectAllDMs = () => setSelectedIds(new Set(allDMIds));

  const handleClearDMs = () => setSelectedIds(new Set());

  const enrichProfiles = async (pubkeys: string[]) => {
    const missing = [
      ...new Set(
        pubkeys.filter(
          (pk) => pk && /^[0-9a-f]{64}$/i.test(pk) && !profiles[pk],
        ),
      ),
    ];
    if (missing.length === 0) return;
    setResolvingNames(true);
    try {
      const map = await fetchProfilesBulk(missing, relayUrls);
      if (map.size > 0) {
        setProfiles((previous) => {
          const next = { ...previous };
          map.forEach((profile, pubkey) => {
            next[pubkey] = profile;
          });
          return next;
        });
      }
    } catch (error) {
      // Names are a nicety — npub fallbacks stay in place.
      console.error("Profile enrichment failed:", error);
    } finally {
      setResolvingNames(false);
    }
  };

  const handleRetryFailed = async () => {
    if (isPublishing) return;
    const retryTargets = relayTargets.filter((relay) =>
      ["error", "timeout", "rejected"].includes(relay.status),
    );
    if (retryTargets.length === 0) return;
    await publishDeletions(
      scanResult
        ? buildDeletionGroups(scanResult, selectedIds)
        : [],
      retryTargets,
    );
  };

  const publishDeletions = async (
    groups: DeletionGroup[],
    targets: RelayTarget[],
  ) => {
    const ids = groups.reduce((total, group) => total + group.ids.length, 0);
    if (ids === 0 || groups.length === 0) return;

    setIsPublishing(true);
    setLastPublishSummary(null);

    const templates = buildDeletionTemplates(
      groups,
      includeReason ? "Deleted by Mutable" : "",
      Math.floor(Date.now() / 1000),
    );

    // Sign every batch up front so a half-published run can't be mistaken
    // for a signer failure halfway through.
    const signedEvents: Event[] = [];
    try {
      for (const template of templates) {
        signedEvents.push(await signWithNip07(template));
      }
    } catch (error) {
      setIsPublishing(false);
      alert(
        "Failed to sign deletion event. Make sure your NIP-07 extension is unlocked.",
      );
      return;
    }

    const queue = [...targets];
    const concurrency = 8;
    let successCount = 0;
    const runNext = async (): Promise<void> => {
      const relay = queue.shift();
      if (!relay) return;
      updateRelay(relay.url, { status: "publishing", message: undefined });

      let succeeded = 0;
      let status: RelayStatus = "success";
      let message: string | undefined;
      for (const event of signedEvents) {
        const result = await publishEventToRelay(relay.url, event);
        if (result.status === "success") {
          succeeded += 1;
        } else {
          status = result.status;
          message = result.message;
          break;
        }
      }
      if (succeeded > 0 && succeeded < signedEvents.length) {
        message = `${succeeded}/${signedEvents.length} deletion batches accepted. ${message || ""}`;
      }
      if (succeeded === signedEvents.length) successCount += 1;
      updateRelay(relay.url, {
        status: succeeded === signedEvents.length ? "success" : status,
        message,
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
      `Published ${signedEvents.length} deletion event${signedEvents.length === 1 ? "" : "s"} covering ${ids} DM envelope${ids === 1 ? "" : "s"} to ${targets.length} relays.`,
    );
    setSuccessSnapshot({
      success: successCount,
      total: targets.length,
    });
    setShowSuccessModal(true);

    // Reload the list so burned envelopes drop out. Relays apply removals at
    // different speeds; give them a beat before rescanning.
    if (successCount > 0) {
      setSelectedIds(new Set());
      if (rescanTimerRef.current !== null) {
        window.clearTimeout(rescanTimerRef.current);
      }
      rescanTimerRef.current = window.setTimeout(() => {
        rescanTimerRef.current = null;
        void handleScan();
      }, 2500);
    }
  };

  const handleBurn = async () => {
    if (!hasNip07()) {
      alert("NIP-07 signer not available.");
      return;
    }
    if (selectedRelays.length === 0) {
      alert("Select at least one relay.");
      return;
    }

    const groups = scanResult
      ? buildDeletionGroups(scanResult, selectedIds)
      : [];
    const ids = groups.reduce((total, group) => total + group.ids.length, 0);
    if (ids === 0) {
      alert("Select at least one DM to burn.");
      return;
    }
    const batchCount = Math.ceil(
      groups.reduce(
        (total, group) => total + Math.ceil(group.ids.length / MAX_E_TAGS_PER_DELETION),
        0,
      ),
    );
    const confirmMessage =
      `BURN AFTER READING\n\n` +
      `This will publish ${batchCount} deletion event${batchCount === 1 ? "" : "s"} covering ${ids} DM envelope${ids === 1 ? "" : "s"} to ${selectedRelays.length} relays.\n\n` +
      `Deletion requests are best-effort: relays that honor them drop the events, but copies may survive elsewhere.\n\n` +
      `Proceed?`;
    if (!confirm(confirmMessage)) return;

    resetRelayStatuses();
    const targets = selectedRelays.map((relay) => ({ ...relay }));
    await publishDeletions(groups, targets);
  };

  const hasResults =
    scanResult &&
    (scanResult.nip04Sent.length > 0 || scanResult.giftWraps.length > 0);

  return (
    <AppShell navActive="burnAfterReading" width="tool">
      <div className="space-y-6">
        <PageHeader
          icon={<Flame size={25} />}
          iconBg="from-orange-500 to-red-700"
          title="Burn After Reading"
          subtitle="NIP-04 DM metadata is public. Burn your DM envelopes: the messages you sent, plus every NIP-17 gift wrap addressed to you."
        />

        {/* What can and can't be deleted */}
        <div className="panel relative rounded-xl border border-line shadow-panel p-6 space-y-4">
          <p className="text-sm text-mut">
            It&apos;s the public footprint{" "}
            <Link
              href="/snoopable"
              className="font-semibold text-hi hover:underline"
            >
              Snoopable
            </Link>{" "}
            reveals, plus the NIP-17 wraps sitting in your own inbox.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-green-800 dark:text-green-300 mb-2">
                <Flame size={16} />
                We can burn
              </div>
              <ul className="text-xs text-gray-700 dark:text-gray-300 space-y-1.5 list-disc pl-4">
                <li>
                  <strong>NIP-04 DMs you sent</strong> — one shared event, so
                  the recipient&apos;s relay copy goes too.
                </li>
                <li>
                  <strong>NIP-17 gift wraps addressed to you</strong> —
                  incoming DMs and your copies of sent ones.
                </li>
              </ul>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                <Lock size={16} />
                Out of reach
              </div>
              <ul className="text-xs text-gray-700 dark:text-gray-300 space-y-1.5 list-disc pl-4">
                <li>
                  <strong>NIP-04 DMs you received</strong> — signed by the
                  sender.
                </li>
                <li>
                  <strong>Your contacts&apos; NIP-17 wraps</strong> — signed by
                  throwaway keys.
                </li>
                <li>
                  <strong>Client caches</strong> — already-saved copies survive
                  any deletion.
                </li>
              </ul>
            </div>
          </div>
          <p className="text-xs text-mut flex items-start gap-2">
            <ShieldAlert size={14} className="mt-0.5 flex-none" />
            Decryption runs in your browser, only when you open a conversation.
            Deletion requests are best-effort: some relays ignore them or keep
            cached copies.
          </p>
        </div>

        {/* Scan */}
        <div className="panel relative rounded-xl border border-line shadow-panel p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              type="button"
              onClick={handleScan}
              disabled={scanning || !hasNip07()}
              className="flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-orange-600 text-white font-semibold text-sm hover:bg-orange-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {scanning ? (
                <RefreshCw size={18} className="animate-spin" />
              ) : (
                <Search size={18} />
              )}
              {scanResult ? "Rescan my DMs" : "Scan my DMs"}
            </button>
            {scanning && (
              <span className="text-sm text-mut">{scanStatus}</span>
            )}
            {!hasNip07() && (
              <span className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                <ShieldAlert size={16} />
                NIP-07 signer required.
              </span>
            )}
          </div>
          {scanError && (
            <div className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
              <AlertTriangle size={16} />
              {scanError}
            </div>
          )}
          {scanResult && !hasResults && (
            <p className="text-sm text-mut">
              No deletable DM envelopes found on the scanned relays.
            </p>
          )}
        </div>

        {/* Results */}
        {scanResult && hasResults && (
          <div className="panel relative rounded-xl border border-line shadow-panel p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                {scanResult.nip04Sent.length} sent NIP-04 DM
                {scanResult.nip04Sent.length === 1 ? "" : "s"} across{" "}
                {conversations.length} conversation
                {conversations.length === 1 ? "" : "s"}
                {scanResult.giftWraps.length > 0 &&
                  `, ${scanResult.giftWraps.length} NIP-17 gift wrap${scanResult.giftWraps.length === 1 ? "" : "s"}`}
              </div>
              <div className="flex items-center gap-2">
                {resolvingNames && (
                  <span className="text-xs text-mut flex items-center gap-1">
                    <RefreshCw size={11} className="animate-spin" />
                    Resolving names…
                  </span>
                )}
                <span className="text-xs text-mut">
                  {selectedIds.size} of {allDMIds.length} selected
                </span>
                <button
                  type="button"
                  onClick={handleSelectAllDMs}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={handleClearDMs}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="border border-line rounded-lg">
              {/* Sticky toolbar: stays visible while the list or page scrolls */}
              <div className="sticky top-16 z-30 bg-[rgb(var(--panel-a))] border-b border-line rounded-t-lg px-4 py-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("standard")}
                  className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
                    activeTab === "standard"
                      ? "border-orange-600 text-orange-600 dark:border-orange-500 dark:text-orange-500"
                      : "border-transparent text-mut hover:text-hi"
                  }`}
                >
                  NIP-04 DMs ({conversations.length})
                </button>
                {scanResult.giftWraps.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("wraps")}
                    className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
                      activeTab === "wraps"
                        ? "border-orange-600 text-orange-600 dark:border-orange-500 dark:text-orange-500"
                        : "border-transparent text-mut hover:text-hi"
                    }`}
                  >
                    Gift wraps ({scanResult.giftWraps.length})
                  </button>
                )}
                {activeTab === "wraps" && (
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRevealAllWraps}
                      disabled={!canRevealWraps || unwrapProgress !== null}
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-[11px] font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={
                        canRevealWraps
                          ? "Unwrap every gift wrap locally"
                          : "Your signer doesn't support NIP-44 decryption"
                      }
                    >
                      <Eye size={12} />
                      Reveal all
                    </button>
                    {openWrapIds.size > 0 && (
                      <button
                        type="button"
                        onClick={handleHideAllWraps}
                        className="flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-[11px] font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                      >
                        <EyeOff size={12} />
                        Hide all
                      </button>
                    )}
                  </div>
                )}
                <div
                  className={`flex items-center gap-2 ${
                    activeTab === "standard" ? "ml-auto" : ""
                  }`}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-mut">
                    Sort
                  </span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortKey)}
                    className="px-2 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200"
                  >
                    <option value="recent">Recent activity</option>
                    <option value="name">Name</option>
                    <option value="count">DM count</option>
                  </select>
                </div>
              </div>

              <div className="max-h-96 overflow-auto p-4 space-y-3">
                {revealError && (
                  <div className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
                    <AlertTriangle size={13} />
                    {revealError}
                  </div>
                )}

              {/* Unwrap status bar */}
              {activeTab === "wraps" && revealedWrapCount > 0 && (
                <div className="text-[11px] text-mut flex items-center gap-1.5">
                  {unwrapProgress ? (
                    <>
                      <RefreshCw size={11} className="animate-spin" />
                      Unwrapping {unwrapProgress.done} of{" "}
                      {unwrapProgress.total}…
                    </>
                  ) : (
                    <span>
                      {revealedWrapCount - unwrapFailureCount} of{" "}
                      {scanResult.giftWraps.length} wraps unwrapped
                      {unwrapFailureCount > 0 &&
                        ` · ${unwrapFailureCount} unreadable`}
                    </span>
                  )}
                </div>
              )}

              {/* Unified conversation list */}
              {visibleEntries.map((entry) => {
                if (entry.type === "nip04") {
                  const conversation = conversations.find(
                    (c) => c.counterparty === entry.counterparty,
                  );
                  if (!conversation) return null;
                  const ids = conversation.events.map((event) => event.id);
                  const allSelected = ids.every((id) => selectedIds.has(id));
                  const last =
                    conversation.events[conversation.events.length - 1];
                  const isExpanded = expandedConvos.has(conversation.counterparty);
                  return (
                    <div
                      key={entry.key}
                      className="border-b border-line pb-3 last:border-b-0 last:pb-0"
                    >
                      <div className="flex items-start gap-3 text-xs text-gray-700 dark:text-gray-200">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={() => toggleConversation(conversation)}
                          className="h-4 w-4 mt-0.5"
                        />
                        <div className="flex-1 flex flex-wrap items-center gap-2 min-w-0">
                          {conversation.counterparty ? (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  openProfile(conversation.counterparty)
                                }
                                className="font-semibold break-all hover:underline text-left"
                                title="View profile — mute or check mute status"
                              >
                                {displayName(conversation.counterparty)}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  openProfile(conversation.counterparty)
                                }
                                className="font-mono text-mut break-all hover:underline text-left"
                                title={hexToNpub(conversation.counterparty)}
                              >
                                {truncateNpub(conversation.counterparty)}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopyNpub(conversation.counterparty)
                                }
                                className="text-mut hover:text-hi transition-colors flex-none"
                                title="Copy npub"
                              >
                                {copiedNpub ===
                                conversation.counterparty ? (
                                  <Check
                                    size={12}
                                    className="text-green-600"
                                  />
                                ) : (
                                  <Copy size={12} />
                                )}
                              </button>
                            </>
                          ) : (
                            <span className="font-mono break-all">
                              Unknown recipient (missing p tag)
                            </span>
                          )}
                          <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-[10px] font-semibold">
                            {conversation.events.length} DM
                            {conversation.events.length === 1 ? "" : "s"}
                          </span>
                          <span className="text-mut">
                            last {formatTimestamp(last.created_at)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleToggleConversation(conversation)}
                          disabled={!canRevealNip04 || revealingKey !== null}
                          className="flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-[11px] font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-none"
                          title={
                            canRevealNip04
                              ? "Decrypt these messages locally"
                              : "Your signer doesn't support NIP-04 decryption"
                          }
                        >
                          {isExpanded ? (
                            <EyeOff size={12} />
                          ) : (
                            <Eye size={12} />
                          )}
                          {isExpanded ? "Hide" : "Reveal"}
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="mt-2 ml-7 space-y-1.5">
                          {revealingKey === conversation.counterparty && (
                            <div className="text-mut text-[11px] flex items-center gap-1.5">
                              <RefreshCw size={11} className="animate-spin" />
                              Decrypting locally…
                            </div>
                          )}
                          {[...conversation.events]
                            .reverse()
                            .map((event) => {
                              const message = revealed[event.id];
                              return (
                                <div
                                  key={event.id}
                                  className="rounded-md border border-line bg-gray-50 dark:bg-gray-900/60 px-2.5 py-1.5"
                                >
                                  <div className="text-[10px] text-mut mb-0.5">
                                    {formatTimestamp(event.created_at)}
                                  </div>
                                  {!message ? (
                                    <div className="text-mut text-[11px]">
                                      Content hidden — Reveal to decrypt.
                                    </div>
                                  ) : message.error ? (
                                    <div className="text-red-600 dark:text-red-400 text-[11px]">
                                      {message.error}
                                    </div>
                                  ) : (
                                    <div className="text-[11px] text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
                                      {message.content || "(empty message)"}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  );
                }

                const wrap = scanResult.giftWraps.find(
                  (w) => w.id === entry.wrapId,
                );
                if (!wrap) return null;
                const message = revealedWraps[wrap.id];
                const isOpen = openWrapIds.has(wrap.id);
                const isRevealing = revealingWrapIds.has(wrap.id);
                return (
                  <div
                    key={entry.key}
                    className="border-b border-line pb-3 last:border-b-0 last:pb-0"
                  >
                    <div className="flex items-start gap-3 text-xs text-gray-700 dark:text-gray-200">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(wrap.id)}
                        onChange={() => toggleWrapOne(wrap.id)}
                        className="h-4 w-4 mt-0.5"
                      />
                      <div className="flex-1 flex flex-wrap items-center gap-2 min-w-0">
                        {message && !message.error && message.counterparty ? (
                          <>
                            <button
                              type="button"
                              onClick={() => openProfile(message.counterparty)}
                              className="font-semibold break-all hover:underline text-left"
                              title="View profile — mute or check mute status"
                            >
                              {displayName(message.counterparty)}
                            </button>
                            <button
                              type="button"
                              onClick={() => openProfile(message.counterparty)}
                              className="font-mono text-mut break-all hover:underline text-left"
                              title={hexToNpub(message.counterparty)}
                            >
                              {truncateNpub(message.counterparty)}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleCopyNpub(message.counterparty)
                              }
                              className="text-mut hover:text-hi transition-colors flex-none"
                              title="Copy npub"
                            >
                              {copiedNpub === message.counterparty ? (
                                <Check size={12} className="text-green-600" />
                              ) : (
                                <Copy size={12} />
                              )}
                            </button>
                          </>
                        ) : (
                          <span className="font-mono text-mut break-all">
                            {message?.error
                              ? "Unreadable gift wrap"
                              : "Gift wrap — content encrypted"}
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-[10px] font-semibold">
                          wrap
                        </span>
                        <span className="text-mut">
                          {formatTimestamp(
                            message?.createdAt || wrap.created_at,
                          )}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRevealWrap(wrap)}
                        disabled={
                          !canRevealWraps ||
                          unwrapProgress !== null ||
                          (isRevealing && !message)
                        }
                        className="flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-[11px] font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-none"
                        title={
                          canRevealWraps
                            ? message
                              ? isOpen
                                ? "Hide this message"
                                : "Show this message"
                              : "Decrypt this gift wrap locally"
                            : "Your signer doesn't support NIP-44 decryption"
                        }
                      >
                        {isRevealing && !message ? (
                          <RefreshCw size={12} className="animate-spin" />
                        ) : isOpen && message ? (
                          <EyeOff size={12} />
                        ) : (
                          <Eye size={12} />
                        )}
                        {isRevealing && !message
                          ? "…"
                          : isOpen && message
                            ? "Hide"
                            : "Reveal"}
                      </button>
                    </div>

                    {isOpen && message && (
                      <div className="mt-2 ml-7">
                        <div className="rounded-md border border-line bg-gray-50 dark:bg-gray-900/60 px-2.5 py-1.5">
                          {message.error ? (
                            <div className="text-red-600 dark:text-red-400 text-[11px]">
                              {message.error}
                            </div>
                          ) : (
                            <div className="text-[11px] text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
                              {message.content || "(empty message)"}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {activeTab === "standard" && conversations.length === 0 && (
                <div className="text-xs text-mut py-2">
                  No standard NIP-04 DMs found on the scanned relays.
                </div>
              )}

              {activeTab === "wraps" &&
                scanResult.giftWraps.length === 0 && (
                  <div className="text-xs text-mut py-2">
                    No gift wraps found on the scanned relays.
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-start gap-2 text-xs text-mut cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeReason}
                  onChange={(e) => setIncludeReason(e.target.checked)}
                  className="h-4 w-4 mt-0.5"
                />
                <span>
                  Label every deletion event with{" "}
                  <span className="font-mono">Deleted by Mutable</span> so
                  clients can show why the content disappeared. Uncheck to
                  send deletions without a reason.
                </span>
              </label>
            </div>
          </div>
        )}

        {/* Relay targets */}
        <div className="panel relative rounded-xl border border-line shadow-panel p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              Relay targets
            </div>
            <div className="flex-1 min-w-[180px]">
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter relays..."
                className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200"
              />
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

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={handleBurn}
              disabled={isPublishing || selectedIds.size === 0 || !hasNip07()}
              className="px-5 py-3 rounded-lg bg-red-600 text-white font-semibold text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPublishing ? (
                <RefreshCw size={18} className="animate-spin" />
              ) : (
                <Flame size={18} />
              )}
              Sign &amp; Burn
            </button>
            {lastPublishSummary && (
              <div className="text-sm text-mut">{lastPublishSummary}</div>
            )}
          </div>

          <p className="text-xs text-mut flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 flex-none" />
            Deletion requests are best-effort. Some relays are read-only, ignore
            deletes, or keep cached copies.
          </p>
        </div>

        {/* Floating burn bar — always reachable while scrolling.
            Portal to body: AppShell's animate-rise traps fixed descendants. */}
        {scanResult &&
          selectedIds.size > 0 &&
          createPortal(
            <div className="fixed bottom-4 inset-x-0 z-40 flex justify-center px-4 pointer-events-none">
              <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-full border border-line shadow-panel bg-[rgb(var(--panel-a))] px-4 py-2.5">
                <span className="text-xs font-semibold text-hi">
                  {selectedIds.size} DM envelope
                  {selectedIds.size === 1 ? "" : "s"} selected
                </span>
                <span className="text-xs text-mut">
                  → {selectedRelays.length} relay
                  {selectedRelays.length === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  onClick={handleBurn}
                  disabled={isPublishing || !hasNip07()}
                  className="px-4 py-2 rounded-full bg-red-600 text-white font-semibold text-xs flex items-center gap-1.5 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPublishing ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <Flame size={14} />
                  )}
                  Sign &amp; Burn
                </button>
              </div>
            </div>,
            document.body,
          )}

        <BurnAfterReadingSuccessModal
          isOpen={showSuccessModal}
          onClose={() => setShowSuccessModal(false)}
          successCount={successSnapshot.success}
          totalCount={successSnapshot.total}
        />

        {selectedProfile && (
          <UserProfileModal
            profile={selectedProfile}
            onClose={() => setSelectedProfile(null)}
          />
        )}
      </div>
    </AppShell>
  );
}
