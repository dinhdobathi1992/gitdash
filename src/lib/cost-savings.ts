/**
 * "Ways to spend less" for the Cost page. Every amount is an estimate from
 * this month's usage and GitHub's own per-minute SKU prices; suggestions
 * without a defensible number carry none.
 */

import { runnerOs, type RepoSpend } from "@/lib/cost-detail";

export interface SkuLike {
  sku: string;
  label: string;
  minutes: number;
  price_per_unit: number;
  net_amount: number;
}

export interface Saving {
  key: string;
  title: string;
  detail: string;
  /** Estimated monthly saving in USD; null when not estimable. */
  monthly: number | null;
}

const DEFAULT_LINUX_PRICE = 0.008; // USD per minute, standard 2-core Linux

/** `factor` scales month-to-date usage to a full month (days_total / days_elapsed). */
export function savingsSuggestions(skus: SkuLike[], repos: RepoSpend[] | undefined, factor: number): Saving[] {
  const out: Saving[] = [];
  const linuxPrices = skus.filter((s) => runnerOs(s.sku) === "linux" && s.price_per_unit > 0).map((s) => s.price_per_unit);
  const linux = linuxPrices.length ? Math.min(...linuxPrices) : DEFAULT_LINUX_PRICE;

  for (const os of ["macos", "windows"] as const) {
    const rows = skus.filter((s) => runnerOs(s.sku) === os && s.minutes > 0 && s.net_amount > 0);
    if (!rows.length) continue;
    const minutes = rows.reduce((a, s) => a + s.minutes, 0);
    const price = rows.reduce((a, s) => a + s.price_per_unit * s.minutes, 0) / minutes;
    // Only the billed share can be saved: net/gross accounts for included minutes.
    const billedShare = Math.min(1, rows.reduce((a, s) => a + s.net_amount, 0) / Math.max(1e-9, rows.reduce((a, s) => a + s.price_per_unit * s.minutes, 0)));
    const monthly = minutes * Math.max(0, price - linux) * billedShare * factor;
    if (monthly < 1) continue;
    const name = os === "macos" ? "macOS" : "Windows";
    out.push({
      key: os,
      title: `Move jobs off ${name} runners`,
      detail: `${Math.round(minutes).toLocaleString()} ${name} minutes this month bill at ${(price / linux).toFixed(0)}× the Linux rate. Jobs that don't need ${name} tooling can run on Linux.`,
      monthly,
    });
  }

  const large = skus.filter((s) => /(\d+)_core|xlarge|large/i.test(s.sku) && s.net_amount > 0);
  if (large.length) {
    const spend = large.reduce((a, s) => a + s.net_amount, 0) * factor;
    out.push({
      key: "large",
      title: "Check larger runners are earning their cost",
      detail: `${large.map((s) => s.label).join(", ")} ${large.length === 1 ? "costs" : "cost"} about $${Math.round(spend).toLocaleString()} a month. Confirm those jobs are CPU-bound; I/O-bound jobs rarely get faster.`,
      monthly: null,
    });
  }

  if (repos && repos.length > 1) {
    const total = repos.reduce((a, r) => a + r.net_amount, 0);
    const top = repos[0];
    const share = total > 0 ? top.net_amount / total : 0;
    if (share >= 0.35) {
      out.push({
        key: "concentration",
        title: `Start with ${top.repo.split("/").pop()}`,
        detail: `It is ${Math.round(share * 100)}% of this month's Actions spend. Cancelling superseded runs (a concurrency group with cancel-in-progress) and caching dependencies usually cut the most there.`,
        monthly: null,
      });
    }
  }

  return out.sort((a, b) => (b.monthly ?? -1) - (a.monthly ?? -1)).slice(0, 3);
}
