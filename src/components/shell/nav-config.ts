/**
 * Shell nav config — single source of truth for primary navigation
 * (design contract §4.1). Sidebar, mobile tab bar and the command palette
 * derive their items from here.
 */

import {
  LayoutGrid,
  Users,
  CircleDollarSign,
  BarChart3,
  Bell,
  BookOpen,
  SlidersHorizontal,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { FeatureFlags } from "@/lib/feature-flags";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shows the firing-alerts count badge. */
  badge?: "alerts";
  /**
   * Organization mode: only shown to admins, or to users granted this feature
   * flag. The server enforces the same rule; hiding just avoids dead links.
   */
  requires?: "admin" | keyof FeatureFlags;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Monitor",
    items: [
      { href: "/", label: "Repositories", icon: LayoutGrid },
      { href: "/alerts", label: "Alerts", icon: Bell, badge: "alerts" },
    ],
  },
  {
    label: "Analyze",
    items: [
      { href: "/team", label: "Team insights", icon: Users },
      { href: "/cost-analytics", label: "Cost", icon: CircleDollarSign, requires: "costAnalytics" },
      { href: "/reports", label: "Reports", icon: BarChart3 },
    ],
  },
];

export const NAV_BOTTOM: NavItem[] = [
  { href: "/docs", label: "Docs", icon: BookOpen },
  { href: "/admin", label: "Admin", icon: ShieldCheck, requires: "admin" },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal },
];

/** Items this user may open (see NavItem.requires). */
export function visibleNav(
  items: NavItem[],
  access: { isAdmin: boolean; granted: Set<keyof FeatureFlags> },
): NavItem[] {
  return items.filter((i) => {
    if (!i.requires) return true;
    if (i.requires === "admin") return access.isAdmin;
    return access.granted.has(i.requires);
  });
}

/** Every destination, flat — for the command palette and breadcrumbs. */
export const ALL_NAV: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_BOTTOM];

/** Active-state rule: "/" matches exactly, and also owns repository pages. */
export function isActive(href: string, path: string): boolean {
  if (href === "/") return path === "/" || path.startsWith("/repos/") || path.startsWith("/org/");
  return path === href || path.startsWith(href + "/");
}
