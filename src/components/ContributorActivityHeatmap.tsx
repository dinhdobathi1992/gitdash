"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface CalendarDay {
  date: string;
  count: number;
}

/**
 * GitHub-style 52-week contribution heatmap.
 * Renders a grid of 53 columns (weeks) × 7 rows (days).
 */
export function ContributorActivityHeatmap({
  calendar,
}: {
  calendar: CalendarDay[];
}) {
  const { grid, months, maxCount } = useMemo(() => {
    if (!calendar.length) return { grid: [], months: [], maxCount: 0 };

    const max = Math.max(...calendar.map((d) => d.count), 1);

    // Group by week column
    const weeks: CalendarDay[][] = [];
    let currentWeek: CalendarDay[] = [];

    for (let i = 0; i < calendar.length; i++) {
      const d = new Date(calendar[i].date + "T12:00:00Z");
      const dow = d.getUTCDay(); // 0=Sun

      if (dow === 0 && currentWeek.length > 0) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
      currentWeek.push(calendar[i]);
    }
    if (currentWeek.length > 0) weeks.push(currentWeek);

    // Month labels
    const monthLabels: { label: string; col: number }[] = [];
    let lastMonth = -1;
    for (let w = 0; w < weeks.length; w++) {
      const firstDay = weeks[w][0];
      if (!firstDay) continue;
      const m = new Date(firstDay.date + "T12:00:00Z").getUTCMonth();
      if (m !== lastMonth) {
        monthLabels.push({
          label: new Date(firstDay.date + "T12:00:00Z").toLocaleDateString("en-US", {
            month: "short",
            timeZone: "UTC",
          }),
          col: w,
        });
        lastMonth = m;
      }
    }

    return { grid: weeks, months: monthLabels, maxCount: max };
  }, [calendar]);

  if (!grid.length) {
    return (
      <div className="flex items-center justify-center h-24 text-slate-600 text-sm italic">
        No commit activity data available
      </div>
    );
  }

  function getColor(count: number): string {
    if (count === 0) return "bg-slate-800/60";
    const ratio = count / maxCount;
    if (ratio <= 0.25) return "bg-violet-900/60";
    if (ratio <= 0.5) return "bg-violet-700/60";
    if (ratio <= 0.75) return "bg-violet-500/70";
    return "bg-violet-400/80";
  }

  const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

  return (
    <div className="space-y-2">
      {/* Month labels */}
      <div className="flex ml-8 gap-0">
        {months.map((m, i) => (
          <span
            key={i}
            className="text-xs text-slate-500"
            style={{
              marginLeft: i === 0 ? `${m.col * 13}px` : `${(m.col - (months[i - 1]?.col ?? 0) - 1) * 13}px`,
              minWidth: 26,
            }}
          >
            {m.label}
          </span>
        ))}
      </div>

      <div className="flex gap-0">
        {/* Day labels */}
        <div className="flex flex-col gap-[2px] mr-1 shrink-0">
          {DAY_LABELS.map((label, i) => (
            <div key={i} className="h-[11px] flex items-center">
              <span className="text-xs text-slate-600 w-6 text-right">{label}</span>
            </div>
          ))}
        </div>

        {/* Grid */}
        <div className="flex gap-[2px] overflow-x-auto">
          {grid.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[2px]">
              {Array.from({ length: 7 }).map((_, di) => {
                const day = week.find((d) => {
                  const date = new Date(d.date + "T12:00:00Z");
                  return date.getUTCDay() === di;
                });
                return (
                  <div
                    key={di}
                    title={
                      day
                        ? `${day.date}: ${day.count} commit${day.count !== 1 ? "s" : ""}`
                        : undefined
                    }
                    className={cn(
                      "w-[11px] h-[11px] rounded-sm",
                      day ? getColor(day.count) : "bg-transparent"
                    )}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1.5 ml-8">
        <span className="text-xs text-slate-600">Less</span>
        <div className="w-[11px] h-[11px] rounded-sm bg-slate-800/60" />
        <div className="w-[11px] h-[11px] rounded-sm bg-violet-900/60" />
        <div className="w-[11px] h-[11px] rounded-sm bg-violet-700/60" />
        <div className="w-[11px] h-[11px] rounded-sm bg-violet-500/70" />
        <div className="w-[11px] h-[11px] rounded-sm bg-violet-400/80" />
        <span className="text-xs text-slate-600">More</span>
      </div>
    </div>
  );
}
