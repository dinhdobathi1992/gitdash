"use client";

import { useState } from "react";
import { Code } from "@/components/docs/CodeBlock";

// ── Shared micro-components ───────────────────────────────────────────────────

export function SectionHeading({ id, icon: Icon, badge, children }: {
  id: string; icon: React.ElementType; badge?: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 mb-8 pb-4 border-b border-slate-800">
      <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center shrink-0">
        <Icon className="w-4.5 h-4.5 text-violet-400" />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <h2 id={id} className="text-2xl font-semibold tracking-[-0.02em] text-fg scroll-mt-20">{children}</h2>
        {badge && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20 font-medium">
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}

export function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="font-semibold text-white text-base mb-3">{children}</h3>;
}

export function ProseP({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-400 leading-relaxed">{children}</p>;
}

// ── Feature page shared header ────────────────────────────────────────────────

// Small pill marking a feature (or an addition to an existing one) by the
// version it shipped in. Keep this next to any doc content added going
// forward — it's how "what's new" stays discoverable outside the changelog.
export function VersionBadge({ v }: { v: string }) {
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/25">
      New in v{v}
    </span>
  );
}

export function FeaturePageHeader({
  icon: Icon, name, path, chips, since,
}: {
  icon: React.ElementType; name: string; path: string; chips: string[]; since?: string;
}) {
  return (
    <div className="mb-8 pb-4 border-b border-slate-800">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-violet-400" />
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-2xl font-bold text-white">{name}</h2>
            <Code>{path}</Code>
            {since && <VersionBadge v={since} />}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 pl-12">
        {chips.map((c) => (
          <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-300 border border-slate-600/50">
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Screenshot slot ───────────────────────────────────────────────────────────
// Drop a PNG into /public/screenshots/<file> and it renders automatically.
// If the file is absent a placeholder shows the expected filename instead.
export function ScreenshotSlot({ file, alt }: { file: string; alt: string }) {
  const [missing, setMissing] = useState(false);
  const src = `/screenshots/${file}`;
  if (missing) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-slate-600 bg-slate-800/40 flex flex-col items-center justify-center gap-2 py-8 text-center">
        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 3h18M3 21h18" />
          </svg>
        </div>
        <p className="text-xs text-slate-500">
          Add a screenshot at{" "}
          <code className="text-slate-400 bg-slate-700/60 px-1.5 py-0.5 rounded">
            public/screenshots/{file}
          </code>
        </p>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-lg overflow-hidden border border-slate-700/60 bg-slate-900">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="w-full object-cover object-top"
        onError={() => setMissing(true)}
      />
    </div>
  );
}
