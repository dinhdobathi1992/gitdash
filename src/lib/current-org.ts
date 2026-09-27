"use client";

/**
 * The organization the user is looking at. The URL wins (`/?org=x`,
 * `/org/x/...`); elsewhere the last choice is remembered so the sidebar
 * switcher and the Repositories link keep pointing at the same org.
 */

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

const KEY = "gitdash:org";
const listeners = new Set<() => void>();

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
}

export function rememberOrg(org: string | null) {
  try {
    if (org) localStorage.setItem(KEY, org);
    else localStorage.removeItem(KEY);
  } catch {
    return;
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** null = personal repositories. */
export function useCurrentOrg(): string | null {
  const path = usePathname();
  const params = useSearchParams();
  const stored = useSyncExternalStore(subscribe, readStored, () => null);
  const { user } = useAuth();

  const fromPath = path.match(/^\/org\/([^/]+)/)?.[1];
  // A repository page belongs to its owner's org, unless the owner is you.
  const repoOwner = path.match(/^\/repos\/([^/]+)/)?.[1];
  let org: string | null;
  if (fromPath) org = decodeURIComponent(fromPath);
  else if (repoOwner) org = user && decodeURIComponent(repoOwner) === user.login ? null : decodeURIComponent(repoOwner);
  else if (path === "/") org = params.get("org");
  else org = stored;

  // Keep the remembered org in step with what the URL says.
  useEffect(() => {
    if ((path === "/" || fromPath) && org !== stored) rememberOrg(org);
  }, [path, fromPath, org, stored]);

  return org;
}

export function reposHref(org: string | null): string {
  return org ? `/?org=${encodeURIComponent(org)}` : "/";
}
