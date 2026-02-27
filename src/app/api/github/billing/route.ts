import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getOctokit } from "@/lib/github";
import { validateOrg, safeError } from "@/lib/validation";

const CACHE_TTL = 300;

export interface BillingData {
  total_minutes_used: number;
  total_paid_minutes_used: number;
  included_minutes: number;
  minutes_used_breakdown: { UBUNTU?: number; MACOS?: number; WINDOWS?: number };
  kind: "user" | "org";
  login: string;
}

export interface BillingError {
  error: string;
  deprecated?: boolean;
}

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rawOrg = new URL(req.url).searchParams.get("org");

  // Validate org param when present
  if (rawOrg !== null) {
    const orgResult = validateOrg(rawOrg || null);
    if (!orgResult.ok) return orgResult.response;
  }

  const org = rawOrg || null;

  try {
    const octokit = getOctokit(token);
    if (org) {
      const { data } = await octokit.rest.billing.getGithubActionsBillingOrg({ org });
      const result: BillingData = {
        total_minutes_used: data.total_minutes_used,
        total_paid_minutes_used: data.total_paid_minutes_used,
        included_minutes: data.included_minutes,
        minutes_used_breakdown: data.minutes_used_breakdown ?? {},
        kind: "org",
        login: org,
      };
      return NextResponse.json(result, {
        headers: { "Cache-Control": `private, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
      });
    } else {
      const { data: me } = await octokit.rest.users.getAuthenticated();
      try {
        const { data } = await octokit.rest.billing.getGithubActionsBillingUser({ username: me.login });
        const result: BillingData = {
          total_minutes_used: data.total_minutes_used,
          total_paid_minutes_used: data.total_paid_minutes_used,
          included_minutes: data.included_minutes,
          minutes_used_breakdown: data.minutes_used_breakdown ?? {},
          kind: "user",
          login: me.login,
        };
        return NextResponse.json(result, {
          headers: { "Cache-Control": `private, s-maxage=${CACHE_TTL}, stale-while-revalidate=600` },
        });
      } catch (userBillingErr: unknown) {
        // GitHub deprecated the personal billing endpoint in 2024.
        const msg = userBillingErr instanceof Error ? userBillingErr.message : "";
        const isDeprecated = msg.toLowerCase().includes("moved") || msg.toLowerCase().includes("deprecated");
        // MED-002: Don't leak the raw GitHub error message for non-deprecated errors
        const body: BillingError = {
          error: isDeprecated
            ? "GitHub has deprecated the personal Actions billing API. Use the billing page on GitHub.com instead."
            : "Failed to load personal billing data.",
          deprecated: isDeprecated,
        };
        return NextResponse.json(body, { status: 410 });
      }
    }
  } catch (e) {
    return safeError(e, "Failed to fetch billing data");
  }
}
