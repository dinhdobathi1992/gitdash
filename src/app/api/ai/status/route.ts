/**
 * GET /api/ai/status — capability probe for the AI layer (v4.1.0).
 *
 * The UI needs to know whether to render any AI surface at all. This answers
 * that in one cheap call with no LLM round-trip, so it is not rate-limited.
 *
 * Returns capability only — which providers have a key configured, never the
 * key material itself. Session-authed like every other route (it is
 * deliberately absent from ALWAYS_PUBLIC in src/middleware.ts).
 */

import { NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { aiEnabled, configuredProviders } from "@/lib/ai";

export const maxDuration = 60;

export interface AiStatusResponse {
  enabled: boolean;
  providers: string[];
}

export async function GET() {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body: AiStatusResponse = {
    enabled: await aiEnabled(),
    providers: await configuredProviders(),
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
