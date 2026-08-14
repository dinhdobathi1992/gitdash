/**
 * GET /api/ai/anomaly-explanation — why did this metric spike?
 *
 * Params: owner, repo, workflow_id, metric ("duration" | "queue_wait").
 *
 * The snapshot is rebuilt server-side even though the workflow page already
 * ran the same anomaly detection client-side. Prompts are only ever assembled
 * from typed server-built snapshots, so the client cannot hand us numbers to
 * feed a model. Cached for 30 minutes to keep that rebuild cheap.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { aiEnabled, generateJson, type AiFailureReason } from "@/lib/ai";
import { buildAnomalySnapshot } from "@/lib/ai-snapshots";
import { ANOMALY_SYSTEM_PROMPT } from "@/lib/ai-prompts";
import { parseAnomalyContent, type AnomalyExplanationContent } from "@/lib/ai-schema";
import { withCache, cacheGet, cacheSet, cacheDelete, hashKey } from "@/lib/cache";
import { aiRateLimit } from "@/lib/ratelimit";
import { validateOwner, validateRepo, validateId, safeError } from "@/lib/validation";
import type { AnomalyMetric } from "@/lib/anomaly";

export const maxDuration = 60;

const CACHE_TTL = 1800; // 30 min — anomalies are historical, they do not move
const RATE_LIMIT_PER_MIN = 20;

const VALID_METRICS: AnomalyMetric[] = ["duration", "queue_wait"];

export interface AiAnomalyResponse {
  ok: true;
  provider: string;
  model: string;
  generated_at: string;
  cached: boolean;
  outlier_count: number;
  content: AnomalyExplanationContent;
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
  return NextResponse.json({ ok: false, error: "AI explanation unavailable" }, { status: 503 });
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

  // Checked against a literal allowlist rather than passed through: this value
  // reaches a prompt, and an arbitrary string there is exactly the injection
  // vector this layer is built to avoid.
  const rawMetric = searchParams.get("metric");
  if (!rawMetric || !VALID_METRICS.includes(rawMetric as AnomalyMetric)) {
    return NextResponse.json(
      { error: 'metric must be "duration" or "queue_wait"' },
      { status: 400 },
    );
  }
  const metric = rawMetric as AnomalyMetric;

  const tokenHash = hashKey(token);
  const limit = aiRateLimit(tokenHash, "anomaly", RATE_LIMIT_PER_MIN);
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
    const snapshot = await buildAnomalySnapshot(token, {
      owner: ownerResult.data,
      repo: repoResult.data,
      workflowId: idResult.data,
      metric,
    });

    // Nothing to explain — answer plainly instead of asking a model to
    // speculate about an empty list.
    if (snapshot.outliers.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No outliers to explain for this metric" },
        { status: 404 },
      );
    }

    const fingerprint = hashKey(JSON.stringify(snapshot));
    const scopeKey = `${ownerResult.data}/${repoResult.data}/${idResult.data}/${metric}`;
    const cacheKey = `ai:anomaly:${tokenHash}:${scopeKey}:${fingerprint}`;
    const hit = cacheGet<AiAnomalyResponse>(cacheKey) !== undefined;

    const generate = async (): Promise<AiAnomalyResponse | { failed: AiFailureReason }> => {
      let result = await generateJson(ANOMALY_SYSTEM_PROMPT, snapshot, { maxOutputTokens: 400 });
      if (!result.ok) return { failed: result.reason };

      let content = parseAnomalyContent(result.content);
      if (!content) {
        result = await generateJson(ANOMALY_SYSTEM_PROMPT, snapshot, { maxOutputTokens: 400 });
        if (!result.ok) return { failed: result.reason };
        content = parseAnomalyContent(result.content);
      }
      if (!content) return { failed: "bad_response" };

      return {
        ok: true,
        provider: result.provider,
        model: result.model,
        generated_at: new Date().toISOString(),
        cached: false,
        outlier_count: snapshot.outliers.length,
        content,
      };
    };

    const payload = await withCache(cacheKey, CACHE_TTL, generate);
    if (!("ok" in payload)) {
      cacheDelete(cacheKey); // never let a failure occupy the key for its TTL
      return failureResponse(payload.failed);
    }
    if (!hit) cacheSet(cacheKey, payload, CACHE_TTL);

    return NextResponse.json(
      { ...payload, cached: hit },
      { headers: { "Cache-Control": `private, max-age=${CACHE_TTL}` } },
    );
  } catch (e) {
    return safeError(e, "Failed to generate anomaly explanation");
  }
}
