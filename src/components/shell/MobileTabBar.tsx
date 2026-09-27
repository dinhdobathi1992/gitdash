"use client";

/**
 * Phone bottom tab bar (< 640 px) — design `Mobile` artboard:
 * Repos · Alerts · Team · More. "More" opens the navigation drawer.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, LayoutGrid, Menu, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { isActive } from "@/components/shell/nav-config";
import { useAlerts } from "@/lib/use-alerts";
import { useCurrentOrg, reposHref } from "@/lib/current-org";

export default function MobileTabBar({ onMore }: { onMore: () => void }) {
  const path = usePathname();
  const org = useCurrentOrg();
  const { firing } = useAlerts();
  const tabs = [
    { href: reposHref(org), match: "/", label: "Repos", icon: LayoutGrid },
    { href: "/alerts", match: "/alerts", label: "Alerts", icon: Bell, badge: firing.length },
    { href: "/team", match: "/team", label: "Team", icon: Users },
  ];
  return (
    <nav
      aria-label="Primary"
      className="sm:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-4 border-t border-line bg-panel/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
    >
      {tabs.map((t) => {
        const active = isActive(t.match, path);
        const Icon = t.icon;
        return (
          <Link
            key={t.label}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn("relative flex flex-col items-center justify-center gap-1 h-16 text-xs font-medium", active ? "text-fg" : "text-muted")}
          >
            <span className="relative">
              <Icon className={cn("w-6 h-6", active ? "text-brand-fg" : "text-muted")} strokeWidth={1.75} aria-hidden="true" />
              {!!t.badge && (
                <span className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-status-fail text-[#14102B] text-xs font-bold flex items-center justify-center">
                  {t.badge}
                </span>
              )}
            </span>
            {t.label}
            {!!t.badge && <span className="sr-only">, {t.badge} firing</span>}
          </Link>
        );
      })}
      <button type="button" onClick={onMore} className="flex flex-col items-center justify-center gap-1 h-16 text-xs font-medium text-muted">
        <Menu className="w-6 h-6" strokeWidth={1.75} aria-hidden="true" />
        More
      </button>
    </nav>
  );
}
