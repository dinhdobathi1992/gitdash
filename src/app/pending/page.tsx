"use client";

import { useEffect } from "react";
import { Clock, LogOut } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

const POLL_MS = 15_000;

/**
 * Organization mode: the account is signed in but belongs to no group yet.
 * Polls /api/auth/me and moves on as soon as an admin assigns a group.
 */
export default function PendingPage() {
  const { user, groups, refresh } = useAuth();

  useEffect(() => {
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (groups.length > 0) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/";
    }
  }, [groups]);

  return (
    <div className="min-h-screen bg-ground page-glow flex items-center justify-center p-6">
      <div className="max-w-md w-full card !rounded-panel p-8 text-center space-y-5">
        {user?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatar_url} alt="" width={56} height={56} className="w-14 h-14 rounded-full mx-auto bg-raised" />
        ) : (
          <div className="w-14 h-14 rounded-full mx-auto bg-raised" />
        )}
        <div className="space-y-2">
          {user && <p className="font-mono text-sm text-muted">@{user.login}</p>}
          <h1 className="text-[22px] font-semibold text-fg">Waiting for access</h1>
          <p className="text-sm text-muted">
            Your account has no GitDash access yet. Ask an admin to add you to a group.
          </p>
        </div>
        <p className="flex items-center justify-center gap-1.5 text-xs text-faint">
          <Clock className="w-3.5 h-3.5" aria-hidden="true" /> Checking again every 15 seconds
        </p>
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="inline-flex items-center gap-2 h-9 px-3.5 text-[13px] font-semibold rounded-control border border-control bg-surface text-fg hover:bg-raised transition-colors"
          >
            <LogOut className="w-4 h-4 text-muted" aria-hidden="true" /> Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
