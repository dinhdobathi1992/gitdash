/**
 * GET /api/ai/root-cause — ranked hypotheses for why a workflow is failing.
 *
 * Params: owner, repo, workflow_id.
 *
 * This is the most expensive AI surface, so it carries three guards the other
 * routes do not need:
 *
 *   1. The snapshot build is cached SEPARATELY from the generation. Every other
 *      AI route fingerprints its cache on the snapshot, which means a cache hit
 *      still pays the GitHub fan-out. Here the fan-out is the expensive part
 *      (per-run job fetches), so it gets its own key and TTL.
 *   2. A minimum failure count — below it the route returns content: null and
 *      never calls a provider. Speculating about one flaky run is noise.
 *   3. Half the rate limit of the other surfaces.
 *
 * Metadata only: job and step NAMES, dates, counts. Never log content.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { aiEnabled, generateJson, type AiFailureReason } from "@/lib/ai";
import { buildRootCauseSnapshot } from "@/lib/ai-snapshots";
import { ROOT_CAUSE_SYSTEM_PROMPT } from "@/lib/ai-prompts";
import { parseRootCauseContent, type RootCauseContent } from "@/lib/ai-schema";
import { withCache, cacheGet, cacheDelete, hashKey } from "@/lib/cache";
import { aiRateLimit } from "@/lib/ratelimit";
import { validateOwner, validateRepo, validateId, safeError } from "@/lib/validation";

export const maxDuration = 60;

const SNAPSHOT_TTL = 600; // 10 min — guards the GitHub fan-out
const CACHE_TTL = 600; // 10 min — guards the LLM call
const RATE_LIMIT_PER_MIN = 10; // half the other surfaces: this one fans out

/** Below this, there is no pattern to explain — only noise. */
const MIN_FAILURES = 3;

export interface AiRootCauseResponse {
  ok: true;
  provider: string;
  model: string;
  generated_at: string;
  cached: boolean;
  failure_count: number;
  partial: boolean;
  /** Null when there are too few failures to analyse. */
  content: RootCauseContent | null;
}

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
  return NextResponse.json({ ok: false, error: "AI hypotheses unavailable" }, { status: 503 });
}

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!aiEnabled()) {
    return NextResponse.json(
      { ok: false, error: "AI features are not configured" },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(req.url);
  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;
  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;
  const idResult = validateId(searchParams.get("workflow_id"), "workflow_id");
  if (!idResult.ok) return idResult.response;

  const owner = ownerResult.data;
  const repo = repoResult.data;
  const workflowId = idResult.data;

  const tokenHash = hashKey(token);
  const limit = aiRateLimit(tokenHash, "root-cause", RATE_LIMIT_PER_MIN);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 60_000) / 1000)) },
      },
    );
  }

  try {
    const scopeKey = `${owner}/${repo}/${workflowId}`;

    // Guard 1: the fan-out gets its own cache, independent of the generation.
    const snapshot = await withCache(
      `ai:root-cause-snap:${tokenHash}:${scopeKey}`,
      SNAPSHOT_TTL,
      () => buildRootCauseSnapshot(token, { owner, repo, workflowId }),
    );

    // Guard 2: enforced server-side, not just hidden in the UI.
    if (snapshot.failure_count < MIN_FAILURES) {
      return NextResponse.json(
        {
          ok: true,
          provider: "",
          model: "",
          generated_at: new Date().toISOString(),
          cached: false,
          failure_count: snapshot.failure_count,
          partial: snapshot.partial,
          content: null,
        } satisfies AiRootCauseResponse,
        { headers: { "Cache-Control": `private, max-age=${CACHE_TTL}` } },
      );
    }

    const fingerprint = hashKey(JSON.stringify(snapshot));
    const cacheKey = `ai:root-cause:${tokenHash}:${scopeKey}:${fingerprint}`;
    const hit = cacheGet<AiRootCauseResponse>(cacheKey) !== undefined;

    const generate = async (): Promise<AiRootCauseResponse | { failed: AiFailureReason }> => {
      let result = await generateJson(ROOT_CAUSE_SYSTEM_PROMPT, snapshot, {
        maxOutputTokens: 1200,
      });
      if (!result.ok) return { failed: result.reason };

      let content = parseRootCauseContent(result.content);
      if (!content) {
        result = await generateJson(ROOT_CAUSE_SYSTEM_PROMPT, snapshot, { maxOutputTokens: 1200 });
        if (!result.ok) return { failed: result.reason };
        content = parseRootCauseContent(result.content);
      }
      if (!content) return { failed: "bad_response" };

      return {
        ok: true,
        provider: result.provider,
        model: result.model,
        generated_at: new Date().toISOString(),
        cached: false,
        failure_count: snapshot.failure_count,
        partial: snapshot.partial,
        content,
      };
    };

    const payload = await withCache(cacheKey, CACHE_TTL, generate);
    if (!("ok" in payload)) {
      cacheDelete(cacheKey);
      return failureResponse(payload.failed);
    }

    return NextResponse.json(
      { ...payload, cached: hit },
      { headers: { "Cache-Control": `private, max-age=${CACHE_TTL}` } },
    );
  } catch (e) {
    return safeError(e, "Failed to generate root-cause hypotheses");
  }
}
