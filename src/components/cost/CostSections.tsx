"use client";

/** Cost page sections (`Cost` artboard): daily spend, top repositories, savings, SKU table. */

import { useMemo } from "react";
import { ExternalLink } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AXIS_PROPS, GRID_PROPS, TOOLTIP_PROPS, SERIES_COLORS,
} from "@/components/charts";
import type { DailySpend, RepoSpend } from "@/lib/cost-detail";
import type { SkuBreakdown } from "@/app/api/github/billing/cost-analysis/route";
import type { Saving } from "@/lib/cost-savings";
import { formatCurrency } from "@/lib/cost";
import { Card, CardHeader } from "@/components/ui/Card";

const OS = [
  { key: "linux", label: "Linux", color: SERIES_COLORS[1] },
  { key: "macos", label: "macOS", color: SERIES_COLORS[0] },
  { key: "windows", label: "Windows", color: SERIES_COLORS[2] },
  { key: "other", label: "Other", color: SERIES_COLORS[7] },
] as const;

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 })}`;

/**
 * Daily net spend stacked by runner OS. For the current month the remaining
 * days are projected from the 7-day average and drawn at 35% opacity.
 */
export function DailySpendChart({ daily, year, month, projectRest, today }: {
  daily: DailySpend[];
  year: number;
  month: number;
  projectRest: boolean;
  today: number;
}) {
  const data = useMemo(() => {
    const days = new Date(year, month, 0).getDate();
    const byDate = new Map(daily.map((d) => [d.date, d]));
    const last7 = daily.slice(-7);
    const avg = (k: keyof Omit<DailySpend, "date">) => (last7.length ? last7.reduce((s, d) => s + d[k], 0) / last7.length : 0);
    const proj = { linux: avg("linux"), macos: avg("macos"), windows: avg("windows"), other: avg("other") };
    return Array.from({ length: days }, (_, i) => {
      const date = `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
      const d = byDate.get(date);
      const future = projectRest && i + 1 > today;
      const src = future ? proj : d ?? { linux: 0, macos: 0, windows: 0, other: 0 };
      return {
        day: new Date(year, month - 1, i + 1).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        future,
        linux: src.linux, macos: src.macos, windows: src.windows, other: src.other,
      };
    });
  }, [daily, year, month, projectRest, today]);

  const present = OS.filter((o) => daily.some((d) => d[o.key] > 0));
  const total = daily.reduce((s, d) => s + d.linux + d.macos + d.windows + d.other, 0);
  const peak = daily.reduce<{ day: string; v: number } | null>((m, d) => {
    const v = d.linux + d.macos + d.windows + d.other;
    return !m || v > m.v ? { day: d.date, v } : m;
  }, null);
  const takeaway = peak
    ? `${usd(total)} spent so far; the highest day was ${new Date(peak.day + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${usd(peak.v)}.`
    : "No spend this month.";

  return (
    <Card className="p-5">
      <CardHeader
        title="Daily spend by runner"
        description={projectRest ? "Faded bars are the projection for the rest of the month" : "Net spend per day"}
        actions={present.map((o) => (
          <span key={o.key} className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-[2px]" style={{ background: o.color }} aria-hidden="true" />{o.label}
          </span>
        ))}
      />
      <div role="img" aria-label={takeaway} className="mt-4 h-[230px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barCategoryGap={5}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="day" {...AXIS_PROPS} interval="preserveStartEnd" minTickGap={60} />
            <YAxis {...AXIS_PROPS} width={48} tickFormatter={(v: number) => `$${Math.round(v)}`} />
            <Tooltip {...TOOLTIP_PROPS} formatter={(v, name) => [usd(Number(v)), String(name)]} />
            {present.map((o, idx) => (
              <Bar
                key={o.key}
                dataKey={o.key}
                name={o.label}
                stackId="spend"
                fill={o.color}
                radius={idx === present.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                shape={(props: unknown) => {
                  const p = props as { x: number; y: number; width: number; height: number; fill: string; payload: { future: boolean } };
                  if (!p.height || p.height <= 0) return <g />;
                  return <rect x={p.x} y={p.y} width={p.width} height={p.height} fill={p.fill} fillOpacity={p.payload.future ? 0.35 : 1} rx={idx === present.length - 1 ? 3 : 0} />;
                }}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function TopRepos({ repos }: { repos: RepoSpend[] }) {
  const top = repos.slice(0, 4);
  const rest = repos.slice(4);
  const restRow = rest.length
    ? { repo: `${rest.length} other repositor${rest.length === 1 ? "y" : "ies"}`, minutes: rest.reduce((s, r) => s + r.minutes, 0), net_amount: rest.reduce((s, r) => s + r.net_amount, 0), other: true }
    : null;
  const rows = [...top.map((r) => ({ ...r, other: false })), ...(restRow ? [restRow] : [])];
  const max = Math.max(1e-9, ...rows.map((r) => r.net_amount));
  return (
    <Card className="p-5">
      <CardHeader title="Where the money goes" actions={<span>Top repositories this month</span>} />
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No per-repository usage for this month.</p>
      ) : (
        <ul className="mt-2">
          {rows.map((r) => (
            <li key={r.repo} className="grid grid-cols-[minmax(0,1fr)_80px_76px] items-center gap-4 py-3 border-b border-line last:border-0">
              <span className="min-w-0">
                <span className="block font-mono text-sm font-medium text-fg truncate">{r.other ? r.repo : r.repo.split("/").pop()}</span>
                <span className="mt-2 block h-1 rounded-full bg-control overflow-hidden" aria-hidden="true">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${(r.net_amount / max) * 100}%` }} />
                </span>
              </span>
              <span className="font-mono text-[13px] text-muted text-right tabular-nums">{Math.round(r.minutes).toLocaleString()}</span>
              <span className="font-mono text-sm font-semibold text-fg text-right tabular-nums">{usd(r.net_amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function Savings({ items }: { items: Saving[] }) {
  return (
    <Card className="p-5">
      <CardHeader title="Ways to spend less" actions={<span>Estimates from this month&apos;s usage</span>} />
      {items.length === 0 ? (
        <p className="mt-4 px-4 py-3 rounded-control bg-status-pass-tint text-sm text-status-pass-text">Nothing obvious to trim this month.</p>
      ) : (
        <ul className="mt-2">
          {items.map((s) => (
            <li key={s.key} className="py-3.5 border-b border-line last:border-0">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-semibold text-fg">{s.title}</p>
                {s.monthly !== null && (
                  <span className="font-mono text-sm font-semibold text-status-pass-text whitespace-nowrap">−{usd(s.monthly)}/mo</span>
                )}
              </div>
              <p className="mt-1 text-[13px] leading-5 text-muted">{s.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function SkuTable({ skus }: { skus: SkuBreakdown[] }) {
  const totalMinutes = skus.reduce((s, x) => s + x.minutes, 0);
  const th = "h-10 px-4 text-xs font-medium text-faint";
  return (
    <section aria-labelledby="sku-title" className="card overflow-hidden">
      <div className="px-5 h-16 flex items-center border-b border-line">
        <h2 id="sku-title" className="text-[15px] font-semibold text-fg">By runner type</h2>
      </div>
      {skus.length === 0 ? (
        <p className="px-5 py-5 text-sm text-muted">No Actions usage billed for this month yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <caption className="sr-only">Actions usage by runner SKU</caption>
            <thead className="bg-panel border-b border-line">
              <tr>
                <th className={`${th} text-left pl-5`}>Runner</th>
                <th className={`${th} text-right`}>Minutes</th>
                <th className={`${th} text-right hidden md:table-cell`}>Price per minute</th>
                <th className={`${th} text-right`}>Gross</th>
                <th className={`${th} text-right`}>Discount</th>
                <th className={`${th} text-right`}>Net</th>
                <th className={`${th} text-right pr-5`}>Share of minutes</th>
              </tr>
            </thead>
            <tbody>
              {skus.map((r) => {
                const share = totalMinutes > 0 ? Math.round((r.minutes / totalMinutes) * 100) : 0;
                return (
                  <tr key={r.sku} className="border-b border-line last:border-0">
                    <td className="h-14 pl-5 pr-4">
                      <span className="block text-sm font-medium text-fg">{r.label}</span>
                      <span className="block font-mono text-xs text-faint">{r.sku}</span>
                    </td>
                    <td className="px-4 text-right font-mono text-[13px] text-fg tabular-nums">{r.minutes.toLocaleString()}</td>
                    <td className="px-4 text-right font-mono text-[13px] text-muted hidden md:table-cell">{r.price_per_unit > 0 ? `$${r.price_per_unit.toFixed(4)}` : "—"}</td>
                    <td className="px-4 text-right font-mono text-[13px] text-muted">{formatCurrency(r.gross_amount)}</td>
                    <td className="px-4 text-right font-mono text-[13px]">{r.discount_amount > 0 ? <span className="text-status-pass-text">−{formatCurrency(r.discount_amount)}</span> : <span className="text-faint">—</span>}</td>
                    <td className="px-4 text-right font-mono text-[13px] font-semibold text-fg">{formatCurrency(r.net_amount)}</td>
                    <td className="px-4 pr-5 text-right font-mono text-[13px] text-muted">{share}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** 403/404 guidance from the Enhanced Billing API, restyled as a warning card. */
export function BillingAccessHelp({ kind, org, orgMode }: { kind: 403 | 404; org: string; orgMode: boolean }) {
  const orgNotEnrolled = kind === 404 && orgMode;
  return (
    <section role="alert" className="card p-5 !border-status-warn/30">
      <h2 className="text-[15px] font-semibold text-status-warn-text">
        {kind === 403
          ? "This token can't read billing"
          : orgNotEnrolled
            ? `No billing data for ${org || "this organization"}`
            : `This token can't read ${org || "this organization"}'s billing`}
      </h2>
      <p className="mt-2 max-w-3xl text-[13px] leading-5 text-muted">
        {orgNotEnrolled ? (
          <>GitHub returned 404 from the Enhanced Billing API. The organization is probably not on the Enhanced Billing Platform, which needs a Team or Enterprise plan.</>
        ) : (
          <>The Enhanced Billing API needs a <strong className="text-fg">fine-grained</strong> token with the <code className="font-mono text-fg">Administration</code> organization permission (read). Classic tokens with <code className="font-mono text-fg">admin:org</code> are not accepted.{kind === 404 && " GitHub hides the resource with a 404 rather than a 403."}</>
        )}
      </p>
      {!orgNotEnrolled && (
        <ol className="mt-3 list-decimal list-inside space-y-1 text-[13px] text-muted">
          <li>Create a fine-grained token at github.com/settings/personal-access-tokens/new</li>
          <li>Set the resource owner to <span className="font-mono text-fg">{org || "your organization"}</span></li>
          <li>Under organization permissions, set Administration to read-only</li>
          <li>Replace your token in Settings</li>
        </ol>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-4 text-[13px] font-medium">
        {orgNotEnrolled ? (
          <a href={`https://github.com/organizations/${org}/settings/billing/platform`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-link hover:text-violet-200">
            Enable Enhanced Billing <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        ) : (
          <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-link hover:text-violet-200">
            Create a fine-grained token <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        )}
        {org && (
          <a href={`https://github.com/organizations/${org}/settings/billing`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-fg">
            Billing on GitHub <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        )}
      </div>
    </section>
  );
}
