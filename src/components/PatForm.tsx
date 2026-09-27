"use client";

import { useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * GitHub Personal Access Token sign-in form. Posts to /api/auth/setup and,
 * on success, hard-loads "/" so every later fetch runs with the new session.
 * Used by /setup (standalone mode, primary action) and /login (organization
 * mode, secondary to "Continue with GitHub").
 */
export function PatForm({ primary = false, children }: { primary?: boolean; children?: React.ReactNode }) {
  const [pat, setPat] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat: pat.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        return;
      }
      // A session was just created; a hard load ensures every subsequent fetch
      // runs with the new token rather than replaying pre-auth cache.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/";
    } catch {
      setError("Network error — could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="px-3.5 py-3 rounded-control bg-status-fail-tint border border-status-fail/25 text-[13px] text-status-fail-text">
          {error}
        </p>
      )}
      <label htmlFor="pat" className="text-sm font-semibold text-fg">Personal access token</label>
      <div className="relative">
        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-faint pointer-events-none" aria-hidden="true" />
        <input
          id="pat"
          type={show ? "text" : "password"}
          value={pat}
          onChange={(e) => setPat(e.target.value)}
          placeholder="ghp_… or github_pat_…"
          autoComplete="off"
          spellCheck={false}
          required
          className="w-full h-[46px] pl-11 pr-11 rounded-[12px] bg-panel border border-control-strong font-mono text-sm text-fg placeholder:text-faint focus:outline-none focus:border-brand-fg"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 rounded-control text-faint hover:text-fg"
          aria-label={show ? "Hide token" : "Show token"}
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {children}
      <button
        type="submit"
        disabled={loading || !pat.trim()}
        className={cn(
          "mt-1 w-full h-[46px] inline-flex items-center justify-center gap-2 rounded-[12px] text-sm font-semibold transition-colors duration-100",
          primary ? "bg-primary text-white hover:brightness-110" : "bg-surface border border-control text-fg hover:bg-raised",
          "disabled:cursor-not-allowed disabled:text-disabled disabled:brightness-100",
        )}
      >
        {loading ? (
          <>
            <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" aria-hidden="true" />
            Checking token…
          </>
        ) : "Sign in with token"}
      </button>
    </form>
  );
}
