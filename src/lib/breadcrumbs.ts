"use client";

/**
 * Breadcrumbs for the top bar, derived from the path. Pages whose URL holds
 * an id (a workflow) publish a readable leaf via useCrumbLabel().
 */

import { useEffect, useSyncExternalStore } from "react";

export interface Crumb {
  label: string;
  href?: string;
  mono?: boolean;
}

const labels = new Map<string, string>();
let version = 0;
const listeners = new Set<() => void>();

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Publish a readable label for a path segment (e.g. a workflow id → its name). */
export function useCrumbLabel(segment: string | undefined, label: string | undefined) {
  useEffect(() => {
    if (!segment || !label) return;
    labels.set(segment, label);
    version++;
    for (const l of listeners) l();
  }, [segment, label]);
}

export function useCrumbVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

const TOP: Record<string, string> = {
  team: "Team insights",
  "cost-analytics": "Cost",
  reports: "Reports",
  alerts: "Alerts",
  docs: "Docs",
  settings: "Settings",
  setup: "Setup",
};

const REPO_TABS: Record<string, string> = {
  team: "Team",
  issues: "Issues",
  security: "Security",
  audit: "Audit trail",
  pulls: "Pull requests",
  workflows: "Workflows",
};

export function crumbsFor(path: string, org: string | null, settingsSection?: string | null): Crumb[] {
  const root: Crumb = { label: org ?? "Personal", href: org ? `/?org=${encodeURIComponent(org)}` : "/" };
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) return [root, { label: "Repositories" }];

  const [first, ...rest] = parts;
  if (first === "repos" && rest.length >= 2) {
    const [owner, repo, section, id] = rest;
    const out: Crumb[] = [
      { label: owner, href: `/?org=${encodeURIComponent(owner)}` },
      { label: "Repositories", href: `/?org=${encodeURIComponent(owner)}` },
    ];
    const repoHref = `/repos/${owner}/${repo}`;
    if (!section) return [...out, { label: repo, mono: true }];
    out.push({ label: repo, href: repoHref, mono: true });
    if (section === "workflows" && id) {
      out.push({ label: labels.get(id) ?? `Workflow ${id}`, mono: true });
    } else {
      out.push({ label: REPO_TABS[section] ?? section });
    }
    return out;
  }
  if (first === "org" && rest[0]) {
    const o = rest[0];
    const base: Crumb = { label: o, href: `/?org=${encodeURIComponent(o)}` };
    if (rest[1] === "health") return [base, { label: "Health scorecard" }];
    return [base, { label: "Overview" }];
  }
  if (first === "contributor" && rest[0]) {
    const c: Crumb[] = [root, { label: "Team insights", href: "/team" }];
    if (rest[1] === "brief") return [...c, { label: rest[0], href: `/contributor/${rest[0]}`, mono: true }, { label: "Brief" }];
    return [...c, { label: rest[0], mono: true }];
  }
  if (first === "settings" && settingsSection) {
    return [root, { label: "Settings", href: "/settings" }, { label: settingsSection }];
  }
  return [root, { label: TOP[first] ?? first }];
}
