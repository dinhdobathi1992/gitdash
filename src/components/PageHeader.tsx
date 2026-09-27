"use client";

/**
 * PageHeader — standardized page-level header component.
 *
 * Renders:
 *   - Icon + title + optional subtitle
 *   - Optional status chip(s)
 *   - Optional action slot (buttons, links)
 *   - Optional breadcrumb (rendered above the title row)
 */

import React from "react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface StatusChip {
  label: string;
  color?: "green" | "red" | "amber" | "blue" | "violet" | "gray";
}

export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  chips?: StatusChip[];
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  className?: string;
}

const CHIP_COLORS: Record<NonNullable<StatusChip["color"]>, string> = {
  green:  "bg-status-pass-tint text-status-pass-text",
  red:    "bg-status-fail-tint text-status-fail-text",
  amber:  "bg-status-warn-tint text-status-warn-text",
  blue:   "bg-status-run-tint text-status-run-text",
  violet: "bg-brand-soft text-violet-200",
  gray:   "bg-status-neutral-tint text-status-neutral-text",
};

/**
 * Page header anatomy (contract §4.1): h1 28/34 + one-line meta, actions
 * right. The icon prop is accepted for compatibility but no longer drawn —
 * the design uses plain titles.
 */
export function PageHeader({
  title,
  subtitle,
  chips = [],
  actions,
  breadcrumb,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("mb-7", className)}>
      {breadcrumb && <div className="mb-3">{breadcrumb}</div>}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl sm:text-[28px] leading-[34px] font-semibold tracking-[-0.02em] text-fg truncate">{title}</h1>
            {chips.map((chip, i) => (
              <span key={i} className={cn("inline-flex items-center h-6 px-2.5 rounded-full text-xs font-medium", CHIP_COLORS[chip.color ?? "gray"])}>
                {chip.label}
              </span>
            ))}
          </div>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-3 shrink-0 flex-wrap">{actions}</div>}
      </div>
    </header>
  );
}

// ── Section header ─────────────────────────────────────────────────────────────

export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 mb-4", className)}>
      <div>
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
        {description && <p className="text-[13px] text-muted mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-3 shrink-0">{actions}</div>}
    </div>
  );
}

// ── KPI card ───────────────────────────────────────────────────────────────────

export function KpiCard({
  label,
  value,
  sub,
  trend,
  color = "default",
  className,
  provenance,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  trend?: "up" | "down" | "flat";
  color?: "default" | "green" | "red" | "amber" | "blue" | "violet";
  className?: string;
  provenance?: React.ReactNode;
}) {
  const colorMap = {
    default: "text-fg",
    green:   "text-status-pass-text",
    red:     "text-status-fail-text",
    amber:   "text-status-warn-text",
    blue:    "text-status-run-text",
    violet:  "text-brand-fg",
  };

  const trendIcon = trend === "up" ? "↑" : trend === "down" ? "↓" : null;
  const trendColor = trend === "up" ? "text-status-pass-text" : trend === "down" ? "text-status-fail-text" : "";
  const trendWord = trend === "up" ? "rising" : trend === "down" ? "falling" : null;

  return (
    <div className={cn("relative card px-5 py-[18px]", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] text-muted">{label}</p>
        {provenance && <div className="shrink-0">{provenance}</div>}
      </div>
      <p className={cn("mt-1.5 font-mono text-2xl leading-8 font-semibold tabular-nums", colorMap[color])}>
        {value}
        {trendIcon && <span className={cn("ml-1.5 text-sm font-sans font-medium", trendColor)}>{trendIcon} {trendWord}</span>}
      </p>
      {sub && <p className="text-xs text-muted mt-1">{sub}</p>}
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-3 px-5 py-5", className)}>
      <p className="flex items-center gap-2 text-sm text-muted">
        {Icon && <Icon className="w-4 h-4 text-faint shrink-0" aria-hidden="true" />}
        <span><span className="text-fg font-medium">{title}</span>{description ? <> — {description}</> : null}</span>
      </p>
      {action}
    </div>
  );
}

// ── Error state ────────────────────────────────────────────────────────────────

export function ErrorState({
  title = "Something went wrong",
  description,
  retry,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  retry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("flex items-center gap-3 px-4 py-3 rounded-control bg-status-fail-tint border border-status-fail/25 text-sm text-status-fail-text", className)}>
      <span className="flex-1 min-w-0">
        <span className="font-medium">{title}</span>
        {description && <span className="text-status-fail-text/80"> — {description}</span>}
      </span>
      {retry && (
        <button type="button" onClick={retry} className="shrink-0 h-8 px-3 rounded-control border border-status-fail/40 text-[13px] font-semibold hover:bg-status-fail/10">
          Retry
        </button>
      )}
    </div>
  );
}
