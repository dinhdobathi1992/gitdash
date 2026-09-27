import { cn } from "@/lib/utils";

/**
 * Run strip — last N runs, oldest → newest, 8×18 squares, gap 3, radius 2.
 * Carries a text alternative so the outcome pattern is not colour-only.
 */
export interface RunStripPoint {
  id: number | string;
  conclusion: string | null;
  status?: string | null;
}

function tone(p: RunStripPoint): string {
  if (p.status && p.status !== "completed") return "bg-status-run";
  if (p.conclusion === "success") return "bg-status-pass";
  if (p.conclusion === "failure" || p.conclusion === "timed_out" || p.conclusion === "startup_failure") return "bg-status-fail";
  return "bg-status-neutral";
}

export function runStripLabel(runs: RunStripPoint[]): string {
  let passed = 0, failed = 0, other = 0, running = 0;
  for (const r of runs) {
    if (r.status && r.status !== "completed") running++;
    else if (r.conclusion === "success") passed++;
    else if (r.conclusion === "failure" || r.conclusion === "timed_out" || r.conclusion === "startup_failure") failed++;
    else other++;
  }
  const parts = [`${passed} passed`, `${failed} failed`];
  if (other) parts.push(`${other} cancelled or skipped`);
  if (running) parts.push(`${running} running`);
  return `Last ${runs.length} runs: ${parts.join(", ")}`;
}

/** `runs` newest-first (GitHub order); rendered oldest → newest. */
export function RunStrip({ runs, size = "md", className }: { runs: RunStripPoint[]; size?: "md" | "lg"; className?: string }) {
  const ordered = [...runs].reverse();
  return (
    <div role="img" aria-label={runStripLabel(runs)} className={cn("flex items-center gap-[3px]", className)}>
      {ordered.map((r) => (
        <span
          key={r.id}
          className={cn("rounded-[2px]", size === "lg" ? "w-[9px] h-5" : "w-2 h-[18px]", tone(r))}
        />
      ))}
    </div>
  );
}
