/**
 * GET /api/ai/insights — plain-English synthesis of a repo's or org's metrics.
 *
 * Params: owner+repo (repo surface) or org (org surface).
 * Optional: refresh=1 bypasses the cached generation (still rate-limited —
 * refresh must not become an unmetered path to the provider).
 *
 * Caching note: the key is fingerprinted on the snapshot, so the GitHub
 * fan-out runs before the cache lookup and a hit only saves the LLM call.
 * That is deliberate — LLM calls are the metered resource here, and the
 * underlying fetchers carry their own caches. Do not read a cache hit as
 * "no GitHub calls were made".
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { aiEnabled, generateJson, type AiFailureReason } from "@/lib/ai";
import { buildInsightsSnapshot, type InsightsScope } from "@/lib/ai-snapshots";
import { INSIGHTS_SYSTEM_PROMPT } from "@/lib/ai-prompts";
import { parseInsightsContent, type InsightsContent } from "@/lib/ai-schema";
import { withCache, cacheGet, cacheSet, cacheDelete, hashKey } from "@/lib/cache";
import { aiRateLimit } from "@/lib/ratelimit";
import { validateOwner, validateRepo, validateOrg, safeError } from "@/lib/validation";

export const maxDuration = 60;

const CACHE_TTL = 900; // 15 min
const RATE_LIMIT_PER_MIN = 20;

export interface AiInsightsResponse {
  ok: true;
  provider: string;
  model: string;
  generated_at: string;
  cached: boolean;
  partial: boolean;
  content: InsightsContent;
}

/** Map a provider failure onto a client-safe status + message. */
function failureResponse(reason: AiFailureReason): NextResponse {
  if (reason === "budget_exceeded") {
    return NextResponse.json(
      { ok: false, error: "AI daily budget reached" },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }
  if (reason === "disabled" || reason === "no_keys") {
    return NextResponse.json(
      { ok: false, error: "AI features are not configured" },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: false, error: "AI insights unavailable" }, { status: 503 });
}

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Checked server-side rather than trusting the client feature flag, which is
  // localStorage-backed and can be flipped by anyone.
  if (!(await aiEnabled())) {
    return NextResponse.json(
      { ok: false, error: "AI features are not configured" },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(req.url);
  const orgParam = searchParams.get("org");

  let scope: InsightsScope;
  let scopeKey: string;

  if (orgParam) {
    const orgResult = validateOrg(orgParam);
    if (!orgResult.ok) return orgResult.response;
    scope = { surface: "org", org: orgResult.data };
    scopeKey = `org:${orgResult.data}`;
  } else {
    const ownerResult = validateOwner(searchParams.get("owner"));
    if (!ownerResult.ok) return ownerResult.response;
    const repoResult = validateRepo(searchParams.get("repo"));
    if (!repoResult.ok) return repoResult.response;
    scope = { surface: "repo", owner: ownerResult.data, repo: repoResult.data };
    scopeKey = `repo:${ownerResult.data}/${repoResult.data}`;
  }

  const tokenHash = hashKey(token);
  const limit = aiRateLimit(tokenHash, "insights", RATE_LIMIT_PER_MIN);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 60_000) / 1000)) },
      },
    );
  }

  const refresh = searchParams.get("refresh") === "1";

  try {
    const snapshot = await buildInsightsSnapshot(token, scope);
    const fingerprint = hashKey(JSON.stringify(snapshot));
    const cacheKey = `ai:insights:${tokenHash}:${scopeKey}:${fingerprint}`;

    // Distinguish a served-from-cache response from a fresh generation so the
    // UI can label it — withCache alone cannot report which happened.
    const hit = !refresh && cacheGet<AiInsightsResponse>(cacheKey) !== undefined;

    const generate = async (): Promise<AiInsightsResponse | { failed: AiFailureReason }> => {
      let result = await generateJson(INSIGHTS_SYSTEM_PROMPT, snapshot);
      if (!result.ok) return { failed: result.reason };

      let content = parseInsightsContent(result.content);
      if (!content) {
        // One retry: JSON-mode slips are usually transient.
        result = await generateJson(INSIGHTS_SYSTEM_PROMPT, snapshot);
        if (!result.ok) return { failed: result.reason };
        content = parseInsightsContent(result.content);
      }
      if (!content) return { failed: "bad_response" };

      return {
        ok: true,
        provider: result.provider,
        model: result.model,
        generated_at: new Date().toISOString(),
        cached: false,
        partial: snapshot.partial,
        content,
      };
    };

    let payload: AiInsightsResponse | { failed: AiFailureReason };

    if (refresh) {
      payload = await generate();
      // Only write through on success — never cache a failure.
      if ("ok" in payload) cacheSet(cacheKey, payload, CACHE_TTL);
    } else {
      payload = await withCache(cacheKey, CACHE_TTL, generate);
      // A failure that slipped into the cache would poison the key for its
      // whole TTL, so evict it and let the next request try again.
      if (!("ok" in payload)) cacheDelete(cacheKey);
    }

    if (!("ok" in payload)) return failureResponse(payload.failed);

    return NextResponse.json(
      { ...payload, cached: hit },
      { headers: { "Cache-Control": `private, max-age=${CACHE_TTL}` } },
    );
  } catch (e) {
    return safeError(e, "Failed to generate AI insights");
  }
}
