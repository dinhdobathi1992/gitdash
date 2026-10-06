/**
 * Connected apps card: personal-key rows, the snippets a new key comes with,
 * and that the rendered list never carries a key. The repo has no DOM test
 * environment (vitest runs in node), so the card is server-rendered with its
 * data hooks mocked; the create dialog's interactive flow is covered by the
 * API tests in mcp-personal-key.test.ts and the end-to-end check.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const swr = vi.hoisted(() => ({ data: undefined as unknown, key: null as unknown }));
vi.mock("swr", () => ({
  default: (key: unknown) => {
    swr.key = key;
    return { data: key ? swr.data : undefined, error: undefined, isLoading: false, mutate: async () => undefined };
  },
}));
const auth = vi.hoisted(() => ({ resolvedMode: "standalone" as "standalone" | "organization" | null }));
vi.mock("@/components/AuthProvider", () => ({ useAuth: () => auth }));

import { ConnectedAppsCard, grantTitle, isPersonalKey, keySnippets } from "@/components/settings/ConnectedAppsCard";
import { PERSONAL_KEY_CLIENT_ID } from "@/lib/mcp/oauth/config";

const KEY = "Fe26.2*1*FAKEsealedKeyForCardTests";
const now = new Date().toISOString();
const later = new Date(Date.now() + 30 * 86_400_000).toISOString();
const keyRow = { grant_id: "a", client_id: PERSONAL_KEY_CLIENT_ID, client_name: "Laptop", redirect_host: "personal key", created_at: now, last_used_at: null, absolute_expiry: later };
const appRow = { grant_id: "b", client_id: "https://claude.ai/oauth/client.json", client_name: "Claude", redirect_host: "claude.ai", created_at: now, last_used_at: now, absolute_expiry: later };

const render = (scope?: "own" | "all") => renderToStaticMarkup(createElement(ConnectedAppsCard, scope ? { scope } : {}));

beforeEach(() => {
  auth.resolvedMode = "standalone";
  swr.data = { grants: [keyRow, appRow] };
  swr.key = null;
});

describe("ConnectedAppsCard", () => {
  it("labels key rows as personal keys with created, last used, expiry and a named Revoke", () => {
    const html = render();
    expect(html).toContain("Personal key · Laptop");
    expect(html).toContain("not used yet");
    expect(html).toMatch(/expires [A-Z][a-z]{2} \d{1,2}/);
    expect(html).toContain('aria-label="Revoke Personal key · Laptop"');
    // OAuth apps keep their redirect host and the "calls itself" name.
    expect(html).toContain("claude.ai");
    expect(html).toContain("calls itself");
  });

  it("offers Create MCP key on the own view, in standalone and organization mode", () => {
    for (const mode of ["standalone", "organization"] as const) {
      auth.resolvedMode = mode;
      expect(render()).toContain(">Create MCP key</button>");
      expect(swr.key).toBe("/api/mcp/grants");
    }
  });

  it("never renders a key in the list, and shows no key before one is created", () => {
    // Even if a list response carried one, the card renders no field that could hold it.
    swr.data = { grants: [{ ...keyRow, key: KEY }] };
    const html = render();
    expect(html).not.toContain(KEY);
    expect(html).not.toContain("Fe26.");
    expect(html).not.toContain("Treat it like a password");
  });

  it("the all-users view is organization only and has no create button", () => {
    expect(render("all")).toBe("");
    expect(swr.key).toBeNull();
    auth.resolvedMode = "organization";
    const html = render("all");
    expect(swr.key).toBe("/api/mcp/grants?all=1");
    expect(html).not.toContain("Create MCP key");
  });

  it("waits for the server's mode before fetching", () => {
    auth.resolvedMode = null;
    expect(render()).toBe("");
    expect(swr.key).toBeNull();
  });
});

describe("key helpers", () => {
  it("tells keys from OAuth apps", () => {
    expect(isPersonalKey(keyRow)).toBe(true);
    expect(isPersonalKey(appRow)).toBe(false);
    expect(grantTitle(keyRow)).toBe("Personal key · Laptop");
    expect(grantTitle(appRow)).toBe("claude.ai");
  });

  it("builds ready-to-paste Claude Code and Cursor snippets", () => {
    const s = keySnippets("https://gitdash.example", "KEY123");
    expect(s.claude).toBe('claude mcp add --transport http gitdash https://gitdash.example/mcp/me --header "Authorization: Bearer KEY123"');
    expect(JSON.parse(s.cursor)).toEqual({
      mcpServers: { gitdash: { url: "https://gitdash.example/mcp/me", headers: { Authorization: "Bearer KEY123" } } },
    });
  });
});
