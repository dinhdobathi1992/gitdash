/**
 * POST /api/github/create-issue
 *
 * Creates a GitHub issue from an anomaly detection card.
 * Uses the logged-in user's own session token so GitHub's permission
 * model is the real authorization boundary.
 *
 * Rate limited to 5 requests per hour per IP to prevent abuse.
 * This is the only external-write route in the app.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { getOctokit } from "@/lib/github";
import { validateOwner, validateRepo, safeError } from "@/lib/validation";
import { rateLimit, getRateLimitKey } from "@/lib/ratelimit";

const TITLE_MAX = 256;
const BODY_MAX = 10_000;

const KNOWN_ERRORS: Record<number, string> = {
  401: "GitHub authentication expired — please sign in again",
  403: "You don't have permission to create issues in this repository",
  404: "Repository not found or not accessible with your token",
  410: "Issues are disabled for this repository",
  422: "GitHub rejected the issue content — check title/body length and repository settings",
};

export async function POST(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Rate limit: 5 creations per hour per IP
  const rl = rateLimit(getRateLimitKey(req, "create-issue"), 5, 3_600_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many issue-creation requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)) } },
    );
  }

  let body: { owner?: unknown; repo?: unknown; title?: unknown; body?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ownerV = validateOwner(typeof body.owner === "string" ? body.owner : null);
  if (!ownerV.ok) return ownerV.response;
  const repoV = validateRepo(typeof body.repo === "string" ? body.repo : null);
  if (!repoV.ok) return repoV.response;

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const issueBody = typeof body.body === "string" ? body.body.trim() : "";

  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (title.length > TITLE_MAX) {
    return NextResponse.json({ error: `title must be ${TITLE_MAX} characters or fewer` }, { status: 400 });
  }
  if (issueBody.length > BODY_MAX) {
    return NextResponse.json({ error: `body must be ${BODY_MAX} characters or fewer` }, { status: 400 });
  }

  const octokit = getOctokit(token);
  try {
    const result = await octokit.rest.issues.create({
      owner: ownerV.data,
      repo: repoV.data,
      title,
      body: issueBody || undefined,
    });
    return NextResponse.json({
      ok: true,
      issue_url: result.data.html_url,
      issue_number: result.data.number,
    });
  } catch (e) {
    // Octokit errors carry a numeric .status field; guard before accessing
    const errStatus =
      e !== null && typeof e === "object" && "status" in e
        ? e.status  // narrowed to { status: unknown } after guard
        : undefined;
    if (typeof errStatus === "number" && KNOWN_ERRORS[errStatus]) {
      return NextResponse.json({ ok: false, error: KNOWN_ERRORS[errStatus] }, { status: errStatus });
    }
    return safeError(e, "Failed to create issue");
  }
}
