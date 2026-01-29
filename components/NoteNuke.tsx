"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_RELAYS,
  KNOWN_RELAYS,
  fetchEventByAddress,
  fetchEventById,
  getNip07Relays,
  hasNip07,
  hexToNote,
  hexToNpub,
  normalizeRelayUrl,
  parseEventTarget,
  publishEventToRelay,
  signWithNip07,
} from "@/lib/nostr";
import { useAuth } from "@/hooks/useAuth";
import { Event, EventTemplate, nip19 } from "nostr-tools";
import NoteNukeSuccessModal from "@/components/NoteNukeSuccessModal";
import {
  AlertTriangle,
  Radiation,
  Clipboard,
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

  const visibleRelays = useMemo(() => {
    const lowerFilter = filterText.trim().toLowerCase();
    if (!lowerFilter) return relayTargets;
    return relayTargets.filter((relay) => relay.url.includes(lowerFilter));
  }, [relayTargets, filterText]);

  const selectedRelays = useMemo(
    () => relayTargets.filter((relay) => relay.selected),
    [relayTargets],
  );

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
    const retryTargets = relayTargets.filter((relay) =>
      ["error", "timeout", "rejected"].includes(relay.status),
    );
    if (retryTargets.length === 0) return;
    await publishDeletion(retryTargets);
  };

  const publishDeletion = async (targets: RelayTarget[]) => {
    if (!eventId && !eventAddress) return;

    setIsPublishing(true);
    setLastPublishSummary(null);

    const tags: string[][] = [];
    if (eventId) tags.push(["e", eventId]);
    if (eventAddress) tags.push(["a", eventAddress]);

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

    const queue = [...targets];
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
      `Published deletion to ${targets.length} relays. See relay statuses below.`,
    );
    setSuccessSnapshot({
      success: successCount,
      total: targets.length,
    });
    setShowSuccessModal(true);
  };

  const handleNuke = async () => {
    if (!eventId && !eventAddress) return;
    if (!hasNip07()) {
      alert("NIP-07 signer not available.");
      return;
    }
    if (selectedRelays.length === 0) {
      alert("Select at least one relay.");
      return;
    }

    if (
      previewEvent &&
      session?.pubkey &&
      previewEvent.pubkey !== session.pubkey
    ) {
      alert(
        "This event was authored by a different pubkey. Relays will reject deletion.",
      );
      return;
    }

    const confirmMessage =
      `NOTE NUKE\n\n` +
      `This will publish a deletion event to ${selectedRelays.length} relays.\n` +
      `Event: ${eventId || eventAddress}\n\n` +
      `Proceed?`;
    if (!confirm(confirmMessage)) return;

    resetRelayStatuses();
    const targets = selectedRelays.map((relay) => ({ ...relay }));
    await publishDeletion(targets);
  };

  const mismatchAuthor =
    previewEvent && session?.pubkey && previewEvent.pubkey !== session.pubkey;

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
              Delete a Nostr event by publishing a kind 5 deletion to every
              relay we can reach. This uses your NIP-65 relay list, NIP-07
              relays, Mutable defaults, plus a wide catalog of known public
              relays for maximum coverage.
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

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 shadow-sm space-y-5">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Event reference
          </label>
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
                  reject deletion.
                </div>
              )}
            </div>
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
            disabled={
              (!eventId && !eventAddress) ||
              isPublishing ||
              mismatchAuthor ||
              !hasNip07()
            }
            className="px-5 py-3 rounded-lg bg-red-600 text-white font-semibold text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPublishing ? (
              <RefreshCw size={18} className="animate-spin" />
            ) : (
              <Radiation size={18} />
            )}
            Sign &amp; Nuke
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
