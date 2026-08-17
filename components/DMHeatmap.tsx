"use client";

import { useState, useMemo } from "react";
import { ArrowDownLeft, ArrowUpRight, X } from "lucide-react";
import { DMActivityDay, DMMessageMeta, Profile } from "@/types";
import { hexToNpub } from "@/lib/nostr";
import { getDisplayName } from "@/lib/utils/format";

interface DMHeatmapProps {
  data: DMActivityDay[];
  /** Profiles keyed by hex pubkey, used to name counterparties in the drill-down. */
  profilesByPubkey?: Map<string, Profile>;
  onSelectPubkey?: (pubkey: string) => void;
}

export default function DMHeatmap({
  data,
  profilesByPubkey,
  onSelectPubkey,
}: DMHeatmapProps) {
  const [hoveredDay, setHoveredDay] = useState<DMActivityDay | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedDay, setSelectedDay] = useState<DMActivityDay | null>(null);

  // Generate last 12 months of data
  const { weeks, monthLabels, maxCount } = useMemo(() => {
    // Create a map for quick lookup
    const dataMap = new Map<string, DMActivityDay>();
    data.forEach((d) => dataMap.set(d.date, d));

    // Generate all dates for last 12 months
    const today = new Date();
    const startDate = new Date(today);
    startDate.setFullYear(startDate.getFullYear() - 1);
    startDate.setDate(startDate.getDate() - startDate.getDay()); // Start from Sunday

    const weeks: (DMActivityDay | null)[][] = [];
    const monthLabels: { month: string; weekIndex: number }[] = [];
    let currentWeek: (DMActivityDay | null)[] = [];
    let currentMonth = -1;
    let maxCount = 0;

    const current = new Date(startDate);
    let weekIndex = 0;

    while (current <= today) {
      const dateStr = current.toISOString().split("T")[0];
      const dayData = dataMap.get(dateStr) || {
        date: dateStr,
        count: 0,
        sentCount: 0,
        receivedCount: 0,
      };

      if (dayData.count > maxCount) {
        maxCount = dayData.count;
      }

      // Track month labels
      if (current.getMonth() !== currentMonth) {
        currentMonth = current.getMonth();
        monthLabels.push({
          month: current.toLocaleDateString("en-US", { month: "short" }),
          weekIndex,
        });
      }

      currentWeek.push(dayData);

      // Start new week on Sunday
      if (current.getDay() === 6) {
        weeks.push(currentWeek);
        currentWeek = [];
        weekIndex++;
      }

      current.setDate(current.getDate() + 1);
    }

    // Push remaining days
    if (currentWeek.length > 0) {
      weeks.push(currentWeek);
    }

    return { weeks, monthLabels, maxCount };
  }, [data]);

  // Get color intensity based on count
  const getColor = (count: number): string => {
    if (count === 0) return "bg-gray-100 dark:bg-gray-800";
    if (maxCount === 0) return "bg-gray-100 dark:bg-gray-800";

    const intensity = count / maxCount;
    if (intensity < 0.25) return "bg-purple-200 dark:bg-purple-900/50";
    if (intensity < 0.5) return "bg-purple-400 dark:bg-purple-700";
    if (intensity < 0.75) return "bg-purple-600 dark:bg-purple-500";
    return "bg-purple-800 dark:bg-purple-400";
  };

  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const handleMouseEnter = (day: DMActivityDay, e: React.MouseEvent) => {
    setHoveredDay(day);
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setTooltipPos({
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
  };

  const handleMouseLeave = () => {
    setHoveredDay(null);
    setTooltipPos(null);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatTime = (unixSeconds: number) =>
    new Date(unixSeconds * 1000).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });

  // Drill-down derivations for the currently selected day.
  const dayMessages: DMMessageMeta[] = useMemo(
    () => selectedDay?.messages ?? [],
    [selectedDay],
  );

  const maxContentLength = useMemo(
    () => dayMessages.reduce((max, m) => Math.max(max, m.contentLength), 0),
    [dayMessages],
  );

  const daySummary = useMemo(() => {
    const partners = new Set(
      dayMessages.map((m) => m.counterparty).filter(Boolean),
    );
    return { partnerCount: partners.size };
  }, [dayMessages]);

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        <p>No activity data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Heatmap Grid */}
      <div className="overflow-x-auto pb-2">
        <div className="inline-block min-w-max">
          {/* Month Labels */}
          <div className="flex mb-1 ml-8">
            {monthLabels.map((label, i) => (
              <div
                key={`${label.month}-${i}`}
                className="text-xs text-gray-500 dark:text-gray-400"
                style={{
                  marginLeft: i === 0 ? label.weekIndex * 12 : (monthLabels[i].weekIndex - monthLabels[i - 1].weekIndex - 1) * 12,
                  width: "36px",
                }}
              >
                {label.month}
              </div>
            ))}
          </div>

          {/* Grid */}
          <div className="flex">
            {/* Day Labels */}
            <div className="flex flex-col gap-0.5 mr-1">
              {dayLabels.map((day, i) => (
                <div
                  key={day}
                  className="h-[10px] text-[9px] text-gray-400 dark:text-gray-500 flex items-center justify-end pr-1"
                  style={{ visibility: i % 2 === 1 ? "visible" : "hidden" }}
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Weeks */}
            <div className="flex gap-0.5">
              {weeks.map((week, weekIndex) => (
                <div key={weekIndex} className="flex flex-col gap-0.5">
                  {week.map((day, dayIndex) =>
                    day ? (
                      <div
                        key={day.date}
                        className={`w-[10px] h-[10px] rounded-sm ${getColor(day.count)} transition-colors ${
                          day.count > 0
                            ? "cursor-pointer hover:ring-1 hover:ring-purple-500"
                            : "cursor-default"
                        } ${
                          selectedDay?.date === day.date
                            ? "ring-2 ring-purple-600 dark:ring-purple-400"
                            : ""
                        }`}
                        onMouseEnter={(e) => handleMouseEnter(day, e)}
                        onMouseLeave={handleMouseLeave}
                        onClick={() => {
                          if (day.count === 0) return;
                          setSelectedDay((prev) =>
                            prev?.date === day.date ? null : day,
                          );
                        }}
                        title={day.count > 0 ? "Click to see this day's messages" : undefined}
                      />
                    ) : (
                      <div
                        key={`empty-${dayIndex}`}
                        className="w-[10px] h-[10px]"
                      />
                    )
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-2">
          <span>Less</span>
          <div className="flex gap-0.5">
            <div className="w-[10px] h-[10px] rounded-sm bg-gray-100 dark:bg-gray-800" />
            <div className="w-[10px] h-[10px] rounded-sm bg-purple-200 dark:bg-purple-900/50" />
            <div className="w-[10px] h-[10px] rounded-sm bg-purple-400 dark:bg-purple-700" />
            <div className="w-[10px] h-[10px] rounded-sm bg-purple-600 dark:bg-purple-500" />
            <div className="w-[10px] h-[10px] rounded-sm bg-purple-800 dark:bg-purple-400" />
          </div>
          <span>More</span>
        </div>

        {/* Summary Stats */}
        <div className="flex items-center gap-4">
          <span>
            Total: <strong className="text-gray-900 dark:text-white">{data.reduce((sum, d) => sum + d.count, 0)}</strong> DMs
          </span>
          <span>
            Active days: <strong className="text-gray-900 dark:text-white">{data.filter((d) => d.count > 0).length}</strong>
          </span>
        </div>
      </div>

      {/* Day drill-down */}
      {selectedDay && (
        <div className="border border-purple-200 dark:border-purple-800 rounded-lg bg-purple-50/50 dark:bg-purple-900/10 p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white">
                {formatDate(selectedDay.date)}
              </h4>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                {selectedDay.count} message
                {selectedDay.count === 1 ? "" : "s"} with{" "}
                {daySummary.partnerCount}{" "}
                {daySummary.partnerCount === 1 ? "person" : "people"}
                {" · "}
                <span className="text-purple-700 dark:text-purple-300">
                  ↑ {selectedDay.sentCount} sent
                </span>
                {" · "}
                <span className="text-pink-700 dark:text-pink-300">
                  ↓ {selectedDay.receivedCount} received
                </span>
              </p>
            </div>
            <button
              onClick={() => setSelectedDay(null)}
              className="p-1 rounded text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex-shrink-0"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>

          {dayMessages.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Per-message detail isn&apos;t available for this day. Re-run the
              analysis to capture it.
            </p>
          ) : (
            <>
              <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                {dayMessages.map((msg) => {
                  const profile = profilesByPubkey?.get(msg.counterparty);
                  const name = msg.counterparty
                    ? profile
                      ? getDisplayName(profile)
                      : `${hexToNpub(msg.counterparty).slice(0, 14)}…`
                    : "unknown";
                  const isSent = msg.direction === "sent";
                  const widthPct =
                    maxContentLength > 0
                      ? Math.max(4, (msg.contentLength / maxContentLength) * 100)
                      : 0;

                  return (
                    <div
                      key={msg.eventId}
                      className="flex items-center gap-2 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5"
                    >
                      <span
                        className={
                          isSent
                            ? "text-purple-600 dark:text-purple-400 flex-shrink-0"
                            : "text-pink-600 dark:text-pink-400 flex-shrink-0"
                        }
                        title={isSent ? "Sent" : "Received"}
                      >
                        {isSent ? (
                          <ArrowUpRight size={14} />
                        ) : (
                          <ArrowDownLeft size={14} />
                        )}
                      </span>

                      <span className="font-mono text-gray-500 dark:text-gray-400 flex-shrink-0 tabular-nums">
                        {formatTime(msg.createdAt)}
                      </span>

                      <button
                        onClick={() =>
                          msg.counterparty && onSelectPubkey?.(msg.counterparty)
                        }
                        disabled={!msg.counterparty || !onSelectPubkey}
                        className="font-medium text-gray-900 dark:text-white truncate max-w-[10rem] text-left enabled:hover:underline disabled:cursor-default"
                        title={
                          msg.counterparty
                            ? hexToNpub(msg.counterparty)
                            : undefined
                        }
                      >
                        {name}
                      </button>

                      {/* Ciphertext size — the body stays encrypted, but its
                          length is public and approximates message size. */}
                      <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
                        <div className="hidden sm:block w-16 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${isSent ? "bg-purple-500" : "bg-pink-500"}`}
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                        <span
                          className="text-gray-500 dark:text-gray-400 tabular-nums flex-shrink-0"
                          title="Encrypted payload size in bytes"
                        >
                          {msg.contentLength}B
                        </span>
                      </div>

                      {msg.client && (
                        <span
                          className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 flex-shrink-0 hidden md:inline"
                          title="Client tag published with this message"
                        >
                          {msg.client}
                        </span>
                      )}
                      {msg.replyToEventId && (
                        <span
                          className="text-gray-400 dark:text-gray-500 flex-shrink-0"
                          title="Replies to an earlier event"
                        >
                          ↩
                        </span>
                      )}
                      {msg.expiresAt && (
                        <span
                          className="text-amber-600 dark:text-amber-400 flex-shrink-0"
                          title="Disappearing message"
                        >
                          ⏳
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3">
                Message contents stay encrypted — everything above is public
                envelope metadata. Sizes are ciphertext bytes, which approximate
                the original message length.
              </p>
            </>
          )}
        </div>
      )}

      {/* Tooltip */}
      {hoveredDay && tooltipPos && (
        <div
          className="fixed z-50 px-3 py-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg shadow-lg pointer-events-none transform -translate-x-1/2 -translate-y-full"
          style={{
            left: tooltipPos.x,
            top: tooltipPos.y,
          }}
        >
          <div className="font-medium mb-1">{formatDate(hoveredDay.date)}</div>
          <div className="flex gap-3">
            <span>{hoveredDay.count} total</span>
            <span className="text-purple-300">↑ {hoveredDay.sentCount} sent</span>
            <span className="text-pink-300">↓ {hoveredDay.receivedCount} received</span>
          </div>
          {/* Arrow */}
          <div className="absolute left-1/2 bottom-0 transform -translate-x-1/2 translate-y-full">
            <div className="border-4 border-transparent border-t-gray-900 dark:border-t-gray-700" />
          </div>
        </div>
      )}
    </div>
  );
}
