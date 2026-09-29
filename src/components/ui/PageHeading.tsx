import { cn } from "@/lib/utils";

/**
 * Page header anatomy (contract §4.1): h1 + one-line meta, page actions right.
 * `mono` renders identifier titles (repo, workflow) in the mono face at 26/32.
 */
export function PageHeading({
  title, meta, actions, mono, className, children,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  mono?: boolean;
  className?: string;
  /** Extra row under the meta line (status meta, etc.). */
  children?: React.ReactNode;
}) {
  return (
    <header className={cn("flex items-start justify-between gap-4 flex-wrap", className)}>
      <div className="min-w-0">
        <h1 className={cn(
          "font-semibold text-fg truncate",
          mono ? "font-mono text-[22px] leading-8 sm:text-[26px] tracking-[-0.01em]" : "text-2xl sm:text-[28px] leading-[34px] tracking-[-0.02em]",
        )}>
          {title}
        </h1>
        {meta && <div className="mt-1 text-sm text-muted">{meta}</div>}
        {children}
      </div>
      {/* max-w-full: on a phone the actions wrap inside the page width instead of scrolling it sideways. */}
      {actions && <div className="flex items-center gap-3 flex-wrap shrink-0 max-w-full">{actions}</div>}
    </header>
  );
}

/** Standard page padding: 32 top / 40 sides desktop; 28 between sections. */
export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("px-4 pt-5 pb-24 sm:px-6 lg:px-10 lg:pt-8 lg:pb-12 flex flex-col gap-7", className)}>
      {children}
    </div>
  );
}
