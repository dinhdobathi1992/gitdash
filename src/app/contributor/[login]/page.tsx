"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { Breadcrumb } from "@/components/Sidebar";
import { ContributorKpiCards, ContributorKpiSkeleton } from "@/components/ContributorKpiCards";
import { ContributorActivityHeatmap } from "@/components/ContributorActivityHeatmap";
import { ContributorPrFunnel } from "@/components/ContributorPrFunnel";
import PartialDataBadge from "@/components/PartialDataBadge";
import type { ContributorProfileResponse } from "@/app/api/github/contributor-profile/route";
import {
  AlertCircle, ExternalLink, MapPin, Building2, ChevronRight,
  GitPullRequest, GitCommit, Code, Clock, Moon, Calendar, MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "@/components/charts";

// ── Tooltip style ─────────────────────────────────────────────────────────────
const TOOLTIP_STYLE = {
  contentStyle: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { color: "#94a3b8", marginBottom: 4 },
};

// ── Section card ──────────────────────────────────────────────────────────────
function SectionCard({
  title,
  subtitle,
  icon: Icon,
  children,
}: {
  title: string;
  subtitle: string;
  icon?: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="flex items-center gap-2 mb-0.5">
        {Icon && <Icon className="w-4 h-4 text-slate-500" />}
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <p className="text-xs text-slate-500 mb-4">{subtitle}</p>
      {children}
    </div>
  );
}

// ── Weekly commit sparkline ───────────────────────────────────────────────────
function WeeklyCommitChart({
  weeks,
}: {
  weeks: { week_start: string; count: number }[];
}) {
  const data = weeks.map((w) => ({
    label: new Date(w.week_start + "T12:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    Commits: w.count,
  }));

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: "#64748b", fontSize: 9 }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: "#64748b", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={24}
          allowDecimals={false}
        />
        <Tooltip
          {...TOOLTIP_STYLE}
          formatter={(val) => [val ?? 0, "Commits"]}
        />
        <Bar dataKey="Commits" radius={[3, 3, 0, 0]} fill="#7c3aed" />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Commit hour distribution ──────────────────────────────────────────────────
function CommitHourChart({ hours }: { hours: number[] }) {
  const data = hours.map((count, h) => ({
    hour: `${h}:00`,
    Commits: count,
  }));

  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
        <XAxis
          dataKey="hour"
          tick={{ fill: "#64748b", fontSize: 8 }}
          axisLine={false}
          tickLine={false}
          interval={3}
        />
        <YAxis
          tick={{ fill: "#64748b", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={24}
          allowDecimals={false}
        />
        <Tooltip
          {...TOOLTIP_STYLE}
          formatter={(val) => [val ?? 0, "Commits"]}
        />
        <Bar dataKey="Commits" radius={[2, 2, 0, 0]} fill="#0891b2" />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Languages list ────────────────────────────────────────────────────────────
function LanguageList({ languages }: { languages: { name: string; count: number }[] }) {
  if (languages.length === 0) {
    return <p className="text-sm text-slate-600 italic">No language data</p>;
  }
  const max = Math.max(...languages.map((l) => l.count), 1);
  return (
    <div className="space-y-2">
      {languages.map((lang) => (
        <div key={lang.name} className="flex items-center gap-3">
          <span className="text-xs text-slate-300 w-20 text-right truncate">{lang.name}</span>
          <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-violet-500/70 rounded-full"
              style={{ width: `${(lang.count / max) * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-500 w-8 text-right">{lang.count}</span>
        </div>
      ))}
    </div>
  );
}

// ── Recent PRs table ──────────────────────────────────────────────────────────
function RecentPrsTable({
  prs,
}: {
  prs: ContributorProfileResponse["recent_prs"];
}) {
  if (prs.length === 0) {
    return <p className="text-sm text-slate-600 italic text-center py-6">No PRs found</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-800">
            <th className="py-2 px-3 text-left text-slate-400 font-medium">PR</th>
            <th className="py-2 px-3 text-left text-slate-400 font-medium">Repo</th>
            <th className="py-2 px-3 text-left text-slate-400 font-medium">Status</th>
            <th className="py-2 px-3 text-right text-slate-400 font-medium">Size</th>
            <th className="py-2 px-3 text-right text-slate-400 font-medium">Lead Time</th>
          </tr>
        </thead>
        <tbody>
          {prs.slice(0, 10).map((pr) => (
            <tr key={`${pr.repo_full_name}-${pr.number}`} className="border-b border-slate-800/50 hover:bg-slate-800/30">
              <td className="py-2 px-3">
                <a
                  href={`https://github.com/${pr.repo_full_name}/pull/${pr.number}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-200 hover:text-violet-300 transition-colors font-medium"
                >
                  #{pr.number}
                </a>
                <span className="text-slate-500 ml-1.5 truncate max-w-[200px] inline-block align-bottom">
                  {pr.title}
                </span>
              </td>
              <td className="py-2 px-3 text-slate-500 font-mono">{pr.repo_full_name.split("/")[1]}</td>
              <td className="py-2 px-3">
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded-full text-[10px] font-medium",
                    pr.state === "merged"
                      ? "bg-violet-500/15 text-violet-300"
                      : "bg-slate-500/15 text-slate-400"
                  )}
                >
                  {pr.state}
                </span>
              </td>
              <td className="py-2 px-3 text-right text-slate-400">
                <span className="text-green-400">+{pr.additions}</span>
                <span className="text-slate-600 mx-0.5">/</span>
                <span className="text-red-400">-{pr.deletions}</span>
              </td>
              <td className="py-2 px-3 text-right text-slate-400">
                {pr.hours_to_merge !== null
                  ? pr.hours_to_merge < 1
                    ? `${Math.round(pr.hours_to_merge * 60)}m`
                    : pr.hours_to_merge < 24
                      ? `${pr.hours_to_merge.toFixed(1)}h`
                      : `${(pr.hours_to_merge / 24).toFixed(1)}d`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="w-16 h-16 rounded-full skeleton" />
        <div className="space-y-2">
          <div className="h-6 w-40 rounded skeleton" />
          <div className="h-3 w-56 rounded skeleton" />
        </div>
      </div>
      <ContributorKpiSkeleton />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-5">
            <div className="h-4 w-32 rounded skeleton mb-2" />
            <div className="h-3 w-48 rounded skeleton mb-4" />
            <div className="h-40 rounded skeleton" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ContributorProfilePage() {
  const { login } = useParams<{ login: string }>();
  const searchParams = useSearchParams();
  const owner = searchParams.get("owner") ?? "";
  const [showPrs, setShowPrs] = useState(false);

  const { data, error, isLoading } = useSWR<ContributorProfileResponse>(
    owner && login
      ? `/api/github/contributor-profile?owner=${owner}&login=${login}`
      : null,
    fetcher<ContributorProfileResponse>,
  );

  if (!owner) {
    return (
      <div className="p-8">
        <Breadcrumb items={[{ label: "Contributors" }, { label: login }]} />
        <div className="flex items-center gap-2 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-300 text-sm">
          <AlertCircle className="w-4 h-4" />
          Missing &quot;owner&quot; query parameter. Navigate from a repo or team page.
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <Breadcrumb
        items={[
          { label: "Repositories", href: "/" },
          { label: owner, href: `/org/${owner}` },
          { label: `@${login}` },
        ]}
      />

      {/* Error */}
      {error && !isLoading && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error.message ?? "Failed to load contributor profile"}
        </div>
      )}

      {isLoading ? (
        <PageSkeleton />
      ) : data ? (
        <>
          {data.partial && (
            <PartialDataBadge fetched={data.fetched_requests} total={data.total_requests_attempted} unit="requests" />
          )}
          {/* Profile header */}
          <div className="flex items-start gap-4 flex-wrap">
            <div className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={data.avatar_url}
                alt={data.login}
                className="w-16 h-16 rounded-full border-2 border-slate-700"
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-white">
                  {data.name ?? data.login}
                </h1>
                <a
                  href={data.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-slate-400 hover:text-violet-300 transition-colors flex items-center gap-1"
                >
                  @{data.login} <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              {data.bio && (
                <p className="text-sm text-slate-400 mt-0.5">{data.bio}</p>
              )}
              <div className="flex items-center gap-4 mt-1.5 flex-wrap">
                {data.company && (
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    <Building2 className="w-3 h-3" /> {data.company}
                  </span>
                )}
                {data.location && (
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    <MapPin className="w-3 h-3" /> {data.location}
                  </span>
                )}
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <GitCommit className="w-3 h-3" /> {data.total_commits_90d} commits (90d)
                </span>
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <Code className="w-3 h-3" /> {data.repos_contributed.length} repos
                </span>
              </div>
            </div>
            <Link
              href={`/contributor/${data.login}/brief?owner=${owner}`}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-300 bg-violet-500/10 border border-violet-500/25 rounded-lg hover:bg-violet-500/20 transition-colors"
            >
              <MessageCircle className="w-3.5 h-3.5" /> 1:1 Prep Sheet
            </Link>
          </div>

          {/* KPI Cards */}
          <ContributorKpiCards data={data} />

          {/* Stat badges */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-xs text-slate-400">
                Active days/week:{" "}
                <span className="text-white font-medium">
                  {data.active_days_per_week.length > 0
                    ? (data.active_days_per_week.reduce((s, d) => s + d, 0) / data.active_days_per_week.length).toFixed(1)
                    : "0"}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50">
              <Moon className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-xs text-slate-400">
                After-hours commits:{" "}
                <span className={cn(
                  "font-medium",
                  data.after_hours_pct > 40 ? "text-amber-400" : "text-white"
                )}>
                  {data.after_hours_pct}%
                </span>
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-xs text-slate-400">
                Avg review turnaround:{" "}
                <span className="text-white font-medium">
                  {data.avg_review_turnaround_hours < 1
                    ? `${Math.round(data.avg_review_turnaround_hours * 60)}m`
                    : data.avg_review_turnaround_hours < 24
                      ? `${data.avg_review_turnaround_hours.toFixed(1)}h`
                      : `${(data.avg_review_turnaround_hours / 24).toFixed(1)}d`}
                </span>
              </span>
            </div>
          </div>

          {/* Charts grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Activity heatmap */}
            <div className="lg:col-span-2">
              <SectionCard
                title="Contribution Activity"
                subtitle="Commit activity over the last 52 weeks"
                icon={Calendar}
              >
                <ContributorActivityHeatmap calendar={data.activity_calendar} />
              </SectionCard>
            </div>

            {/* Weekly commit sparkline */}
            <SectionCard
              title="Weekly Commits"
              subtitle="Commit count per week (last 12 weeks)"
              icon={GitCommit}
            >
              <WeeklyCommitChart weeks={data.weekly_commits} />
            </SectionCard>

            {/* PR lifecycle funnel */}
            <SectionCard
              title="PR Lifecycle Funnel"
              subtitle="From opened to merged — shows conversion at each stage"
              icon={GitPullRequest}
            >
              <ContributorPrFunnel funnel={data.funnel} />
            </SectionCard>

            {/* Commit hour distribution */}
            <SectionCard
              title="Commit Hours (UTC)"
              subtitle="When commits are made — helps spot after-hours patterns"
              icon={Clock}
            >
              <CommitHourChart hours={data.commit_hour_distribution} />
            </SectionCard>

            {/* Languages */}
            <SectionCard
              title="Languages Touched"
              subtitle="Languages in repos this contributor is active in"
              icon={Code}
            >
              <LanguageList languages={data.languages} />
            </SectionCard>
          </div>

          {/* Recent PRs */}
          <div>
            <button
              onClick={() => setShowPrs((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-violet-300 transition-colors mb-2"
            >
              <ChevronRight
                className={cn("w-3.5 h-3.5 transition-transform", showPrs && "rotate-90")}
              />
              {showPrs ? "Hide" : "Show"} recent PRs ({data.recent_prs.length})
            </button>
            {showPrs && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                <RecentPrsTable prs={data.recent_prs} />
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
