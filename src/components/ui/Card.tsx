import { cn } from "@/lib/utils";

/** Card shell — border-line + gradient + shadow-card (contract §3.3). */
export function Card({
  children, className, as: As = "section", warm, ...rest
}: React.HTMLAttributes<HTMLElement> & {
  as?: "section" | "div" | "article";
  /** Regressing metric: warm border and background (contract §5 KPI card). */
  warm?: boolean;
}) {
  return (
    <As
      className={cn(
        "card",
        warm && "!border-[#3A2A2E] ![background:#161419]",
        className,
      )}
      {...rest}
    >
      {children}
    </As>
  );
}

/** Card header row: h2 (15/600) + optional description + right-aligned slot. */
export function CardHeader({
  title, description, actions, className, id,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h2 id={id} className="text-[15px] leading-5 font-semibold text-fg">{title}</h2>
        {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-3 shrink-0 text-xs text-muted">{actions}</div>}
    </div>
  );
}

/** Section title above cards (e.g. "Needs attention 4"). */
export function SectionTitle({
  children, count, actions, className, meta,
}: {
  children: React.ReactNode;
  count?: number;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-4 mb-3", className)}>
      <div className="flex items-baseline gap-2.5 min-w-0 flex-wrap">
        <h2 className="text-[15px] font-semibold text-fg">{children}</h2>
        {count !== undefined && (
          <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-raised text-xs font-semibold text-fg font-mono self-center">
            {count}
          </span>
        )}
        {meta && <span className="text-[13px] text-faint">{meta}</span>}
      </div>
      {actions && <div className="flex items-center gap-3 shrink-0">{actions}</div>}
    </div>
  );
}

/** Error banner — failure tint with a retry action (contract §10 DoD). */
export function ErrorBanner({ message, onRetry, className }: { message: React.ReactNode; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex items-center gap-3 px-4 py-3 rounded-control bg-status-fail-tint border border-status-fail/25 text-sm text-status-fail-text", className)}>
      <span className="flex-1 min-w-0">{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 h-8 px-3 rounded-control border border-status-fail/40 text-[13px] font-semibold hover:bg-status-fail/10">
          Retry
        </button>
      )}
    </div>
  );
}

/** Empty state — one sentence and one action, no illustration (contract §7). */
export function EmptyLine({ children, action, tone = "neutral", className }: { children: React.ReactNode; action?: React.ReactNode; tone?: "neutral" | "pass"; className?: string }) {
  return (
    <div className={cn(
      "flex items-center justify-between gap-3 px-5 py-4 text-sm",
      tone === "pass" ? "text-status-pass-text" : "text-muted",
      className,
    )}>
      <span>{children}</span>
      {action}
    </div>
  );
}
