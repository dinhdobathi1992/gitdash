import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The property under test throughout: an unreadable source must never be
 * indistinguishable from a clean one. On a security page that conflation
 * would let a token permission gap read as "you're safe".
 */

const listDependabot = vi.fn();
const listCodeScanning = vi.fn();
const listSecretScanning = vi.fn();

vi.mock("@/lib/github", () => ({
  getOctokit: () => ({
    rest: {
      dependabot: { listAlertsForRepo: (...a: unknown[]) => listDependabot(...a) },
      codeScanning: { listAlertsForRepo: (...a: unknown[]) => listCodeScanning(...a) },
      secretScanning: { listAlertsForRepo: (...a: unknown[]) => listSecretScanning(...a) },
    },
  }),
}));

function httpError(status: number, message?: string) {
  const e = new Error(message ?? `HTTP ${status}`) as Error & { status: number };
  e.status = status;
  return e;
}

/** A 403 whose body arrives on the response rather than on `.message`. */
function httpErrorWithBody(status: number, bodyMessage: string) {
  const e = new Error(`HTTP ${status}`) as Error & {
    status: number;
    response: { data: { message: string } };
  };
  e.status = status;
  e.response = { data: { message: bodyMessage } };
  return e;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

function depAlert(over: Record<string, unknown> = {}) {
  return {
    number: 1,
    state: "open",
    created_at: daysAgo(10),
    html_url: "https://github.com/o/r/security/dependabot/1",
    security_advisory: { severity: "high", summary: "Prototype pollution", cve_id: "CVE-1" },
    dependency: { package: { name: "lodash" } },
    ...over,
  };
}

beforeEach(() => {
  // Default: every source readable and empty.
  listDependabot.mockReset().mockResolvedValue({ data: [] });
  listCodeScanning.mockReset().mockResolvedValue({ data: [] });
  listSecretScanning.mockReset().mockResolvedValue({ data: [] });
});

async function run() {
  const { getSecurityAlerts } = await import("@/lib/security-alerts");
  return getSecurityAlerts("tok", "o", "r");
}

describe("getSecurityAlerts — clean repo", () => {
  it("reports zero alerts with every source ok and nothing partial", async () => {
    const r = await run();
    expect(r.total_open).toBe(0);
    expect(r.partial).toBe(false);
    expect(r.needs_scope).toBe(false);
    expect(r.oldest_open_days).toBeNull();
    expect(Object.values(r.sources).every((s) => s.status === "ok")).toBe(true);
  });
});

describe("getSecurityAlerts — permission and availability failures", () => {
  it("marks a 403 source forbidden and flags needs_scope", async () => {
    listDependabot.mockRejectedValue(httpError(403));
    const r = await run();

    expect(r.sources.dependabot.status).toBe("forbidden");
    expect(r.needs_scope).toBe(true);
    expect(r.partial).toBe(true);
    // Crucially, this is NOT reported as a clean repo.
    expect(r.sources.dependabot.open_count).toBe(0);
  });

  // v4.2.7: GitHub answers 403 for a *disabled feature* as well as for an
  // insufficient token. Blaming the token for both told people to widen a PAT
  // that was already sufficient — a fix that cannot possibly work.
  it("treats a 403 that names a disabled feature as not_enabled, not a scope gap", async () => {
    listCodeScanning.mockRejectedValue(
      httpError(403, "Code Security must be enabled for this repository to use code scanning."),
    );
    const r = await run();

    expect(r.sources.code_scanning.status).toBe("not_enabled");
    expect(r.needs_scope).toBe(false);
    // Still not a clean repo — the source remains unreadable.
    expect(r.partial).toBe(true);
  });

  it("reads the disabled-feature message from the response body too", async () => {
    listSecretScanning.mockRejectedValue(
      httpErrorWithBody(403, "Advanced Security must be enabled for this repository."),
    );
    const r = await run();

    expect(r.sources.secret_scanning.status).toBe("not_enabled");
    expect(r.needs_scope).toBe(false);
  });

  it("keeps a 403 with no disabled-feature message as forbidden", async () => {
    // Ambiguity resolves toward "permission problem": that fix is at least
    // under the reader's control, whereas a wrong "not enabled" hides a real
    // access gap on a security page.
    listDependabot.mockRejectedValue(httpError(403, "Resource not accessible by personal access token"));
    const r = await run();

    expect(r.sources.dependabot.status).toBe("forbidden");
    expect(r.needs_scope).toBe(true);
  });

  it("marks a 404 source not_enabled without claiming a scope problem", async () => {
    listCodeScanning.mockRejectedValue(httpError(404));
    const r = await run();

    expect(r.sources.code_scanning.status).toBe("not_enabled");
    expect(r.partial).toBe(true);
    expect(r.needs_scope).toBe(false); // a disabled feature is not a permission gap
  });

  it("marks any other failure as error", async () => {
    listSecretScanning.mockRejectedValue(httpError(500));
    const r = await run();
    expect(r.sources.secret_scanning.status).toBe("error");
    expect(r.partial).toBe(true);
  });

  it("still returns readable sources when another one fails", async () => {
    listDependabot.mockRejectedValue(httpError(403));
    listCodeScanning.mockResolvedValue({
      data: [{ number: 7, state: "open", created_at: daysAgo(2), html_url: "u",
               rule: { security_severity_level: "critical", description: "SQL injection", id: "js/sql" } }],
    });

    const r = await run();
    expect(r.sources.dependabot.status).toBe("forbidden");
    expect(r.sources.code_scanning.status).toBe("ok");
    expect(r.total_open).toBe(1);
    expect(r.alerts[0].severity).toBe("critical");
  });

  it("never throws when every source fails", async () => {
    listDependabot.mockRejectedValue(httpError(403));
    listCodeScanning.mockRejectedValue(httpError(403));
    listSecretScanning.mockRejectedValue(httpError(403));

    const r = await run();
    expect(r.total_open).toBe(0);
    expect(r.partial).toBe(true);
    expect(r.needs_scope).toBe(true);
  });
});

describe("getSecurityAlerts — severity normalisation", () => {
  it("maps GitHub's several vocabularies onto one scale", async () => {
    listDependabot.mockResolvedValue({
      data: [
        depAlert({ number: 1, security_advisory: { severity: "critical", summary: "c" } }),
        depAlert({ number: 2, security_advisory: { severity: "moderate", summary: "m" } }),
        depAlert({ number: 3, security_advisory: { severity: "LOW", summary: "l" } }),
      ],
    });
    const r = await run();
    expect(r.counts.critical).toBe(1);
    expect(r.counts.medium).toBe(1); // "moderate" → medium
    expect(r.counts.low).toBe(1);
  });

  it("prefers security_severity_level over rule.severity for code scanning", async () => {
    // rule.severity is about confidence (note/warning/error), not impact.
    listCodeScanning.mockResolvedValue({
      data: [{ number: 1, state: "open", created_at: daysAgo(1), html_url: "u",
               rule: { security_severity_level: "critical", severity: "warning", description: "d", id: "r" } }],
    });
    const r = await run();
    expect(r.alerts[0].severity).toBe("critical");
  });

  it("always treats an exposed secret as critical", async () => {
    // Secret scanning alerts carry no severity field, and a live credential
    // needs no triage debate.
    listSecretScanning.mockResolvedValue({
      data: [{ number: 1, state: "open", created_at: daysAgo(1), html_url: "u",
               secret_type_display_name: "AWS Access Key" }],
    });
    const r = await run();
    expect(r.alerts[0].severity).toBe("critical");
    expect(r.alerts[0].subject).toBe("AWS Access Key");
  });
});

describe("getSecurityAlerts — ordering and ageing", () => {
  it("sorts by severity, then oldest first within a severity", async () => {
    listDependabot.mockResolvedValue({
      data: [
        depAlert({ number: 1, created_at: daysAgo(1), security_advisory: { severity: "low", summary: "l" } }),
        depAlert({ number: 2, created_at: daysAgo(5), security_advisory: { severity: "critical", summary: "c-new" } }),
        depAlert({ number: 3, created_at: daysAgo(40), security_advisory: { severity: "critical", summary: "c-old" } }),
      ],
    });
    const r = await run();
    expect(r.alerts.map((a) => a.title)).toEqual(["c-old", "c-new", "l"]);
  });

  it("reports the age of the oldest open alert", async () => {
    listDependabot.mockResolvedValue({
      data: [depAlert({ created_at: daysAgo(47) }), depAlert({ number: 2, created_at: daysAgo(3) })],
    });
    const r = await run();
    expect(r.oldest_open_days).toBe(47);
  });

  it("computes mean time to remediate from recently fixed alerts", async () => {
    listDependabot
      .mockResolvedValueOnce({ data: [] }) // open
      .mockResolvedValueOnce({
        data: [
          { number: 9, state: "fixed", created_at: daysAgo(20), fixed_at: daysAgo(10) }, // 10d
          { number: 8, state: "fixed", created_at: daysAgo(14), fixed_at: daysAgo(10) }, //  4d
        ],
      });
    const r = await run();
    expect(r.sources.dependabot.fixed_last_90d).toBe(2);
    expect(r.sources.dependabot.mttr_days).toBe(7); // (10 + 4) / 2
  });

  it("reports a null MTTR rather than zero when nothing was fixed", async () => {
    const r = await run();
    expect(r.sources.dependabot.mttr_days).toBeNull();
  });
});
