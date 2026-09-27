"use client";

import { cn } from "@/lib/utils";

/** Filter chip — 30 px round, aria-pressed; label carries its count ("Failing 2"). */
export function FilterChip({
  pressed, onClick, children, count, className,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 h-[30px] px-3 rounded-full border text-[13px] font-medium whitespace-nowrap transition-colors duration-100",
        pressed
          ? "bg-brand-soft border-brand-fg/60 text-violet-200"
          : "bg-transparent border-control text-muted hover:text-fg hover:border-control-strong",
        className,
      )}
    >
      {children}
      {count !== undefined && <span className="font-mono">{count}</span>}
    </button>
  );
}
