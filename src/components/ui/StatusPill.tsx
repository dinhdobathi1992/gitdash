import { cn } from "@/lib/utils";

/**
 * Status pill — design contract §5. 24 px round: tint + text colour + 6 px dot + word.
 * Colour is never the only signal; the word always renders.
 */
export type StatusTone = "pass" | "fail" | "warn" | "run" | "neutral";

const TONES: Record<StatusTone, { pill: string; dot: string }> = {
  pass: { pill: "bg-status-pass-tint text-status-pass-text", dot: "bg-status-pass" },
  fail: { pill: "bg-status-fail-tint text-status-fail-text", dot: "bg-status-fail" },
  warn: { pill: "bg-status-warn-tint text-status-warn-text", dot: "bg-status-warn" },
  run: { pill: "bg-status-run-tint text-status-run-text", dot: "bg-status-run" },
  neutral: { pill: "bg-status-neutral-tint text-status-neutral-text", dot: "bg-status-neutral" },
};

export function StatusPill({
  tone, children, className, pulse,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
  /** Pulse the dot for live states (running, queued). */
  pulse?: boolean;
}) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-medium whitespace-nowrap",
        t.pill,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("w-1.5 h-1.5 rounded-full shrink-0", t.dot, pulse && "animate-pulse")} />
      {children}
    </span>
  );
}

/** Map a GitHub run conclusion/status to a pill tone and word (runs vocabulary). */
export function runOutcome(conclusion: string | null | undefined, status?: string | null): { tone: StatusTone; label: string; live: boolean } {
  if (status && status !== "completed") {
    if (status === "in_progress") return { tone: "run", label: "Running", live: true };
    return { tone: "run", label: "Queued", live: true };
  }
  switch (conclusion) {
    case "success": return { tone: "pass", label: "Success", live: false };
    case "failure": return { tone: "fail", label: "Failure", live: false };
    case "timed_out": return { tone: "fail", label: "Timed out", live: false };
    case "startup_failure": return { tone: "fail", label: "Startup failure", live: false };
    case "cancelled": return { tone: "neutral", label: "Cancelled", live: false };
    case "skipped": return { tone: "neutral", label: "Skipped", live: false };
    case "action_required": return { tone: "warn", label: "Action required", live: false };
    case "neutral": return { tone: "neutral", label: "Neutral", live: false };
    default: return { tone: "neutral", label: conclusion ? conclusion.replace(/_/g, " ") : "Unknown", live: false };
  }
}

/** Rating chip — 22 px, radius 6. Elite = success, High = info, Medium = warning, Low = failure. */
export type Rating = "Elite" | "High" | "Medium" | "Low";

const RATING: Record<Rating, string> = {
  Elite: "bg-status-pass-tint text-status-pass-text",
  High: "bg-status-run-tint text-status-run-text",
  Medium: "bg-status-warn-tint text-status-warn-text",
  Low: "bg-status-fail-tint text-status-fail-text",
};

export function RatingChip({ rating, className }: { rating: Rating; className?: string }) {
  return (
    <span className={cn("inline-flex items-center h-[22px] px-2 rounded-chip text-xs font-semibold", RATING[rating], className)}>
      {rating}
    </span>
  );
}
