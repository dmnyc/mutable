"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Inbox, RefreshCw } from "lucide-react";
import { DMActivityDay, DMMessageMeta, Profile } from "@/types";
import DMMessageRow from "./DMMessageRow";
import { hexToNpub } from "@/lib/nostr";
import { getDisplayName } from "@/lib/utils/format";

const PAGE_SIZE = 100;
const THREADS_PAGE_SIZE = 20;

interface Thread {
  counterparty: string;
  messages: DMMessageMeta[]; // oldest → newest
  sent: number;
  received: number;
  lastCreatedAt: number;
}

/**
 * Doxxed Inbox — every DM envelope from the scan, either as one
 * chronological list (newest first) or collapsed into per-counterparty
 * threads. Only the message contents are hidden; everything here is public
 * NIP-04 envelope metadata.
 */
export default function DMInbox({
  data,
  profilesByPubkey,
  onSelectPubkey,
  onRequestProfiles,
  deepFetching,
  onDeepFetchThread,
}: {
  data: DMActivityDay[];
  profilesByPubkey?: Map<string, Profile>;
  onSelectPubkey?: (pubkey: string) => void;
  /** Called with counterparties missing from profilesByPubkey so the parent
      can fetch their names lazily (same contract as DMHeatmap). */
  onRequestProfiles?: (pubkeys: string[]) => void;
  /** Counterparties whose full conversation is currently being deep-fetched. */
  deepFetching?: string[];
  /** Called (once per thread) when a collapsed thread is expanded, so the
      parent can backfill this conversation's older events. */
  onDeepFetchThread?: (counterparty: string) => void;
}) {
  const [viewMode, setViewMode] = useState<"threads" | "chronological">(
    "threads",
  );
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [threadCount, setThreadCount] = useState(THREADS_PAGE_SIZE);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(
    new Set(),
  );

  const messages = useMemo(
    () =>
      data
        .flatMap((day) => day.messages ?? [])
        .sort(
          (a, b) =>
            b.createdAt - a.createdAt ||
            a.eventId.localeCompare(b.eventId),
        ),
    [data],
  );

  const totalDMs = useMemo(
    () => data.reduce((sum, day) => sum + day.count, 0),
    [data],
  );

  // One thread per counterparty, messages oldest → newest; threads ranked by
  // their most recent message.
  const threads = useMemo(() => {
    const map = new Map<string, Thread>();
    for (const msg of [...messages].reverse()) {
      const key = msg.counterparty || "unknown";
      const thread = map.get(key) || {
        counterparty: key,
        messages: [],
        sent: 0,
        received: 0,
        lastCreatedAt: 0,
      };
      thread.messages.push(msg);
      if (msg.direction === "sent") thread.sent++;
      else thread.received++;
      thread.lastCreatedAt = Math.max(thread.lastCreatedAt, msg.createdAt);
      map.set(key, thread);
    }
    return Array.from(map.values()).sort(
      (a, b) => b.lastCreatedAt - a.lastCreatedAt,
    );
  }, [messages]);

  const maxContentLength = useMemo(
    () => messages.reduce((max, m) => Math.max(max, m.contentLength), 0),
    [messages],
  );

  // Per-day sent/received split for the chronological dividers.
  const dayStats = useMemo(() => {
    const map = new Map<string, { sent: number; received: number }>();
    for (const msg of messages) {
      const date = new Date(msg.createdAt * 1000).toISOString().split("T")[0];
      const entry = map.get(date) || { sent: 0, received: 0 };
      if (msg.direction === "sent") entry.sent++;
      else entry.received++;
      map.set(date, entry);
    }
    return map;
  }, [messages]);

  // Ask the parent to fetch profiles for counterparties missing from the
  // map, so rows show names instead of bare npubs. Only the visible scope
  // is requested, once per new key.
  const missingCounterparties = useMemo(() => {
    const scope =
      viewMode === "threads"
        ? threads
            .slice(0, threadCount)
            .flatMap((t) => t.messages)
            .concat(
              expandedThreads.size > 0
                ? threads
                    .slice(0, threadCount)
                    .filter((t) => expandedThreads.has(t.counterparty))
                    .flatMap((t) => t.messages)
                : [],
            )
        : messages.slice(0, visibleCount);
    const seen = new Set<string>();
    const missing: string[] = [];
    for (const msg of scope) {
      const pk = msg.counterparty;
      if (!pk || seen.has(pk) || profilesByPubkey?.has(pk)) continue;
      seen.add(pk);
      missing.push(pk);
    }
    return missing;
  }, [viewMode, threads, threadCount, expandedThreads, messages, visibleCount, profilesByPubkey]);

  useEffect(() => {
    if (missingCounterparties.length > 0 && onRequestProfiles) {
      onRequestProfiles(missingCounterparties);
    }
  }, [missingCounterparties, onRequestProfiles]);

  const formatDate = (dateStr: string) =>
    new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const toggleThread = (counterparty: string) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(counterparty)) next.delete(counterparty);
      else next.add(counterparty);
      return next;
    });
    // The global scan caps events per direction, so a thread can be missing
    // its outbound side. Expanding is the moment to backfill it.
    if (
      counterparty !== "unknown" &&
      !expandedThreads.has(counterparty) &&
      onDeepFetchThread
    ) {
      onDeepFetchThread(counterparty);
    }
  };

  const switchMode = (mode: "threads" | "chronological") => {
    setViewMode(mode);
    setVisibleCount(PAGE_SIZE);
    setThreadCount(THREADS_PAGE_SIZE);
  };

  const renderRow = (msg: DMMessageMeta) => (
    <DMMessageRow
      key={msg.eventId}
      msg={msg}
      profile={
        msg.counterparty ? profilesByPubkey?.get(msg.counterparty) : undefined
      }
      maxContentLength={maxContentLength}
      onSelectPubkey={onSelectPubkey}
    />
  );

  if (messages.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        <Inbox size={40} className="mx-auto mb-3 opacity-50" />
        {totalDMs > 0 ? (
          <p className="text-sm max-w-md mx-auto">
            This scan didn&apos;t capture individual messages for its{" "}
            {totalDMs} DM{totalDMs === 1 ? "" : "s"} — re-run the analysis to
            build the inbox.
          </p>
        ) : (
          <p>No DM activity found</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {messages.length} message{messages.length === 1 ? "" : "s"} across{" "}
          {threads.length} conversation{threads.length === 1 ? "" : "s"} —
          everything shown is public envelope metadata; contents stay
          encrypted.
        </p>
        <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-700/50 rounded-md p-0.5">
          {(
            [
              ["threads", "Threads"],
              ["chronological", "Chronological"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => switchMode(mode)}
              className={`px-2.5 py-1 text-xs font-semibold rounded whitespace-nowrap transition-colors ${
                viewMode === mode
                  ? "bg-white dark:bg-gray-800 text-purple-600 dark:text-purple-300 shadow-sm"
                  : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {viewMode === "threads" ? (
        <>
          <div className="space-y-1.5">
            {threads.slice(0, threadCount).map((thread) => {
              const open = expandedThreads.has(thread.counterparty);
              const profile = profilesByPubkey?.get(thread.counterparty);
              const name =
                thread.counterparty !== "unknown"
                  ? profile
                    ? getDisplayName(profile)
                    : `${hexToNpub(thread.counterparty).slice(0, 14)}…`
                  : "unknown";
              return (
                <div
                  key={thread.counterparty}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() => toggleThread(thread.counterparty)}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-xs bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <ChevronDown
                      size={14}
                      className={`text-gray-400 flex-shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
                    />
                    <span className="font-semibold text-gray-900 dark:text-white truncate">
                      {name}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400 flex-shrink-0">
                      {thread.messages.length} message
                      {thread.messages.length === 1 ? "" : "s"} · ↑{" "}
                      {thread.sent} · ↓ {thread.received}
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-gray-400 dark:text-gray-500 tabular-nums flex-shrink-0">
                      {formatDate(
                        new Date(thread.lastCreatedAt * 1000)
                          .toISOString()
                          .split("T")[0],
                      )}
                    </span>
                  </button>
                  {open && (
                    <div className="space-y-1.5 p-2 pt-1.5 border-t border-gray-100 dark:border-gray-700">
                      {deepFetching?.includes(thread.counterparty) && (
                        <p className="text-[11px] text-purple-700 dark:text-purple-300 flex items-center gap-1.5">
                          <RefreshCw size={12} className="animate-spin" />
                          Fetching the full conversation…
                        </p>
                      )}
                      {thread.messages.map(renderRow)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {threads.length > threadCount && (
            <button
              type="button"
              onClick={() => setThreadCount((n) => n + THREADS_PAGE_SIZE)}
              className="w-full py-3 mt-1 text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 font-medium transition-colors whitespace-nowrap"
            >
              Show{" "}
              {Math.min(THREADS_PAGE_SIZE, threads.length - threadCount)} more
              conversation{threads.length - threadCount === 1 ? "" : "s"} (of{" "}
              {threads.length})
            </button>
          )}
        </>
      ) : (
        <>
          <div className="space-y-1.5">
            {(() => {
              const visible = messages.slice(0, visibleCount);
              const rows: React.ReactNode[] = [];
              let lastDate = "";
              for (const msg of visible) {
                const date = new Date(msg.createdAt * 1000)
                  .toISOString()
                  .split("T")[0];
                if (date !== lastDate) {
                  lastDate = date;
                  const stats = dayStats.get(date);
                  rows.push(
                    <div
                      key={`day-${date}`}
                      className="flex items-center gap-2 pt-3 pb-1 first:pt-0"
                    >
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        {formatDate(date)}
                      </span>
                      <span className="text-[11px] text-purple-700 dark:text-purple-300">
                        ↑ {stats?.sent ?? 0}
                      </span>
                      <span className="text-[11px] text-pink-700 dark:text-pink-300">
                        ↓ {stats?.received ?? 0}
                      </span>
                      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                    </div>,
                  );
                }
                rows.push(renderRow(msg));
              }
              return rows;
            })()}
          </div>

          {messages.length > visibleCount && (
            <button
              type="button"
              onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
              className="w-full py-3 mt-2 text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 font-medium transition-colors whitespace-nowrap"
            >
              Show {Math.min(PAGE_SIZE, messages.length - visibleCount)} more
              (of {messages.length})
            </button>
          )}
        </>
      )}
    </div>
  );
}
