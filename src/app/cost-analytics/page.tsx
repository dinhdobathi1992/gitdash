"use client";

/**
 * Cost — `Cost` artboard, contract §9.
 * Month stepper + Download CSV · 4-cell KPI strip with the month-end
 * projection compared against last month · daily spend by runner OS with a
 * faded projection · top repositories · savings estimates · SKU detail.
 * The account follows the sidebar's org switcher.
 */

import { useMemo, useState } from "react";
import useSWR from "swr";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { fetcher, FetchError } from "@/lib/swr";
import { useAuth } from "@/components/AuthProvider";
import type { CostAnalysisResponse } from "@/app/api/github/billing/cost-analysis/route";
import { useCurrentOrg } from "@/lib/current-org";
import { savingsSuggestions } from "@/lib/cost-savings";
import { Page, PageHeading } from "@/components/ui/PageHeading";
import { KpiStrip } from "@/components/ui/KpiStrip";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/Card";
import { DailySpendChart, TopRepos, Savings, SkuTable, BillingAccessHelp } from "@/components/cost/CostSections";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NOW = new Date();
const CUR_YEAR = NOW.getFullYear();
const CUR_MONTH = NOW.getMonth() + 1;

const usd = (n: number, cents = true) => `$${n.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;

function shift(y: number, m: number, by: number) {
  const d = new Date(y, m - 1 + by, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function csvCell(v: string | number): string {
  const s = String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // formula-injection guard
  return /[,"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function downloadCsv(data: CostAnalysisResponse) {
  const lines = [["runner", "sku", "minutes", "gross_usd", "discount_usd", "net_usd"].join(",")];
  for (const s of data.skus) lines.push([s.label, s.sku, s.minutes, s.gross_amount, s.discount_amount, s.net_amount].map(csvCell).join(","));
  if (data.repos?.length) {
    lines.push("", ["repository", "minutes", "net_usd"].join(","));
    for (const r of data.repos) lines.push([r.repo, Math.round(r.minutes), r.net_amount.toFixed(2)].map(csvCell).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `actions-cost-${data.login || "account"}-${data.period.year}-${String(data.period.month).padStart(2, "0")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CostAnalyticsPage() {
  const { mode } = useAuth();
  const orgMode = mode === "organization";
  const org = useCurrentOrg();
  const [{ year, month }, setPeriod] = useState({ year: CUR_YEAR, month: CUR_MONTH });
  const isCurrent = year === CUR_YEAR && month === CUR_MONTH;

  // Organization mode uses an OAuth token that cannot read personal billing.
  const blockedPersonal = orgMode && !org;
  const key = (y: number, m: number) =>
    blockedPersonal ? null : `/api/github/billing/cost-analysis?year=${y}&month=${m}${org ? `&org=${encodeURIComponent(org)}` : ""}`;
  const prev = shift(year, month, -1);

  const { data, error, isLoading, mutate } = useSWR<CostAnalysisResponse>(key(year, month), fetcher<CostAnalysisResponse>);
  // Last month, for the projection comparison (only meaningful on the current month).
  const { data: last } = useSWR<CostAnalysisResponse>(isCurrent && data ? key(prev.year, prev.month) : null, fetcher<CostAnalysisResponse>);

  const status = error instanceof FetchError ? error.status : null;
  const daysTotal = new Date(year, month, 0).getDate();
  const daysElapsed = isCurrent ? NOW.getDate() : daysTotal;
  const projected = data ? (data.total_net_amount / Math.max(1, daysElapsed)) * daysTotal : 0;
  const sevenDay = data?.daily?.length ? data.daily.slice(-7).reduce((s, d) => s + d.linux + d.macos + d.windows + d.other, 0) / Math.min(7, data.daily.length) : null;
  const vsLast = last && last.total_net_amount > 0 ? ((projected - last.total_net_amount) / last.total_net_amount) * 100 : null;
  const savings = useMemo(
    () => (data ? savingsSuggestions(data.skus, data.repos, isCurrent ? daysTotal / Math.max(1, daysElapsed) : 1) : []),
    [data, isCurrent, daysTotal, daysElapsed],
  );

  const account = org ?? "your account";

  return (
    <Page>
      <PageHeading
        title="Cost"
        meta={`GitHub Actions billing for ${account} · from the Enhanced Billing API`}
        actions={
          <>
            <div className="inline-flex items-center h-9 rounded-control border border-control bg-surface" role="group" aria-label="Billing month">
              <button
                type="button"
                onClick={() => setPeriod(prev)}
                aria-label="Previous month"
                className="flex items-center justify-center w-9 h-full text-muted hover:text-fg"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-3 min-w-[148px] text-center text-[13px] font-semibold text-fg" aria-live="polite">
                {MONTHS[month - 1]} {year}
              </span>
              <button
                type="button"
                onClick={() => setPeriod(shift(year, month, 1))}
                disabled={isCurrent}
                aria-label="Next month"
                className="flex items-center justify-center w-9 h-full text-muted hover:text-fg disabled:text-disabled disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <Button onClick={() => data && downloadCsv(data)} disabled={!data}>
              <Download className="w-4 h-4 text-muted" aria-hidden="true" /> Download CSV
            </Button>
          </>
        }
      />

      {blockedPersonal && (
        <p className="card px-5 py-4 text-sm text-muted">
          Personal billing isn&apos;t readable in organization mode. Pick an organization in the sidebar switcher to see its Actions spend.
        </p>
      )}

      {(status === 403 || status === 404) && <BillingAccessHelp kind={status} org={org ?? ""} orgMode={orgMode} />}
      {error && status !== 403 && status !== 404 && (
        <ErrorBanner message={`Couldn't load billing: ${(error as Error).message}`} onRetry={() => mutate()} />
      )}

      {!blockedPersonal && !error && (
        <KpiStrip
          cells={[
            {
              key: "billed",
              label: isCurrent ? "Billed so far" : "Billed",
              loading: isLoading,
              value: data ? usd(data.total_net_amount) : "—",
              foot: isCurrent ? `Day ${daysElapsed} of ${daysTotal}` : `${MONTHS[month - 1]} total`,
            },
            {
              key: "projected",
              label: isCurrent ? "Projected month end" : "Gross before discounts",
              loading: isLoading,
              value: data ? (isCurrent ? usd(projected, false) : usd(data.total_gross_amount)) : "—",
              tone: isCurrent && vsLast !== null && vsLast > 10 ? "warn" : "default",
              foot: isCurrent
                ? vsLast === null
                  ? "At the current daily pace"
                  : <span className={vsLast > 10 ? "text-status-warn-text" : undefined}>
                      {Math.abs(Math.round(vsLast))}% {vsLast >= 0 ? "above" : "below"} {MONTHS[prev.month - 1]} ({usd(last!.total_net_amount, false)})
                    </span>
                : data && data.total_discount_amount > 0 ? `${usd(data.total_discount_amount)} discounted` : "No discounts applied",
            },
            {
              key: "burn",
              label: "Daily burn",
              loading: isLoading,
              value: data ? usd(sevenDay ?? data.total_net_amount / Math.max(1, daysElapsed)) : "—",
              foot: sevenDay !== null ? "7-day average" : "Average this month",
            },
            {
              key: "minutes",
              label: "Minutes",
              loading: isLoading,
              value: data ? Math.round(data.total_minutes).toLocaleString() : "—",
              foot: "Gross Actions minutes",
            },
          ]}
        />
      )}

      {data && data.daily && data.daily.length > 0 && (
        <DailySpendChart daily={data.daily} year={year} month={month} projectRest={isCurrent} today={daysElapsed} />
      )}

      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.repos ? <TopRepos repos={data.repos} /> : (
            <p className="card px-5 py-5 text-sm text-muted">Per-repository spend isn&apos;t available from GitHub for this account.</p>
          )}
          <Savings items={savings} />
        </div>
      )}

      {data && <SkuTable skus={data.skus} />}

      {data && (
        <p className="text-xs text-faint">
          Real billed amounts from GitHub&apos;s Enhanced Billing API, after discounts — not estimates. Projections and savings are estimates.{" "}
          <a href="https://docs.github.com/en/rest/billing/usage" target="_blank" rel="noopener noreferrer" className="text-link hover:text-violet-200">API reference</a>
        </p>
      )}
    </Page>
  );
}
