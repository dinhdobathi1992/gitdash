"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, LogOut, RefreshCw } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { AuthBackdrop } from "@/components/auth/AuthLayout";
import { LogoMark, shortVersion } from "@/components/shell/Logo";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

const POLL_MS = 15_000;

/**
 * Organization mode: the account is signed in but belongs to no group yet.
 * Polls /api/auth/me and moves on as soon as an admin assigns a group.
 * The server caches group lookups for up to 60 s, so a grant can take a minute to show.
 */
export default function PendingPage() {
  const { user, groups, refresh } = useAuth();
  const [checking, setChecking] = useState(false);
  const [nextAt, setNextAt] = useState(() => Date.now() + POLL_MS);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);

  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    try {
      await refresh();
    } finally {
      inFlight.current = false;
      setChecking(false);
      const t = Date.now();
      setNow(t);
      setNextAt(t + POLL_MS);
    }
  }, [refresh]);

  // One clock drives both the countdown and the automatic check.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (now >= nextAt) void check();
  }, [now, nextAt, check]);

  useEffect(() => {
    if (groups.length > 0) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/";
    }
  }, [groups]);

  const secondsLeft = Math.max(0, Math.ceil((nextAt - now) / 1_000));

  return (
    <div className="min-h-screen bg-ground overflow-hidden relative">
      <AuthBackdrop />
      <div className="relative mx-auto max-w-[1360px] px-5 sm:px-10 lg:px-[72px] py-10 lg:py-14">
        <div className="flex items-center gap-3">
          <LogoMark size={36} />
          <span className="text-lg font-semibold text-fg">GitDash</span>
          <span className="h-6 inline-flex items-center px-2 rounded-full border border-control bg-surface font-mono text-xs text-muted">
            {shortVersion()}
          </span>
        </div>

        <main className="mt-12 lg:mt-20 mx-auto w-full max-w-[520px]">
          <div className="float-card !rounded-panel p-7 sm:p-9">
            <Identity user={user} />

            <div className="mt-7">
              <span className="inline-flex items-center gap-2 h-7 px-3 rounded-full bg-status-warn-tint text-status-warn-text text-xs font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-status-warn" aria-hidden="true" />
                Pending approval
              </span>
              <h1 className="mt-3 text-[28px] leading-[34px] font-semibold tracking-[-0.02em] text-fg">Waiting for access</h1>
              <p className="mt-2 text-sm leading-[21px] text-muted">
                Your GitHub account is verified. An admin needs to add you to a group before your dashboards appear.
              </p>
            </div>

            <Steps login={user?.login} />

            {user && <AdminNote login={user.login} id={user.id} />}

            <div className="mt-7 pt-5 border-t border-line flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-faint" aria-live="polite">
                {checking ? "Checking now…" : <>Next check in <span className="font-mono text-muted">{secondsLeft}s</span></>}
              </p>
              <div className="flex items-center gap-2">
                <form action="/api/auth/logout" method="post">
                  <Button type="submit" variant="ghost" size="md">
                    <LogOut className="w-4 h-4" aria-hidden="true" /> Sign out
                  </Button>
                </form>
                <Button onClick={() => void check()} disabled={checking}>
                  <RefreshCw className={cn("w-4 h-4 text-muted", checking && "animate-spin")} aria-hidden="true" />
                  Check now
                </Button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function Identity({ user }: { user: ReturnType<typeof useAuth>["user"] }) {
  return (
    <div className="flex items-center gap-4">
      {/* Amber ring = waiting; the badge repeats it in words for screen readers. */}
      <div className="relative shrink-0">
        <span className="absolute -inset-1 rounded-full border-2 border-status-warn/70" aria-hidden="true" />
        {user?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatar_url} alt="" width={56} height={56} className="relative w-14 h-14 rounded-full bg-raised" />
        ) : (
          <div className="relative w-14 h-14 rounded-full bg-raised" />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-fg truncate">{user?.name || user?.login || "Signed in"}</p>
        {user && <p className="font-mono text-[13px] text-muted truncate">@{user.login}</p>}
      </div>
    </div>
  );
}

type StepState = "done" | "current" | "next";

function Steps({ login }: { login?: string }) {
  const steps: { state: StepState; title: string; detail: string }[] = [
    { state: "done", title: "Signed in with GitHub", detail: login ? `As @${login}` : "Identity confirmed" },
    { state: "current", title: "An admin adds you to a group", detail: "Groups decide which dashboards you can open" },
    { state: "next", title: "Your dashboards open", detail: "This page moves on by itself, usually within a minute of the grant" },
  ];
  return (
    <ol className="mt-7 space-y-0" aria-label="Access progress">
      {steps.map((s, i) => (
        <li key={s.title} className="relative flex gap-3.5 pb-5 last:pb-0">
          {i < steps.length - 1 && (
            <span
              aria-hidden="true"
              className={cn("absolute left-[11px] top-7 bottom-1 w-px", s.state === "done" ? "bg-status-pass/50" : "bg-line")}
            />
          )}
          <StepMark state={s.state} />
          <div className="min-w-0 pt-0.5">
            <p className={cn("text-sm font-semibold", s.state === "next" ? "text-muted" : "text-fg")}>
              {s.title}
              <span className="sr-only">{s.state === "done" ? " (done)" : s.state === "current" ? " (in progress)" : " (next)"}</span>
            </p>
            <p className="mt-0.5 text-[13px] leading-[18px] text-faint">{s.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function StepMark({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span className="relative z-10 shrink-0 w-6 h-6 rounded-full bg-status-pass-tint text-status-pass-text flex items-center justify-center" aria-hidden="true">
        <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="relative z-10 shrink-0 w-6 h-6 rounded-full bg-status-warn-tint flex items-center justify-center" aria-hidden="true">
        <span className="absolute inset-0 rounded-full border border-status-warn/60 animate-ping [animation-duration:2s]" />
        <span className="w-2 h-2 rounded-full bg-status-warn" />
      </span>
    );
  }
  return (
    <span className="relative z-10 shrink-0 w-6 h-6 rounded-full border border-control bg-panel flex items-center justify-center" aria-hidden="true">
      <span className="w-1.5 h-1.5 rounded-full bg-disabled" />
    </span>
  );
}

/** What the admin needs to find this account in Admin → Users. */
function AdminNote({ login, id }: { login: string; id?: number }) {
  const [copied, setCopied] = useState(false);
  const text = `Please add me to a GitDash group: @${login}${id ? ` (GitHub id ${id})` : ""}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      /* clipboard blocked: the details stay visible to copy by hand */
    }
  };

  return (
    <div className="mt-7 rounded-card border border-line bg-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-semibold text-fg">Send this to your admin</p>
        <Button size="sm" onClick={() => void copy()} aria-label={copied ? "Copied" : "Copy details for your admin"}>
          {copied ? <Check className="w-3.5 h-3.5 text-status-pass-text" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5 text-muted" aria-hidden="true" />}
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </Button>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[13px]">
        <dt className="text-faint">GitHub</dt>
        <dd className="font-mono text-fg truncate">@{login}</dd>
        {id ? (
          <>
            <dt className="text-faint">User id</dt>
            <dd className="font-mono text-fg">{id}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
