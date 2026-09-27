"use client";

import { cn } from "@/lib/utils";

/** Switch — 36×20 button role="switch"; label via aria-label that says the action. */
export function Switch({
  checked, onChange, label, disabled, className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-100",
        checked ? "bg-brand" : "bg-control-strong",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-100",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
