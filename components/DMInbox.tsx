"use client";

import { useMemo, useState, useEffect } from "react";
import { Inbox } from "lucide-react";
import { DMActivityDay, Profile } from "@/types";
import DMMessageRow from "./DMMessageRow";

const PAGE_SIZE = 100;

/**
 * Doxxed Inbox — every DM envelope from the scan as one chronological list,
 * newest first. Only the message contents are hidden; everything here is
 * public NIP-04 envelope metadata.
 */
export default function DMInbox({
  data,
  profilesByPubkey,
  onSelectPubkey,
  onRequestProfiles,
}: {
  data: DMActivityDay[];
  profilesByPubkey?: Map<string, Profile>;
  onSelectPubkey?: (pubkey: string) => void;
  /** Called with counterparties missing from profilesByPubkey so the parent
      can fetch their names lazily (same contract as DMHeatmap). */
  onRequestProfiles?: (pubkeys: string[]) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

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

  // Ask the parent to fetch profiles for counterparties this inbox is
  // missing, so rows show names instead of bare npubs. Fires for the visible
  // page only, once per new key.
  const missingCounterparties = useMemo(() => {
    const seen = new Set<string>();
    const missing: string[] = [];
    for (const msg of messages.slice(0, visibleCount)) {
      const pk = msg.counterparty;
      if (!pk || seen.has(pk) || profilesByPubkey?.has(pk)) continue;
      seen.add(pk);
      missing.push(pk);
    }
    return missing;
  }, [messages, visibleCount, profilesByPubkey]);

  useEffect(() => {
    if (missingCounterparties.length > 0 && onRequestProfiles) {
      onRequestProfiles(missingCounterparties);
    }
  }, [missingCounterparties, onRequestProfiles]);

  const maxContentLength = useMemo(
    () => messages.reduce((max, m) => Math.max(max, m.contentLength), 0),
    [messages],
  );

  // Per-day sent/received split for the dividers.
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

  const formatDate = (dateStr: string) =>
    new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });

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

  const visible = messages.slice(0, visibleCount);
  const remaining = messages.length - visible.length;

  const rows: React.ReactNode[] = [];
  let lastDate = "";
  for (const msg of visible) {
    const date = new Date(msg.createdAt * 1000).toISOString().split("T")[0];
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
    rows.push(
      <DMMessageRow
        key={msg.eventId}
        msg={msg}
        profile={msg.counterparty ? profilesByPubkey?.get(msg.counterparty) : undefined}
        maxContentLength={maxContentLength}
        onSelectPubkey={onSelectPubkey}
      />,
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {messages.length} message{messages.length === 1 ? "" : "s"}, newest
        first — everything shown is public envelope metadata; contents stay
        encrypted.
      </p>

      {rows}

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
          className="w-full py-3 mt-2 text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 font-medium transition-colors whitespace-nowrap"
        >
          Show {Math.min(PAGE_SIZE, remaining)} more (of {messages.length})
        </button>
      )}
    </div>
  );
}
