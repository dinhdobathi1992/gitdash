import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Delta line — arrow + value + meaning in words, coloured by good/bad,
 * not by up/down ("↓ 12s faster" is green). Contract §2.2 and §7.
 */
export function Delta({
  direction, good, children, className,
}: {
  direction: "up" | "down" | "flat";
  /** true = improvement, false = regression, null = neutral. */
  good: boolean | null;
  children: React.ReactNode;
  className?: string;
}) {
  const tone = good === null || direction === "flat"
    ? "text-muted"
    : good ? "text-status-pass-text" : direction === "up" ? "text-status-warn-text" : "text-status-fail-text";
  const Icon = direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs whitespace-nowrap", tone, className)}>
      {Icon && <Icon aria-hidden="true" className="w-3 h-3 shrink-0" strokeWidth={2.25} />}
      {children}
    </span>
  );
}
