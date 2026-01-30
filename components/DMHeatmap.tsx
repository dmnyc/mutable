"use client";

import { useState, useMemo } from "react";
import { DMActivityDay } from "@/types";

interface DMHeatmapProps {
  data: DMActivityDay[];
}

export default function DMHeatmap({ data }: DMHeatmapProps) {
  const [hoveredDay, setHoveredDay] = useState<DMActivityDay | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

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
                        className={`w-[10px] h-[10px] rounded-sm ${getColor(day.count)} cursor-pointer transition-colors hover:ring-1 hover:ring-purple-500`}
                        onMouseEnter={(e) => handleMouseEnter(day, e)}
                        onMouseLeave={handleMouseLeave}
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
