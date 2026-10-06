import type { NextRequest } from "next/server";
import { handleConsentPage, handleConsentSubmit } from "@/lib/mcp/oauth/consent";

/**
 * Consent page (GET) and its plain-form handler (POST). One route handler
 * rather than a page plus a route: a segment cannot hold both, and every
 * response here needs its own headers (the POST's CSP names the redirect
 * origin in form-action).
 */
export function GET(req: NextRequest): Promise<Response> {
  return handleConsentPage(req);
}

export function POST(req: NextRequest): Promise<Response> {
  return handleConsentSubmit(req);
}
