/**
 * /oauth/consent: the server-rendered consent page (GET) and its form
 * handler (POST). A route handler, not a server action, so the POST response
 * can carry its own CSP whose form-action names the validated redirect
 * origin, letting the browser follow the redirect back to the app.
 *
 * CSRF: the POST must name a live transaction cookie (SameSite=Lax keeps it
 * off cross-site POSTs) and is refused when an Origin header is present and
 * is not this site.
 */

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { createGrant } from "./grants";
import { auditMcp } from "./audit";
import { seal, TOKEN_TTL_SEC } from "./tokens";
import { issuer, mcpGate } from "./config";
import { clearTxCookie, clientRedirect, readTx, stripClaims, txClient, type Tx } from "./authorize";
import type { ResolvedClient, ValidRedirect } from "./clients";
import { errorPage, escapeHtml, htmlPage, pageHeaders } from "./headers";

const EXPIRED = "This sign-in expired. Start the connection again from your app.";

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

const signedIn = (tx: Tx): tx is Tx & { gh: string; id: number; login: string } =>
  typeof tx.gh === "string" && typeof tx.id === "number" && typeof tx.login === "string";

export async function handleConsentPage(req: NextRequest): Promise<Response> {
  const gated = mcpGate(req);
  if (gated) return gated;
  const tx = await readTx(req, req.nextUrl.searchParams.get("tx"));
  if (!tx || !signedIn(tx)) return errorPage(400, EXPIRED);
  const target = await txClient(tx);
  if (!target) return errorPage(400, "This app can no longer be verified.");
  return htmlPage("Connect an app", consentHtml(tx, target.client, target.redirect));
}

export async function handleConsentSubmit(req: NextRequest): Promise<Response> {
  const gated = mcpGate(req);
  if (gated) return gated;

  const origin = req.headers.get("origin");
  if (origin !== null && origin !== issuer()) return errorPage(403, "This request did not come from GitDash.");

  const type = req.headers.get("content-type") ?? "";
  if (!type.startsWith("application/x-www-form-urlencoded") && !type.startsWith("multipart/form-data")) {
    return errorPage(400, "Unexpected form submission.");
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return errorPage(400, "Unexpected form submission.");
  }
  const nonce = form.get("tx");
  const tx = await readTx(req, nonce);
  if (!tx || !signedIn(tx) || typeof nonce !== "string") return errorPage(400, EXPIRED);
  const decision = form.get("decision");
  if (decision !== "allow" && decision !== "deny") return errorPage(400, "Choose Allow or Deny.");

  const target = await txClient(tx);
  if (!target) return errorPage(400, "This app can no longer be verified.");
  const { client, redirect } = target;

  const headers = pageHeaders(redirect.formAction);
  clearTxCookie(headers, nonce);
  if (decision === "deny") {
    return clientRedirect(redirect, { error: "access_denied", error_description: "the user denied access", state: tx.state }, headers);
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
    // The transaction stays live, so Allow can simply be pressed again.
    return errorPage(503, "GitDash can't reach its database right now. Try again in a moment.");
  }

  try {
    await auditMcp("mcp.grant_created", tx.id, grant.grant_id, { client: client.grant_client_id, redirect_host: redirect.host, kind: client.kind });
  } catch (err) {
    console.error(`[mcp] audit mcp.grant_created failed: ${(err as Error).name}`);
  }

  const p = stripClaims(tx);
  const code = await seal(
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
  return clientRedirect(redirect, { code, state: tx.state }, headers);
}
