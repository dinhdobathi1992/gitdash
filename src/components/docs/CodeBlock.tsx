"use client";

import { useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Inline code */
export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-xs bg-slate-800 border border-slate-700/50 rounded px-1.5 py-0.5 text-violet-300">
      {children}
    </code>
  );
}

/** Block code with optional filename and copy button */
export function CodeBlock({
  children,
  language,
  filename,
  copy: showCopy = true,
}: {
  children: string;
  language?: string;
  filename?: string;
  copy?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [children]);

  return (
    <div className="rounded-xl border border-slate-700/50 overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          {filename && (
            <span className="text-xs text-slate-400 font-mono">{filename}</span>
          )}
          {language && !filename && (
            <span className="text-xs text-slate-500">{language}</span>
          )}
        </div>
        {showCopy && (
          <button
            onClick={handleCopy}
            className={cn(
              "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-all",
              copied
                ? "text-emerald-400 bg-emerald-500/10"
                : "text-slate-400 hover:text-white hover:bg-slate-700/60"
            )}
          >
            {copied ? (
              <>
                <Check className="w-3 h-3" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                Copy
              </>
            )}
          </button>
        )}
      </div>
      {/* Code */}
      <pre className="font-mono text-sm bg-slate-950 p-4 overflow-x-auto text-slate-300 leading-relaxed">
        {children}
      </pre>
    </div>
  );
}

/** Raw pre block that wraps pre elements coming from sections */
export function PreBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <pre className={cn(
      "font-mono text-sm bg-slate-900 border border-slate-700/50 rounded-xl p-4 overflow-x-auto text-slate-300 leading-relaxed",
      className
    )}>
      {children}
    </pre>
  );
}
