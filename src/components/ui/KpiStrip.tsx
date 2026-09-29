import { cn } from "@/lib/utils";

/**
 * KPI strip — design contract §5. One card, n equal cells split by 1 px rules.
 * Cell: label (13 muted) → figure (mono 26, 24 in 6-up) → delta/caption line (12).
 * Optional 96×36 sparkline, bottom-right.
 */
export interface KpiCell {
  key: string;
  label: React.ReactNode;
  value: React.ReactNode;
  /** Tints the figure: warning/failure when the figure itself is the alarm. */
  tone?: "default" | "fail" | "warn" | "pass";
  /** Delta or caption; a <Delta> or plain text. */
  foot?: React.ReactNode;
  spark?: React.ReactNode;
  loading?: boolean;
}

const TONE: Record<NonNullable<KpiCell["tone"]>, string> = {
  default: "text-fg",
  fail: "text-status-fail-text",
  warn: "text-status-warn-text",
  pass: "text-status-pass-text",
};

export function KpiStrip({ cells, className, mobileCols = 1 }: {
  cells: KpiCell[];
  className?: string;
  /** Columns below `sm`. With 2, an odd last cell spans the row. */
  mobileCols?: 1 | 2;
}) {
  const dense = cells.length >= 6;
  const cols = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-3",
    4: "sm:grid-cols-2 xl:grid-cols-4",
    5: "sm:grid-cols-3 xl:grid-cols-5",
    6: "sm:grid-cols-3 xl:grid-cols-6",
  }[Math.min(6, Math.max(2, cells.length)) as 2 | 3 | 4 | 5 | 6];
  return (
    <section className={cn("card overflow-hidden", className)}>
      <dl className={cn(
        "grid gap-px bg-line",
        mobileCols === 2 ? "grid-cols-2 [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1" : "grid-cols-1",
        cols,
      )}>
        {cells.map((c) => (
          <div
            key={c.key}
            className={cn(
              "relative flex flex-col min-w-0 bg-[linear-gradient(180deg,var(--surface-card-top),var(--surface-card-bottom))]",
              dense ? "px-5 py-[18px]" : "px-[22px] py-5",
            )}
          >
            <dt className="text-[13px] text-muted truncate">{c.label}</dt>
            <dd className="mt-1.5 min-w-0">
              {c.loading ? (
                <div className="h-8 w-28 rounded skeleton" />
              ) : (
                <p className={cn("font-mono font-semibold tabular-nums tracking-tight", dense ? "text-2xl leading-8" : "text-[26px] leading-8", TONE[c.tone ?? "default"])}>
                  {c.value}
                </p>
              )}
              {c.foot && <div className={cn("mt-1 text-xs text-muted truncate", c.spark && "pr-24")}>{c.foot}</div>}
            </dd>
            {c.spark && !c.loading && <div className="absolute right-[22px] bottom-5">{c.spark}</div>}
          </div>
        ))}
      </dl>
    </section>
  );
}
