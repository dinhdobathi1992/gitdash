"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, FetchError } from "@/lib/swr";
import { Breadcrumb } from "@/components/Sidebar";
import StatCard from "@/components/StatCard";
import { formatCurrency } from "@/lib/cost";
import type {
  CostAnalysisResponse,
  SkuBreakdown,
} from "@/app/api/github/billing/cost-analysis/route";
import type { GitHubOrg } from "@/lib/github";
import {
  AlertCircle,
  ExternalLink,
  DollarSign,
  TrendingUp,
  Clock,
  Server,
  Gauge,
  Building2,
  Info,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Month navigation helpers ─────────────────────────────────────────────────

function prevMonth(year: number, month: number): { year: number; month: number } {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

function nextMonth(year: number, month: number): { year: number; month: number } {
  if (month === 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ── Burn Rate Progress Bar ───────────────────────────────────────────────────

function BurnRateBar({
  progress,
  status,
}: {
  progress: number;
  status: "ok" | "warning" | "critical";
}) {
  const pct = Math.min(100, Math.round(progress * 100));

  const barColor =
    status === "critical"
      ? "bg-red-500"
      : status === "warning"
        ? "bg-amber-500"
        : "bg-violet-500";

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-slate-400">
        <span>Month progress: {pct}%</span>
        <span>Days elapsed</span>
      </div>
      <div className="h-2 w-full bg-slate-700 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── SKU Breakdown Table ──────────────────────────────────────────────────────

function SkuTable({ skus }: { skus: SkuBreakdown[] }) {
  if (skus.length === 0) {
    return (
      <div className="text-sm text-slate-500 text-center py-6">
        No Actions usage data for this period.
      </div>
    );
  }

  const totalMinutes = skus.reduce((s, x) => s + x.minutes, 0);
  const totalGross = skus.reduce((s, x) => s + x.gross_amount, 0);
  const totalDiscount = skus.reduce((s, x) => s + x.discount_amount, 0);
  const totalNet = skus.reduce((s, x) => s + x.net_amount, 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700/50">
            <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider py-3 px-4">
              SKU / Runner
            </th>
            <th className="text-right text-xs font-medium text-slate-400 uppercase tracking-wider py-3 px-4">
              Minutes
            </th>
            <th className="text-right text-xs font-medium text-slate-400 uppercase tracking-wider py-3 px-4">
              Price/Unit
            </th>
            <th className="text-right text-xs font-medium text-slate-400 uppercase tracking-wider py-3 px-4">
              Gross
            </th>
            <th className="text-right text-xs font-medium text-slate-400 uppercase tracking-wider py-3 px-4">
              Discount
            </th>
            <th className="text-right text-xs font-medium text-slate-400 uppercase tracking-wider py-3 px-4">
              Net
            </th>
            <th className="text-right text-xs font-medium text-slate-400 uppercase tracking-wider py-3 px-4">
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          {skus.map((row) => {
            const share =
              totalMinutes > 0
                ? Math.round((row.minutes / totalMinutes) * 100)
                : 0;

            return (
              <tr
                key={row.sku}
                className="border-b border-slate-700/30 hover:bg-slate-800/40 transition-colors"
              >
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg border bg-slate-500/10 border-slate-500/20">
                      <Server className="w-3.5 h-3.5 text-slate-400" />
                    </span>
                    <div>
                      <span className="text-white font-medium">{row.label}</span>
                      <span className="ml-2 text-[10px] font-mono text-slate-500">
                        {row.sku}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="text-right py-3 px-4 text-white tabular-nums font-mono">
                  {row.minutes.toLocaleString()}
                </td>
                <td className="text-right py-3 px-4 text-slate-400 tabular-nums font-mono text-xs">
                  {row.price_per_unit > 0
                    ? `$${row.price_per_unit.toFixed(4)}/${row.unit_type}`
                    : "—"}
                </td>
                <td className="text-right py-3 px-4 text-slate-300 tabular-nums font-mono">
                  {formatCurrency(row.gross_amount)}
                </td>
                <td className="text-right py-3 px-4 text-green-400 tabular-nums font-mono">
                  {row.discount_amount > 0
                    ? `-${formatCurrency(row.discount_amount)}`
                    : "—"}
                </td>
                <td className="text-right py-3 px-4 text-white tabular-nums font-mono font-semibold">
                  {formatCurrency(row.net_amount)}
                </td>
                <td className="text-right py-3 px-4">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-violet-500"
                        style={{ width: `${share}%` }}
                      />
                    </div>
                    <span className="text-slate-400 tabular-nums text-xs w-8 text-right">
                      {share}%
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-600/50">
            <td className="py-3 px-4 text-sm font-semibold text-white">Total</td>
            <td className="text-right py-3 px-4 text-white tabular-nums font-mono font-semibold">
              {totalMinutes.toLocaleString()}
            </td>
            <td className="text-right py-3 px-4 text-slate-500">—</td>
            <td className="text-right py-3 px-4 text-slate-300 tabular-nums font-mono font-semibold">
              {formatCurrency(totalGross)}
            </td>
            <td className="text-right py-3 px-4 text-green-400 tabular-nums font-mono font-semibold">
              {totalDiscount > 0 ? `-${formatCurrency(totalDiscount)}` : "—"}
            </td>
            <td className="text-right py-3 px-4 text-white tabular-nums font-mono font-semibold">
              {formatCurrency(totalNet)}
            </td>
            <td className="text-right py-3 px-4 text-slate-400">100%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

const now = new Date();
const DEFAULT_YEAR = now.getFullYear();
const DEFAULT_MONTH = now.getMonth() + 1;

export default function CostAnalyticsPage() {
  const [org, setOrg] = useState<string>("");
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [month, setMonth] = useState(DEFAULT_MONTH);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Load the user's orgs from the same endpoint used by the sidebar
  const { data: orgs } = useSWR<GitHubOrg[]>("/api/github/orgs", fetcher<GitHubOrg[]>);

  // Derive active org: user pick OR first available — no useEffect needed
  const activeOrg = org || orgs?.[0]?.login || "";

  // Only fetch when an org is resolved
  const key = activeOrg
    ? `/api/github/billing/cost-analysis?year=${year}&month=${month}&org=${encodeURIComponent(activeOrg)}`
    : null;

  const { data, error, isLoading } = useSWR<CostAnalysisResponse>(
    key,
    fetcher<CostAnalysisResponse>,
    { revalidateOnFocus: false }
  );

  const isPermissionError = error instanceof FetchError && error.status === 403;
  const isNotFound = error instanceof FetchError && error.status === 404;

  const selectedOrg = orgs?.find((o) => o.login === activeOrg) ?? null;

  const goPrev = () => {
    const p = prevMonth(year, month);
    setYear(p.year);
    setMonth(p.month);
  };

  const goNext = () => {
    const n = nextMonth(year, month);
    const isCurrentOrFuture =
      n.year > DEFAULT_YEAR ||
      (n.year === DEFAULT_YEAR && n.month > DEFAULT_MONTH);
    if (isCurrentOrFuture) return;
    setYear(n.year);
    setMonth(n.month);
  };

  const isCurrentMonth = year === DEFAULT_YEAR && month === DEFAULT_MONTH;

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <Breadcrumb
        items={[
          { label: "Repositories", href: "/" },
          { label: "Cost Analytics" },
        ]}
      />

      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Cost Analytics</h1>
        <p className="text-sm text-slate-400">
          Actual GitHub Actions spend from the Enhanced Billing API — requires a
          fine-grained PAT with Administration (read) org permission.
        </p>
      </div>

      {/* Controls: org dropdown + period */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 space-y-3">

        {/* Org dropdown */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-400 shrink-0">
            <Building2 className="w-4 h-4" />
            <span>Organization:</span>
          </div>

          {orgs === undefined ? (
            // Loading skeleton
            <div className="h-9 w-48 bg-slate-700/50 rounded-lg animate-pulse" />
          ) : orgs.length === 0 ? (
            <span className="text-sm text-slate-500 italic">
              No organizations found — add your GitHub org to see billing data.
            </span>
          ) : (
            <div className="relative">
              <button
                onClick={() => setDropdownOpen((v) => !v)}
                className="flex items-center gap-2.5 px-3 py-2 bg-slate-900/60 border border-slate-700 hover:border-slate-500 rounded-lg text-sm text-slate-100 transition-colors min-w-[200px]"
              >
                {selectedOrg ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={selectedOrg.avatar_url}
                      alt={selectedOrg.login}
                      width={16}
                      height={16}
                      className="w-4 h-4 rounded-sm shrink-0"
                    />
                    <span className="font-mono flex-1 text-left">{selectedOrg.login}</span>
                  </>
                ) : (
                  <span className="flex-1 text-left text-slate-500">Select organization…</span>
                )}
                <ChevronDown className={cn("w-3.5 h-3.5 text-slate-400 transition-transform", dropdownOpen && "rotate-180")} />
              </button>

              {dropdownOpen && (
                <div className="absolute left-0 top-full mt-1 w-full min-w-[220px] bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 py-1">
                  {orgs.map((o) => (
                    <button
                      key={o.login}
                      onClick={() => { setOrg(o.login); setDropdownOpen(false); }}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left",
                        activeOrg === o.login
                          ? "text-white bg-slate-700/50"
                          : "text-slate-300 hover:text-white hover:bg-slate-700/30"
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={o.avatar_url}
                        alt={o.login}
                        width={16}
                        height={16}
                        className="w-4 h-4 rounded-sm shrink-0"
                      />
                      <span className="font-mono truncate">{o.login}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-400 shrink-0">
            <Tag className="w-4 h-4" />
            <span>Period:</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={goPrev}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 py-1 text-sm font-medium text-white bg-slate-900/60 border border-slate-700 rounded-lg min-w-[130px] text-center">
              {MONTH_NAMES[month - 1]} {year}
            </span>
            <button
              onClick={goNext}
              disabled={isCurrentMonth}
              className={cn(
                "p-1.5 rounded-lg transition-colors",
                isCurrentMonth
                  ? "text-slate-600 cursor-not-allowed"
                  : "text-slate-400 hover:text-white hover:bg-slate-700"
              )}
              aria-label="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          {isCurrentMonth && (
            <span className="text-xs text-slate-500">Current month</span>
          )}
        </div>
      </div>

      {/* No org selected */}
      {!org && orgs && orgs.length > 0 && (
        <div className="flex items-center gap-2 p-4 bg-slate-800/40 border border-slate-700/40 rounded-xl text-sm text-slate-400">
          <Building2 className="w-4 h-4 shrink-0" />
          Select an organization above to view its Actions billing data.
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 animate-pulse"
              >
                <div className="h-3 w-20 bg-slate-700 rounded mb-3" />
                <div className="h-6 w-16 bg-slate-700 rounded" />
              </div>
            ))}
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-6 animate-pulse">
            <div className="h-4 w-40 bg-slate-700 rounded mb-4" />
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-8 bg-slate-700 rounded" />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Permission error — fine-grained PAT required */}
      {isPermissionError && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-6 space-y-3">
          <div className="flex items-center gap-2 text-amber-400">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="font-semibold">Insufficient billing permissions</span>
          </div>
          <p className="text-sm text-slate-400 leading-relaxed">
            The GitHub Enhanced Billing API requires a{" "}
            <strong className="text-slate-300">fine-grained PAT</strong> with
            the <code className="text-slate-300 bg-slate-800 px-1 rounded">Administration</code>{" "}
            organization permission (read). Classic PATs with{" "}
            <code className="text-slate-300 bg-slate-800 px-1 rounded">admin:org</code> are{" "}
            <strong className="text-red-400">not supported</strong> by this API.
          </p>
          <div className="space-y-2 text-sm text-slate-400">
            <p className="font-medium text-slate-300">To fix this:</p>
            <ol className="list-decimal list-inside space-y-1 pl-1">
              <li>
                Go to{" "}
                <a
                  href="https://github.com/settings/personal-access-tokens/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-violet-400 hover:text-violet-300"
                >
                  github.com/settings/personal-access-tokens/new
                </a>{" "}
                and create a <strong>Fine-grained token</strong>
              </li>
              <li>
                Under <em>Repository access</em>, select your org
              </li>
              <li>
                Under <em>Organization permissions</em>, set{" "}
                <code className="text-slate-300 bg-slate-800 px-1 rounded">Administration</code>{" "}
                → <strong>Read-only</strong>
              </li>
              <li>Go to Settings and re-enter your new token</li>
            </ol>
          </div>
          {activeOrg && (
            <a
              href={`https://github.com/organizations/${activeOrg}/settings/billing`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-300 transition-colors"
            >
              View org billing on GitHub <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      )}

      {/* Not found — most likely insufficient PAT permissions (GitHub returns 404 for both) */}
      {isNotFound && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="font-semibold">
              Your API key does not have enough permission for{" "}
              <code className="font-mono bg-red-500/10 px-1.5 py-0.5 rounded text-red-300">
                {activeOrg || "this organization"}
              </code>
            </span>
          </div>

          <p className="text-sm text-slate-400 leading-relaxed">
            GitHub returned <code className="text-slate-300 bg-slate-800 px-1 rounded">404</code> for the
            Enhanced Billing API. This almost always means your current PAT does{" "}
            <strong className="text-red-400">not</strong> have the{" "}
            <code className="text-slate-300 bg-slate-800 px-1 rounded">Administration</code> organization
            permission (read) scoped to{" "}
            <code className="text-slate-300 bg-slate-800 px-1 rounded">{activeOrg}</code>.
            GitHub hides the resource entirely rather than returning 403.
          </p>

          <div className="space-y-2 text-sm text-slate-400">
            <p className="font-medium text-slate-300">To fix this:</p>
            <ol className="list-decimal list-inside space-y-1.5 pl-1">
              <li>
                Go to{" "}
                <a
                  href="https://github.com/settings/personal-access-tokens/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-violet-400 hover:text-violet-300 underline underline-offset-2"
                >
                  github.com/settings/personal-access-tokens/new
                </a>{" "}
                and create a <strong className="text-slate-300">Fine-grained token</strong>
              </li>
              <li>
                Under <em>Resource owner</em>, select{" "}
                <code className="text-slate-300 bg-slate-800 px-1 rounded">{activeOrg}</code>
              </li>
              <li>
                Under <em>Organization permissions</em> → set{" "}
                <code className="text-slate-300 bg-slate-800 px-1 rounded">Administration</code> →{" "}
                <strong className="text-slate-300">Read-only</strong>
              </li>
              <li>Go to GitDash Settings and replace your current PAT with the new one</li>
            </ol>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-1">
            <a
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 rounded-lg text-sm text-violet-300 transition-colors"
            >
              Create new fine-grained PAT <ExternalLink className="w-3.5 h-3.5" />
            </a>
            {activeOrg && (
              <a
                href={`https://github.com/organizations/${activeOrg}/settings/billing`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-300 transition-colors"
              >
                View org billing on GitHub <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          <p className="text-[11px] text-slate-600 border-t border-slate-700/40 pt-3">
            If your PAT is correct and you are a billing admin, the org may not be on the{" "}
            GitHub Enhanced Billing Platform (requires Team or Enterprise plan).{" "}
            {activeOrg && (
              <a
                href={`https://github.com/organizations/${activeOrg}/settings/billing/platform`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-500 hover:text-slate-400 underline underline-offset-2"
              >
                Enable Enhanced Billing for {activeOrg}
              </a>
            )}
          </p>
        </div>
      )}

      {/* Generic error */}
      {error && !isPermissionError && !isNotFound && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6">
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span className="font-medium">
              {error.message ?? "Failed to load cost analysis"}
            </span>
          </div>
        </div>
      )}

      {/* Data loaded */}
      {data && !isLoading && (
        <>
          {/* ── Organization context banner ─────────────────────────────── */}
          <div className="flex items-center gap-3 px-4 py-3 bg-violet-500/8 border border-violet-500/20 rounded-xl">
            {selectedOrg && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selectedOrg.avatar_url}
                alt={selectedOrg.login}
                width={28}
                height={28}
                className="w-7 h-7 rounded-lg shrink-0"
              />
            )}
            {!selectedOrg && <Building2 className="w-5 h-5 text-violet-400 shrink-0" />}
            <div>
              <p className="text-xs text-violet-400/70 uppercase tracking-wider font-medium">Organization</p>
              <p className="text-sm font-semibold text-white font-mono">{data.login}</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-xs text-slate-500 uppercase tracking-wider">Period</p>
              <p className="text-sm font-medium text-slate-300">
                {MONTH_NAMES[data.period.month - 1]} {data.period.year}
              </p>
            </div>
          </div>

          {/* Summary stat cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard
              label="Net Billed Amount"
              value={formatCurrency(data.total_net_amount)}
              sub={
                data.total_discount_amount > 0
                  ? `${formatCurrency(data.total_discount_amount)} discounted`
                  : "No discounts applied"
              }
              icon={DollarSign}
              iconColor="text-green-400"
            />
            <StatCard
              label="Total Minutes"
              value={data.total_minutes.toLocaleString()}
              sub={`Gross ${formatCurrency(data.total_gross_amount)}`}
              icon={Clock}
              iconColor="text-blue-400"
            />
            <StatCard
              label="Daily Burn Rate"
              value={`${data.burn_rate.daily_burn_rate.toLocaleString()} min`}
              sub={`Day ${data.burn_rate.days_elapsed} of ${data.burn_rate.days_total}`}
              icon={TrendingUp}
              iconColor="text-amber-400"
            />
            <StatCard
              label="Projected EOM"
              value={data.burn_rate.projected_minutes.toLocaleString()}
              sub={`${MONTH_NAMES[data.period.month - 1]} ${data.period.year}`}
              icon={Gauge}
              iconColor={
                data.burn_rate.status === "critical"
                  ? "text-red-400"
                  : data.burn_rate.status === "warning"
                    ? "text-amber-400"
                    : "text-green-400"
              }
            />
          </div>

          {/* Burn Rate Projection */}
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Monthly Burn Rate &amp; Projection
                </h2>
                <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> {data.login}
                </p>
              </div>
              {data.burn_rate.status !== "ok" && (
                <span
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs font-medium border",
                    data.burn_rate.status === "critical"
                      ? "bg-red-500/10 border-red-500/20 text-red-400"
                      : "bg-amber-500/10 border-amber-500/20 text-amber-400"
                  )}
                >
                  {data.burn_rate.status === "critical"
                    ? "High burn rate"
                    : "Moderate burn rate"}
                </span>
              )}
            </div>

            <BurnRateBar
              progress={data.burn_rate.progress}
              status={data.burn_rate.status}
            />

            {/* Projection details */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-slate-900/40 border border-slate-700/40 rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                  Current Minutes
                </p>
                <p className="text-sm font-semibold text-white tabular-nums">
                  {data.burn_rate.current_minutes.toLocaleString()} min
                </p>
              </div>
              <div className="bg-slate-900/40 border border-slate-700/40 rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                  Projected EOM
                </p>
                <p className="text-sm font-semibold text-white tabular-nums">
                  {data.burn_rate.projected_minutes.toLocaleString()} min
                </p>
              </div>
              <div className="bg-slate-900/40 border border-slate-700/40 rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                  Net Billed
                </p>
                <p className="text-sm font-semibold text-white tabular-nums">
                  {formatCurrency(data.total_net_amount)}
                </p>
              </div>
              <div className="bg-slate-900/40 border border-slate-700/40 rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                  Total Discounts
                </p>
                <p
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    data.total_discount_amount > 0
                      ? "text-green-400"
                      : "text-slate-500"
                  )}
                >
                  {data.total_discount_amount > 0
                    ? `-${formatCurrency(data.total_discount_amount)}`
                    : "None"}
                </p>
              </div>
            </div>
          </div>

          {/* SKU Breakdown Table */}
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-white">
                Usage by SKU
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Actual cost breakdown per runner SKU from the GitHub Enhanced
                Billing API
              </p>
            </div>
            <SkuTable skus={data.skus} />
          </div>

          {/* Info: API requirements */}
          <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-300">
                About this data
              </h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Costs shown are real billed amounts from GitHub&apos;s{" "}
              <strong className="text-slate-300">Enhanced Billing API</strong>{" "}
              — not estimates. This includes gross charges, any discounts
              (enterprise agreements, credits), and the final net amount
              charged. Data requires a fine-grained PAT with{" "}
              <code className="text-slate-300 bg-slate-800 px-1 rounded">
                Administration
              </code>{" "}
              org permission and an org on the Enhanced Billing Platform
              (GitHub Team / Enterprise).
            </p>
            <a
              href="https://docs.github.com/en/rest/billing/usage"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
            >
              GitHub Enhanced Billing API docs{" "}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </>
      )}
    </div>
  );
}
