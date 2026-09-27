"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricTooltipProps {
  text: string;
  className?: string;
  /** Shift the tooltip left/right when it would be clipped. Default: "center" */
  align?: "left" | "center" | "right";
}

export function MetricTooltip({ text, className, align = "center" }: MetricTooltipProps) {
  const [open, setOpen] = useState(false);

  const positionClass =
    align === "left"
      ? "left-0 -translate-x-0"
      : align === "right"
        ? "right-0 translate-x-0"
        : "left-1/2 -translate-x-1/2";

  const arrowClass =
    align === "left"
      ? "left-3 -translate-x-0"
      : align === "right"
        ? "right-3 translate-x-0"
        : "left-1/2 -translate-x-1/2";

  return (
    <span className={cn("relative inline-flex items-center", className)}>
      <button
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full text-faint hover:text-muted transition-colors"
        aria-label="What does this mean?"
        type="button"
      >
        <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="tooltip"
          className={cn(
            "absolute bottom-full mb-2 z-50 w-64 px-3 py-2.5 float-card !rounded-control",
            "text-xs font-normal text-muted leading-relaxed pointer-events-none whitespace-normal normal-case tracking-normal",
            positionClass,
          )}
        >
          {text}
          {/* caret */}
          <div
            className={cn(
              "absolute top-full border-4 border-transparent border-t-control",
              arrowClass,
            )}
          />
        </div>
      )}
    </span>
  );
}
