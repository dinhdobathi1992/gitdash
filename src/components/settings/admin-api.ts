"use client";

/**
 * Client for the organization-mode admin API (/api/admin/*), shared by the
 * Settings access, members and audit sections. Shapes follow the API routes.
 */

import useSWR from "swr";
import { fetcher } from "@/lib/swr";

export interface AdminUser {
  github_id: number;
  login: string;
  avatar_url: string | null;
  last_seen_at: string;
  first_seen_at?: string;
  groups: string[];
  isBootstrapAdmin: boolean;
}

export interface PermissionsResponse {
  groups: string[];
  flags: string[];
  grants: Record<string, string[]>;
  enforce: boolean;
}

export interface AuditEntry {
  id: number;
  actor_login: string | null;
  actor_github_id: number;
  action: string;
  target: string;
  /** Account links store `before_primary` / `after_primary` instead. */
  details: { before?: unknown; after?: unknown; before_primary?: unknown; after_primary?: unknown } | null;
  created_at: string;
}

export async function adminPut(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return { ok: true };
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: j.error ?? `HTTP ${res.status}` };
}

/** `enabled` false skips the request (non-admins must not call admin routes). */
export function useAdminUsers(q = "", enabled = true) {
  return useSWR<{ users: AdminUser[] }>(enabled ? `/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}` : null, fetcher, { dedupingInterval: 0 });
}

export function usePermissions() {
  return useSWR<PermissionsResponse>("/api/admin/permissions", fetcher, { dedupingInterval: 0 });
}

export function useAudit() {
  return useSWR<{ entries: AuditEntry[] }>("/api/admin/audit?limit=50", fetcher, { dedupingInterval: 0 });
}
