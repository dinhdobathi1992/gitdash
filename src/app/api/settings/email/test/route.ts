/**
 * POST /api/settings/email/test — send a verification email.
 *
 * Email is the one feature whose misconfiguration is otherwise invisible: an
 * alert or a Monday digest simply never arrives, and the only trace is a
 * server log nobody reads. This closes that loop.
 *
 * Rate-limited because it sends real mail on demand — an unmetered send
 * endpoint behind a session is a spam relay.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { sendTestEmail } from "@/lib/notifier";
import { aiRateLimit } from "@/lib/ratelimit";
import { hashKey } from "@/lib/cache";
import { safeError } from "@/lib/validation";

export const maxDuration = 60;

const RATE_LIMIT_PER_MIN = 3;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = aiRateLimit(hashKey(token), "email-test", RATE_LIMIT_PER_MIN);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many test emails — wait a minute." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 60_000) / 1000)) },
      },
    );
  }

  let to: string;
  try {
    const body = await req.json();
    to = typeof body.to === "string" ? body.to.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!to || !EMAIL_RE.test(to)) {
    return NextResponse.json({ error: "A valid recipient address is required" }, { status: 400 });
  }

  try {
    const result = await sendTestEmail(to);
    if (!result.ok) {
      // The provider's own error is genuinely useful here (bad key, unverified
      // domain, wrong sender) and contains no secret — this is the one place
      // it is worth surfacing rather than swallowing.
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }
    return NextResponse.json({ ok: true, source: result.source });
  } catch (e) {
    return safeError(e, "Failed to send test email");
  }
}
