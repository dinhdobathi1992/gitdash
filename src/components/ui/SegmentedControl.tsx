"use client";

import { cn } from "@/lib/utils";

/**
 * Segmented control — design contract §5.
 * 3 px inset track, 30 px buttons with aria-pressed. Time ranges and channels.
 */
export function SegmentedControl<T extends string>({
  options, value, onChange, label, className, size = "md",
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  /** Accessible group name, e.g. "Time range". */
  label: string;
  className?: string;
  size?: "md" | "lg";
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("inline-flex items-center gap-0.5 p-[3px] rounded-[9px] bg-surface border border-line", className)}
    >
      {options.map((o) => {
        const pressed = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 rounded-md px-3 font-medium whitespace-nowrap transition-colors duration-100",
              size === "lg" ? "h-9 text-sm" : "h-[30px] text-[13px]",
              pressed ? "bg-raised text-fg font-semibold" : "text-muted hover:text-fg",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
