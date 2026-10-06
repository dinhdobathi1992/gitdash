import { validateOrg } from "@/lib/validation";
import { calculateBurnRate, type BurnRateProjection } from "@/lib/cost";
import { recordGitHubCall } from "@/lib/github-telemetry";
import { withCache, hashKey } from "@/lib/cache";
import { foldUsageDetail, type BillingUsageDetailItem, type DailySpend, type RepoSpend } from "@/lib/cost-detail";
import { applyLabel, loaderFail, loaderOk, validationFailure, type LoaderOptions, type LoaderResult } from "./types";

export type { DailySpend, RepoSpend } from "@/lib/cost-detail";

const CACHE_TTL = 300; // 5 minutes

// ── New Enhanced Billing API response types ───────────────────────────────────

interface BillingUsageItem {
  product: string;
  sku: string;
  unitType: string;
  pricePerUnit: number;
  grossQuantity: number;
  grossAmount: number;
  discountQuantity: number;
  discountAmount: number;
  netQuantity: number;
  netAmount: number;
}

interface BillingUsageSummary {
  usageItems: BillingUsageItem[];
}


// ── Runner SKU → display name mapping ────────────────────────────────────────

const SKU_LABEL: Record<string, string> = {
  // Enhanced billing API SKU names (lowercase with underscores)
  actions_linux:        "Ubuntu",
  actions_macos:        "macOS",
  actions_windows:      "Windows",
  actions_linux_4_core: "Ubuntu 4-core",
  actions_linux_8_core: "Ubuntu 8-core",
  actions_macos_xlarge: "macOS XL",
  // Fallback pattern: strip prefix, capitalise
};

function skuLabel(sku: string): string {
  return SKU_LABEL[sku.toLowerCase()] ?? sku.replace(/^actions_/i, "").replace(/_/g, " ");
}

// ── Public response types ─────────────────────────────────────────────────────

export interface SkuBreakdown {
  sku: string;
  label: string;
  minutes: number;
  unit_type: string;
  price_per_unit: number;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
}

export interface CostAnalysisResponse {
  kind: "org" | "user";
  login: string;
  /** All Actions SKUs for this billing period */
  skus: SkuBreakdown[];
  /** Total Actions minutes (gross) */
  total_minutes: number;
  /** Total billed cost after discounts (USD) */
  total_net_amount: number;
  /** Total gross amount before discounts (USD) */
  total_gross_amount: number;
  /** Total discount amount (USD) */
  total_discount_amount: number;
  /** Burn rate projection (uses total minutes for pacing) */
  burn_rate: BurnRateProjection;
  /** Year/month this data is for */
  period: { year: number; month: number };
  /**
   * Net spend per day split by runner OS, from the detailed usage endpoint.
   * Absent when that endpoint is unavailable (the totals above still hold).
   */
  daily?: DailySpend[];
  /** Spend per repository this period, highest first (detailed endpoint). */
  repos?: RepoSpend[];
}

export interface CostAnalysisError {
  error: string;
  deprecated?: boolean;
  hint?: string;
}

// ── Raw GitHub API call (Octokit doesn't have this endpoint yet) ──────────────

async function fetchBillingUsageSummary(
  token: string,
  path: string,
  year: number,
  month: number,
): Promise<{ ok: boolean; status: number; data?: BillingUsageSummary; message?: string }> {
  const url = `https://api.github.com/${path}?year=${year}&month=${month}&product=Actions`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    // Next.js server fetch — no fetch cache; results are cached via withCache
    cache: "no-store",
  });
  recordGitHubCall(hashKey(token), "GET", url, res.status, Object.fromEntries(res.headers));
  if (!res.ok) {
    let message = "";
    try { message = ((await res.json()) as { message?: string }).message ?? ""; } catch { /* ignore */ }
    return { ok: false, status: res.status, message };
  }
  const data = await res.json() as BillingUsageSummary;
  return { ok: true, status: 200, data };
}

async function fetchBillingUsageDetail(
  token: string,
  path: string,
  year: number,
  month: number,
): Promise<{ ok: boolean; items: BillingUsageDetailItem[] }> {
  const url = `https://api.github.com/${path}?year=${year}&month=${month}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  recordGitHubCall(hashKey(token), "GET", url, res.status, Object.fromEntries(res.headers));
  if (!res.ok) return { ok: false, items: [] };
  const data = (await res.json()) as { usageItems?: BillingUsageDetailItem[] };
  return { ok: true, items: data.usageItems ?? [] };
}

// ── Loader ───────────────────────────────────────────────────────────────────

/**
 * `org` null means the authenticated user's own billing. `year` and `month`
 * are already-parsed numbers (NaN fails validation); the caller picks defaults.
 */
export async function loadCostAnalysis(
  token: string,
  org: string | null,
  year: number,
  month: number,
  opts?: LoaderOptions,
): Promise<LoaderResult<CostAnalysisResponse>> {
  applyLabel(opts);

  if (org !== null) {
    const orgResult = validateOrg(org);
    if (!orgResult.ok) return validationFailure(orgResult);
  }

  const now = new Date();
  // Validated before use: both values go into the GitHub URL and the cache key.
  if (!Number.isInteger(year) || year < 2020 || year > now.getFullYear() + 1) {
    return loaderFail(400, "Invalid year");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return loaderFail(400, "Invalid month");
  }

  const apiPath = org
    ? `organizations/${org}/settings/billing/usage/summary`
    : `users/${await withCache(`github/login:${hashKey(token)}`, CACHE_TTL, () => getAuthenticatedLogin(token), { shared: true, shouldCache: (l) => l !== "" })}/settings/billing/usage/summary`;

  const result = await withCache(
    `github/billing/cost-analysis:${hashKey(token)}:${apiPath}:${year}:${month}`,
    CACHE_TTL,
    () => fetchBillingUsageSummary(token, apiPath, year, month),
    { shared: true, shouldCache: (r) => r.ok },
  );

  if (!result.ok || !result.data) {
    const status = result.status;
    const serverMsg = result.message ?? "";
    // apiPath contains the requested org and serverMsg comes from GitHub: strip line breaks so neither can forge log lines.
    const oneLine = (v: string) => v.replace(/[\r\n]+/g, " ");
    console.error(`[GitDash] Billing usage summary error: status=${status} path=${oneLine(apiPath)} msg=${oneLine(serverMsg)}`);

    // Surface specific, actionable errors
    if (status === 403) {
      return loaderFail(
        403,
        org
          ? `Permission denied for organization '${org}'. The GitHub Enhanced Billing API requires a fine-grained PAT with "Administration" organization permission (read). Classic PATs with admin:org are NOT supported.`
          : "Permission denied. The Enhanced Billing API requires a fine-grained PAT with 'Plan' user permission (read).",
        "Go to github.com/settings/personal-access-tokens and create a Fine-grained token with Administration (read) for your org.",
      );
    }
    if (status === 404) {
      return loaderFail(
        404,
        org
          ? `Billing data not found for '${org}'. The Enhanced Billing Platform may not be enabled for this organization — it's typically available on GitHub Team/Enterprise plans. Try enabling it at github.com/organizations/${org}/settings/billing/platform.`
          : "Billing data not found. The Enhanced Billing Platform may not be enabled for your account.",
        "GitHub Free orgs may not have access to the Enhanced Billing API.",
      );
    }
    if (status === 401) {
      return loaderFail(401, "Token invalid or expired.");
    }
    return loaderFail(
      status >= 400 && status < 600 ? status : 502,
      `GitHub returned ${status}${serverMsg ? `: ${serverMsg}` : ""}`,
    );
  }

  // ── Process usageItems ────────────────────────────────────────────────────
  const items = result.data.usageItems ?? [];
  const actionItems = items.filter(i => i.product?.toLowerCase() === "actions");

  const skus: SkuBreakdown[] = actionItems.map(i => ({
    sku: i.sku,
    label: skuLabel(i.sku),
    minutes: i.grossQuantity,
    unit_type: i.unitType,
    price_per_unit: i.pricePerUnit,
    gross_amount: i.grossAmount,
    discount_amount: i.discountAmount,
    net_amount: i.netAmount,
  }));

  const totalMinutes = skus.reduce((s, x) => s + x.minutes, 0);
  const totalGross = skus.reduce((s, x) => s + x.gross_amount, 0);
  const totalDiscount = skus.reduce((s, x) => s + x.discount_amount, 0);
  const totalNet = skus.reduce((s, x) => s + x.net_amount, 0);

  // Burn rate based on elapsed days in billing period
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  // For burn rate we use totalMinutes; included_minutes unknown from new API so use 0
  const burnRate = calculateBurnRate(totalMinutes, 0, dayOfMonth, daysInMonth);

  // Detailed usage (per day, per repository) powers the daily chart and the
  // top-repositories list. Same permission as the summary; failure is not
  // fatal — the page then shows totals only.
  const detailPath = apiPath.replace(/\/usage\/summary$/, "/usage");
  const detail = await withCache(
    `github/billing/cost-detail:${hashKey(token)}:${detailPath}:${year}:${month}`,
    CACHE_TTL,
    () => fetchBillingUsageDetail(token, detailPath, year, month).catch(() => ({ ok: false, items: [] as BillingUsageDetailItem[] })),
    { shared: true, shouldCache: (r) => r.ok },
  );
  const folded = detail.ok ? foldUsageDetail(detail.items) : null;

  return loaderOk({
    kind: org ? "org" : "user",
    login: org ?? "",
    skus,
    total_minutes: totalMinutes,
    total_net_amount: totalNet,
    total_gross_amount: totalGross,
    total_discount_amount: totalDiscount,
    burn_rate: burnRate,
    period: { year, month },
    ...(folded ? { daily: folded.daily, repos: folded.repos } : {}),
  });
}

// ── Helper — get authenticated user login without Octokit billing methods ─────
async function getAuthenticatedLogin(token: string): Promise<string> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  recordGitHubCall(hashKey(token), "GET", "https://api.github.com/user", res.status, Object.fromEntries(res.headers));
  if (!res.ok) return "";
  const data = await res.json() as { login?: string };
  return data.login ?? "";
}
