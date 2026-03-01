import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { validateOrg, safeError } from "@/lib/validation";
import { calculateBurnRate, type BurnRateProjection } from "@/lib/cost";

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
    // Next.js server fetch — no cache; we cache via Cache-Control header
    cache: "no-store",
  });
  if (!res.ok) {
    let message = "";
    try { message = ((await res.json()) as { message?: string }).message ?? ""; } catch { /* ignore */ }
    return { ok: false, status: res.status, message };
  }
  const data = await res.json() as BillingUsageSummary;
  return { ok: true, status: 200, data };
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawOrg = url.searchParams.get("org");
  const org = rawOrg || null;

  if (org !== null) {
    const orgResult = validateOrg(org);
    if (!orgResult.ok) return orgResult.response;
  }

  // Year/month to query — default current month
  const now = new Date();
  const year = parseInt(url.searchParams.get("year") ?? String(now.getFullYear()), 10);
  const month = parseInt(url.searchParams.get("month") ?? String(now.getMonth() + 1), 10);

  try {
    const apiPath = org
      ? `organizations/${org}/settings/billing/usage/summary`
      : `users/${await getAuthenticatedLogin(token)}/settings/billing/usage/summary`;

    const result = await fetchBillingUsageSummary(token, apiPath, year, month);

    if (!result.ok || !result.data) {
      const status = result.status;
      const serverMsg = result.message ?? "";
      console.error(`[GitDash] Billing usage summary error: status=${status} path=${apiPath} msg=${serverMsg}`);

      // Surface specific, actionable errors
      if (status === 403) {
        const body: CostAnalysisError = {
          error: org
            ? `Permission denied for organization '${org}'. The GitHub Enhanced Billing API requires a fine-grained PAT with "Administration" organization permission (read). Classic PATs with admin:org are NOT supported.`
            : "Permission denied. The Enhanced Billing API requires a fine-grained PAT with 'Plan' user permission (read).",
          hint: "Go to github.com/settings/personal-access-tokens and create a Fine-grained token with Administration (read) for your org.",
        };
        return NextResponse.json(body, { status: 403 });
      }
      if (status === 404) {
        const body: CostAnalysisError = {
          error: org
            ? `Billing data not found for '${org}'. The Enhanced Billing Platform may not be enabled for this organization — it's typically available on GitHub Team/Enterprise plans. Try enabling it at github.com/organizations/${org}/settings/billing/platform.`
            : "Billing data not found. The Enhanced Billing Platform may not be enabled for your account.",
          hint: "GitHub Free orgs may not have access to the Enhanced Billing API.",
        };
        return NextResponse.json(body, { status: 404 });
      }
      if (status === 401) {
        return NextResponse.json({ error: "Token invalid or expired." }, { status: 401 });
      }
      const body: CostAnalysisError = {
        error: `GitHub returned ${status}${serverMsg ? `: ${serverMsg}` : ""}`,
      };
      return NextResponse.json(body, { status: status >= 400 && status < 600 ? status : 502 });
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

    const response: CostAnalysisResponse = {
      kind: org ? "org" : "user",
      login: org ?? "",
      skus,
      total_minutes: totalMinutes,
      total_net_amount: totalNet,
      total_gross_amount: totalGross,
      total_discount_amount: totalDiscount,
      burn_rate: burnRate,
      period: { year, month },
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": `private, s-maxage=${CACHE_TTL}, stale-while-revalidate=600`,
      },
    });
  } catch (e) {
    return safeError(e, "Failed to fetch billing data");
  }
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
  if (!res.ok) return "";
  const data = await res.json() as { login?: string };
  return data.login ?? "";
}
