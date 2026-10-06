/**
 * /oauth/consent: the server-rendered consent page (GET) and its form
 * handler (POST). A route handler, not a server action, so the POST response
 * can carry its own CSP whose form-action names the validated redirect
 * origin, letting the browser follow the redirect back to the app.
 *
 * CSRF: the POST must name a live transaction cookie (SameSite=Lax keeps it
 * off cross-site POSTs) and is refused when an Origin header is present and
 * is not this site. The POST is single-use: once it names a transaction, every
 * outcome deletes that transaction's cookie. Bodies are form-encoded only,
 * capped at 4 KB, and the POST is limited to 30 a minute per client IP.
 */

import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { getRateLimitKey, rateLimit } from "@/lib/ratelimit";
import { createGrant } from "./grants";
import { auditMcp, TOKEN_LIKE } from "./audit";
import { seal, TOKEN_TTL_SEC } from "./tokens";
import { issuer, mcpGate } from "./config";
import { ACCESS_DENIED_DESCRIPTION, CLIENT_BUSY, clearTxCookie, clientRedirect, isNonce, readTx, stripClaims, txClient, type Tx } from "./authorize";
import type { ResolvedClient, ValidRedirect } from "./clients";
import { errorPage, escapeHtml, htmlPage, pageHeaders, readBodyCapped } from "./headers";

const EXPIRED = "This sign-in expired. Start the connection again from your app.";
const MAX_BODY = 4 * 1024;
const RATE_LIMIT = { limit: 30, windowMs: 60_000 };

/** First 16 hex characters of SHA-256: identifies a value in the audit log without storing it. */
const shortHash = (v: string) => createHash("sha256").update(v).digest("hex").slice(0, 16);

/**
 * Audit details for a new grant. The client id and redirect host are chosen by
 * the client, so a raw value could carry token-like text that makes the audit
 * write refuse (and the grant go unlogged): the client id is always hashed,
 * and the redirect host is hashed only when it looks like a token.
 */
export function grantAuditDetails(client: ResolvedClient, redirect: ValidRedirect): Record<string, string> {
  return {
    client_sha256: shortHash(client.client_id),
    ...(TOKEN_LIKE.test(redirect.host) ? { redirect_host_sha256: shortHash(redirect.host) } : { redirect_host: redirect.host }),
    kind: client.kind,
  };
}

function describeDestination(r: ValidRedirect): { headline: string; warning: string | null } {
  if (r.kind === "loopback") {
    return {
      headline: `an app on this computer <span class="muted">(${escapeHtml(r.host)})</span>`,
      warning: "Only continue if you just started this from an app running on this computer.",
    };
  }
  if (r.kind === "native") {
    return {
      headline: `a desktop app <span class="muted">(<code>${escapeHtml(r.host)}…</code>)</span>`,
      warning:
        "Desktop app links can be claimed by any program installed on this computer. " +
        "Only continue if you started this yourself, just now, from that app.",
    };
  }
  return { headline: escapeHtml(r.host), warning: null };
}

function consentHtml(tx: Tx & { login: string }, client: ResolvedClient, redirect: ValidRedirect): string {
  const dest = describeDestination(redirect);
  const idHost = client.id_host ? ` <span class="muted">(published at ${escapeHtml(client.id_host)})</span>` : "";
  return (
    `<h1>Connect an app to GitDash?</h1>` +
    `<p>This will send you back to</p><p class="host">${dest.headline}</p>` +
    `<p>It calls itself <strong>${escapeHtml(client.client_name)}</strong>${idHost} <span class="badge">Unverified app</span></p>` +
    (dest.warning ? `<p class="warn">${escapeHtml(dest.warning)}</p>` : "") +
    `<p>Signed in to GitHub as <strong>${escapeHtml(tx.login)}</strong>.</p>` +
    `<p>Read-only access to the dashboards you can already see. You can revoke it any time in Settings → Connected apps.</p>` +
    `<form method="post" action="/oauth/consent">` +
    `<input type="hidden" name="tx" value="${escapeHtml(tx.nonce)}">` +
    `<div class="actions"><button class="primary" type="submit" name="decision" value="allow">Allow</button>` +
    `<button type="submit" name="decision" value="deny">Deny</button></div></form>`
  );
}

function busyHeaders(): Headers {
  const h = pageHeaders();
  h.set("Retry-After", "5");
  return h;
}

const signedIn = (tx: Tx): tx is Tx & { gh: string; id: number; login: string } =>
  typeof tx.gh === "string" && typeof tx.id === "number" && typeof tx.login === "string";

export async function handleConsentPage(req: NextRequest): Promise<Response> {
  const gated = mcpGate(req);
  if (gated) return gated;
  const tx = await readTx(req, req.nextUrl.searchParams.get("tx"));
  if (!tx || !signedIn(tx)) return errorPage(400, EXPIRED);
  const target = await txClient(tx);
  if (target === "busy") return errorPage(503, CLIENT_BUSY, busyHeaders());
  if (!target) return errorPage(400, "This app can no longer be verified.");
  return htmlPage("Connect an app", consentHtml(tx, target.client, target.redirect));
}

export async function handleConsentSubmit(req: NextRequest): Promise<Response> {
  const gated = mcpGate(req);
  if (gated) return gated;

  const rl = rateLimit(getRateLimitKey(req, "mcp:consent"), RATE_LIMIT.limit, RATE_LIMIT.windowMs);
  if (!rl.allowed) {
    const res = errorPage(429, "Too many attempts. Wait a minute and try again.");
    res.headers.set("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)));
    return res;
  }

  const origin = req.headers.get("origin");
  if (origin !== null && origin !== issuer()) return errorPage(403, "This request did not come from GitDash.");

  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("application/x-www-form-urlencoded")) return errorPage(415, "Unexpected form submission.");
  const body = await readBodyCapped(req, MAX_BODY);
  if (!body.ok) return errorPage(body.status, "Unexpected form submission.");
  const form = new URLSearchParams(body.text);

  const nonce = form.get("tx");
  if (!isNonce(nonce)) return errorPage(400, EXPIRED);
  // Single use: from here on, every response deletes this transaction's cookie.
  const spent = (formAction?: string) => {
    const h = pageHeaders(formAction);
    clearTxCookie(h, nonce);
    return h;
  };

  const tx = await readTx(req, nonce);
  if (!tx || !signedIn(tx)) return errorPage(400, EXPIRED, spent());
  const decision = form.get("decision");
  if (decision !== "allow" && decision !== "deny") return errorPage(400, "Choose Allow or Deny.", spent());

  const target = await txClient(tx);
  // Transient: keep the transaction so pressing Allow again works.
  if (target === "busy") return errorPage(503, CLIENT_BUSY, busyHeaders());
  if (!target) return errorPage(400, "This app can no longer be verified.", spent());
  const { client, redirect } = target;

  if (decision === "deny") {
    return clientRedirect(redirect, { error: "access_denied", error_description: ACCESS_DENIED_DESCRIPTION, state: tx.state }, spent(redirect.formAction));
  }

  let grant: Awaited<ReturnType<typeof createGrant>>;
  try {
    grant = await createGrant({
      github_id: tx.id,
      client_id: client.grant_client_id,
      client_name: client.client_name,
      redirect_host: redirect.host,
    });
  } catch {
    // The transaction is spent either way; the user starts again from the app.
    return errorPage(503, "GitDash can't reach its database right now. Start the connection again from your app in a moment.", spent());
  }

  try {
    await auditMcp("mcp.grant_created", tx.id, grant.grant_id, grantAuditDetails(client, redirect));
  } catch (err) {
    console.error(`[mcp] audit mcp.grant_created failed: ${(err as Error).name}`);
  }

  const p = stripClaims(tx);
  let code: string;
  try {
    code = await seal(
      "mcp.code",
      {
        jti: randomUUID(),
        grant_id: grant.grant_id,
        refresh_jti: grant.current_refresh,
        client_id: p.client_id,
        redirect_uri: p.redirect_uri,
        code_challenge: p.code_challenge,
        resource: p.resource,
        gh: tx.gh,
        id: tx.id,
        login: tx.login,
      },
      TOKEN_TTL_SEC["mcp.code"],
    );
  } catch (err) {
    console.error(`[mcp] sealing the authorization code failed: ${(err as Error).name}`);
    return errorPage(500, "GitDash could not finish connecting this app. Start the connection again from your app.", spent());
  }
  return clientRedirect(redirect, { code, state: tx.state }, spent(redirect.formAction));
}
