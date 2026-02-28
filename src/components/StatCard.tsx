"use client";

import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: LucideIcon;
  iconColor?: string;
}

export default function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  iconColor = "text-violet-400",
}: StatCardProps) {
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
          {label}
        </span>
        {Icon && (
          <span className={cn("p-1.5 rounded-lg bg-slate-700/50", iconColor)}>
            <Icon className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
      <div>
        <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}
