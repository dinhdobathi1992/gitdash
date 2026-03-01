"use client";

import { useState } from "react";
import { Eye, EyeOff, ExternalLink, Key, CheckCircle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export default function SetupPage() {
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
      // Hard-navigate to flush the stale SWR cache (AuthProvider cached a 401
      // from /api/auth/me while we were on the setup page with no session yet).
      window.location.href = "/";
    } catch {
      setError("Network error — could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      {/* background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-violet-600/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-24 h-24 shrink-0 rounded-3xl overflow-hidden shadow-2xl shadow-violet-500/30 mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="GitDash Logo" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">GitDash</h1>
          <p className="text-sm text-slate-400 mt-1">GitHub Actions Dashboard</p>
        </div>

        {/* card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          <div className="flex items-center gap-2 mb-1">
            <Key className="w-4 h-4 text-violet-400" />
            <h2 className="text-lg font-semibold text-white">Enter your GitHub PAT</h2>
          </div>
          <p className="text-sm text-slate-400 mb-6">
            Running in <span className="text-amber-400 font-medium">standalone mode</span>.
            Your token is stored in an encrypted session cookie — never sent to any third party.
          </p>

          {error && (
            <div className="mb-5 flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Personal Access Token
              </label>
              <div className="relative">
                <input
                  type={show ? "text" : "password"}
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  className="w-full px-3 py-2.5 pr-10 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 font-mono placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/50"
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                  aria-label={show ? "Hide token" : "Show token"}
                >
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !pat.trim()}
              className={cn(
                "w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-all",
                loading || !pat.trim()
                  ? "bg-violet-600/40 text-violet-300/50 cursor-not-allowed"
                  : "bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-500/20"
              )}
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-violet-300/40 border-t-violet-300 rounded-full animate-spin" />
                  Verifying…
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Connect GitHub
                </>
              )}
            </button>
          </form>

          {/* PAT help */}
          <div className="mt-6 pt-5 border-t border-slate-800 space-y-3 text-xs text-slate-500">
            <p className="font-medium text-slate-400">Required token scopes</p>
            <ul className="space-y-1">
              {[
                ["repo", "Read repositories and workflow runs"],
                ["workflow", "Read workflow definitions"],
                ["read:org", "Read org membership and repos"],
                ["read:user + user:email", "Read your identity"],
              ].map(([scope, desc]) => (
                <li key={scope} className="flex items-start gap-2">
                  <code className="text-violet-400 bg-slate-800 px-1 rounded shrink-0">{scope}</code>
                  <span>{desc}</span>
                </li>
              ))}
            </ul>
            <p className="font-medium text-slate-400 pt-1">Cost Analytics</p>
            <p>
              Requires a separate{" "}
              <strong className="text-slate-300">fine-grained PAT</strong> with{" "}
              <code className="text-violet-400 bg-slate-800 px-1 rounded">Administration</code>{" "}
              org permission (read). Classic PATs do not support the Enhanced
              Billing API.
            </p>
            <a
              href="https://github.com/settings/tokens/new?scopes=repo,workflow,read:org,read:user,user:email"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300 transition-colors"
            >
              Generate classic token on GitHub <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* PAT security section */}
          <div className="mt-4 pt-5 border-t border-slate-800">
            <p className="text-xs font-medium text-slate-400 mb-2">How this application handles your PAT</p>
            <p className="text-xs text-slate-500 mb-2">
              Your token is encrypted inside a server-side session cookie and never stored on disk,
              logged, or forwarded to any third party. Every GitHub API call is made server-side
              using your token — the raw value is never exposed to the browser.
            </p>
            <a
              href="https://github.com/dinhdobathi1992/gitdash?tab=readme-ov-file#-your-pat-is-yours--we-protect-it-like-its-gold"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
            >
              Read our full PAT security policy <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        <div className="text-xs text-slate-600 text-center mt-6 space-y-1">
          <p>Standalone mode · self-hosted GitHub Actions dashboard</p>
          <p>MIT License · Made by <span className="text-slate-500">Dinh Do Ba Thi</span></p>
        </div>
      </div>
    </div>
  );
}
