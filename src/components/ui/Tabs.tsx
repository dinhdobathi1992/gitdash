"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Underline tabs — design contract §5 / §4.3.
 * 40 px, 14/500; active = text-fg + 2 px brand-fg underline + aria-current.
 * Link tabs for routes, button tabs for in-page state.
 */
export interface TabItem {
  key: string;
  label: string;
  href?: string;
  count?: number | null;
  /** Count badge tone — Security uses warning. */
  countTone?: "default" | "warning";
}

export function Tabs({
  items, active, onSelect, className, label,
}: {
  items: TabItem[];
  active: string;
  onSelect?: (key: string) => void;
  className?: string;
  /** Accessible name for the tab list. */
  label: string;
}) {
  return (
    <nav aria-label={label} className={cn("sm:border-b sm:border-line -mx-4 px-4 sm:mx-0 sm:px-0", className)}>
      <ul className="flex items-end gap-2 sm:gap-1 overflow-x-auto sm:-mb-px pb-1 sm:pb-0 [scrollbar-width:none]">
        {items.map((t) => {
          const isActive = t.key === active;
          // Phones get horizontally scrolling chips (contract §4.2); larger
          // screens get underline tabs.
          const cls = cn(
            "relative inline-flex items-center gap-2 text-sm font-medium whitespace-nowrap transition-colors duration-100",
            "max-sm:h-11 max-sm:px-4 max-sm:rounded-full max-sm:border max-sm:text-[15px]",
            "sm:h-10 sm:px-3 sm:border-b-2",
            isActive
              ? "text-fg sm:border-brand-fg max-sm:bg-fg max-sm:text-ground max-sm:border-fg"
              : "text-muted sm:border-transparent max-sm:border-control hover:text-fg",
          );
          const count = t.count != null && (
            <span
              className={cn(
                "text-xs font-mono",
                t.countTone === "warning"
                  ? "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-status-warn-tint text-status-warn-text font-sans font-semibold"
                  : "text-faint",
              )}
            >
              {t.count}
            </span>
          );
          return (
            <li key={t.key}>
              {t.href ? (
                <Link href={t.href} aria-current={isActive ? "page" : undefined} className={cls}>
                  {t.label}
                  {count}
                </Link>
              ) : (
                <button
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => onSelect?.(t.key)}
                  className={cls}
                >
                  {t.label}
                  {count}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
