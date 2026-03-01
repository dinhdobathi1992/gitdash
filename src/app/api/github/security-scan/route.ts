import { NextRequest, NextResponse } from "next/server";
import { getTokenFromSession } from "@/lib/session";
import { validateOwner, validateRepo, safeError } from "@/lib/validation";
import { getOctokit } from "@/lib/github";

const CACHE_TTL = 300; // 5 minutes

// ── Security finding types ────────────────────────────────────────────────────

export type FindingSeverity = "critical" | "high" | "medium" | "info";

export interface SecurityFinding {
  rule_id: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  /** Workflow file path where the issue was found */
  file_path: string;
  /** Optional: line context (the raw YAML snippet triggering the finding) */
  context?: string;
}

export interface WorkflowSecurityResult {
  file_path: string;
  findings: SecurityFinding[];
  /** Computed score 0-100 (100 = no issues) */
  score: number;
  /** Whether this file uses pinned action versions */
  pinned_actions: boolean;
  /** Unpinned action refs found (e.g. "actions/checkout@main") */
  unpinned_actions: string[];
  /** Whether pull_request_target is used (high risk) */
  uses_pull_request_target: boolean;
  /** Whether workflow_dispatch inputs are used without quoting */
  unquoted_dispatch_inputs: boolean;
  /** Whether secrets are echoed (dangerous) */
  echoes_secrets: boolean;
  /** Whether secrets are used as CLI args */
  secrets_as_cli_args: boolean;
  /** Whether timeout-minutes is set on jobs */
  has_timeout: boolean;
  /** Whether permissions are declared */
  has_permissions: boolean;
}

export interface SecurityScanResponse {
  owner: string;
  repo: string;
  workflows_scanned: number;
  total_findings: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  info_count: number;
  /** Overall repo security score (0-100) */
  overall_score: number;
  results: WorkflowSecurityResult[];
}

// ── Security rules ────────────────────────────────────────────────────────────

/**
 * Scan a single workflow YAML (as raw string) for security issues.
 * Returns findings array (may be empty = no issues).
 *
 * Uses regex-based static analysis — no external dependencies.
 */
function scanWorkflow(filePath: string, content: string): WorkflowSecurityResult {
  const findings: SecurityFinding[] = [];
  const lines = content.split("\n");

  // ── Rule: pull_request_target ─────────────────────────────────────────────
  // Allows untrusted code to run with write permissions.
  const usesPRT = /pull_request_target\s*(?::|\[)/.test(content);
  if (usesPRT) {
    findings.push({
      rule_id: "SEC-001",
      severity: "critical",
      title: "Uses pull_request_target trigger",
      description:
        "pull_request_target runs with write access to the base repository. " +
        "Malicious PRs from forks can exfiltrate secrets or modify protected branches. " +
        "Switch to pull_request unless you fully understand the implications.",
      file_path: filePath,
      context: lines.find((l) => l.includes("pull_request_target"))?.trim(),
    });
  }

  // ── Rule: secrets echoed in run blocks ────────────────────────────────────
  const echoSecretRe = /echo\s+['"$]?\$\{\{\s*secrets\./g;
  const echoMatches = content.match(echoSecretRe) ?? [];
  const echoesSecrets = echoMatches.length > 0;
  if (echoesSecrets) {
    findings.push({
      rule_id: "SEC-002",
      severity: "critical",
      title: "Secret value echoed to logs",
      description:
        "Echoing secrets with 'echo ${{ secrets.X }}' logs the secret value in plain text. " +
        "Use '::add-mask::' before logging or avoid logging secrets entirely.",
      file_path: filePath,
      context: lines.find((l) => echoSecretRe.test(l))?.trim(),
    });
  }

  // ── Rule: secrets passed as CLI arguments ─────────────────────────────────
  // e.g. run: command --token=${{ secrets.TOKEN }}
  const cliSecretRe = /--[\w-]+=\$\{\{\s*secrets\./g;
  const cliMatches = content.match(cliSecretRe) ?? [];
  const secretsAsCLIArgs = cliMatches.length > 0;
  if (secretsAsCLIArgs) {
    findings.push({
      rule_id: "SEC-003",
      severity: "high",
      title: "Secret passed as CLI argument",
      description:
        "Passing secrets as CLI arguments (--token=${{ secrets.X }}) exposes them in process lists. " +
        "Use environment variables instead: set env: TOKEN: ${{ secrets.X }} and reference $TOKEN.",
      file_path: filePath,
      context: lines.find((l) => /--[\w-]+=\$\{\{\s*secrets\./.test(l))?.trim(),
    });
  }

  // ── Rule: secrets written to GITHUB_OUTPUT ────────────────────────────────
  const outputSecretRe = /echo\s+['"]\w+=\$\{\{\s*secrets\.[^}]+\}\}['"]\s*>>\s*\$GITHUB_OUTPUT/g;
  if (outputSecretRe.test(content)) {
    findings.push({
      rule_id: "SEC-004",
      severity: "critical",
      title: "Secret written to GITHUB_OUTPUT",
      description:
        "Writing secrets to $GITHUB_OUTPUT exposes them to all downstream jobs and workflow callers. " +
        "Never write secret values to GITHUB_OUTPUT.",
      file_path: filePath,
      context: lines.find((l) => />>.*GITHUB_OUTPUT/.test(l) && /secrets\./.test(l))?.trim(),
    });
  }

  // ── Rule: unquoted workflow_dispatch inputs in run ────────────────────────
  // e.g. run: echo ${{ github.event.inputs.tag }}
  const unquotedInputRe = /run:\s*.*\$\{\{\s*github\.event\.inputs\.\w+\s*\}\}/g;
  const unquotedDispatch = unquotedInputRe.test(content);
  if (unquotedDispatch) {
    findings.push({
      rule_id: "SEC-005",
      severity: "high",
      title: "Unquoted workflow_dispatch input in run step",
      description:
        "Using ${{ github.event.inputs.X }} directly in run: allows shell injection. " +
        "Set an env variable (env: INPUT: ${{ github.event.inputs.X }}) and reference $INPUT in the shell.",
      file_path: filePath,
      context: lines
        .find((l) => /\$\{\{\s*github\.event\.inputs\./.test(l) && /run:/.test(l))
        ?.trim(),
    });
  }

  // ── Rule: unpinned third-party actions ────────────────────────────────────
  // Actions using @main/@master or no pin (just a version tag like @v4 is OK;
  // SHA pins like @abc123def are best but tag pins are acceptable)
  const unpinnedActions: string[] = [];
  const actionUseRe = /uses:\s*([\w\-./]+@[\w\-.]+)/gm;
  let match: RegExpExecArray | null;
  while ((match = actionUseRe.exec(content)) !== null) {
    const ref = match[1];
    const [, pin] = ref.split("@");
    if (!pin) continue;
    // Flag @main, @master, @HEAD as unpinned
    if (/^(main|master|HEAD|latest)$/i.test(pin)) {
      unpinnedActions.push(ref);
    }
  }
  if (unpinnedActions.length > 0) {
    findings.push({
      rule_id: "SEC-006",
      severity: "high",
      title: "Action pinned to mutable ref (main/master/HEAD)",
      description:
        `${unpinnedActions.length} action(s) use mutable refs (@main, @master, @HEAD). ` +
        "These can be silently updated to include malicious code. " +
        "Pin to a specific version tag (e.g. @v4) or a commit SHA.",
      file_path: filePath,
      context: unpinnedActions.slice(0, 3).join(", "),
    });
  }

  const pinnedActions = unpinnedActions.length === 0;

  // ── Rule: no timeout-minutes set ─────────────────────────────────────────
  const hasTimeout = /timeout-minutes\s*:/.test(content);
  if (!hasTimeout) {
    findings.push({
      rule_id: "SEC-007",
      severity: "medium",
      title: "No timeout-minutes set",
      description:
        "Without timeout-minutes, runaway jobs can run for up to 6 hours, consuming quota and cost. " +
        "Add timeout-minutes: 30 (or appropriate value) to all jobs.",
      file_path: filePath,
    });
  }

  // ── Rule: no permissions declared ─────────────────────────────────────────
  const hasPermissions = /^permissions\s*:/m.test(content);
  if (!hasPermissions) {
    findings.push({
      rule_id: "SEC-008",
      severity: "medium",
      title: "No permissions block declared",
      description:
        "Without an explicit permissions: block, jobs inherit the default token permissions " +
        "(which may include write access). Declare minimal permissions per job, e.g. permissions: { contents: read }.",
      file_path: filePath,
    });
  }

  // ── Rule: workflow_dispatch inputs without type validation ────────────────
  const hasDispatchInputs =
    /workflow_dispatch\s*:[\s\S]*?inputs\s*:/.test(content);
  const hasInputType = /\btype\s*:\s*(string|boolean|choice|environment|number)/.test(content);
  if (hasDispatchInputs && !hasInputType) {
    findings.push({
      rule_id: "SEC-009",
      severity: "info",
      title: "workflow_dispatch inputs without type declarations",
      description:
        "Declaring input types (type: string, type: choice, etc.) prevents unexpected values. " +
        "Add type: declarations to all workflow_dispatch inputs.",
      file_path: filePath,
    });
  }

  // ── Rule: ECR login without mask-password ─────────────────────────────────
  const usesEcrLogin = /amazon-ecr-login/.test(content);
  const hasMaskPassword = /mask-password\s*:\s*['"]?true['"]?/.test(content);
  if (usesEcrLogin && !hasMaskPassword) {
    findings.push({
      rule_id: "SEC-010",
      severity: "medium",
      title: "ECR login without mask-password: true",
      description:
        "amazon-ecr-login without mask-password: 'true' may expose the ECR registry password in logs. " +
        "Add mask-password: 'true' to the step's with: block.",
      file_path: filePath,
      context: lines.find((l) => l.includes("amazon-ecr-login"))?.trim(),
    });
  }

  // ── Compute score ─────────────────────────────────────────────────────────
  // Start at 100, deduct points per finding severity
  const DEDUCTIONS: Record<FindingSeverity, number> = {
    critical: 30,
    high: 15,
    medium: 7,
    info: 2,
  };
  const totalDeduction = findings.reduce(
    (sum, f) => sum + DEDUCTIONS[f.severity],
    0
  );
  const score = Math.max(0, 100 - totalDeduction);

  return {
    file_path: filePath,
    findings,
    score,
    pinned_actions: pinnedActions,
    unpinned_actions: unpinnedActions,
    uses_pull_request_target: usesPRT,
    unquoted_dispatch_inputs: unquotedDispatch,
    echoes_secrets: echoesSecrets,
    secrets_as_cli_args: secretsAsCLIArgs,
    has_timeout: hasTimeout,
    has_permissions: hasPermissions,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const token = await getTokenFromSession();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const ownerResult = validateOwner(searchParams.get("owner"));
  if (!ownerResult.ok) return ownerResult.response;

  const repoResult = validateRepo(searchParams.get("repo"));
  if (!repoResult.ok) return repoResult.response;

  const owner = ownerResult.data;
  const repo = repoResult.data;

  try {
    const octokit = getOctokit(token);

    // 1. List .github/workflows directory
    let workflowFiles: { path: string; sha: string }[] = [];
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: ".github/workflows",
      });
      if (Array.isArray(data)) {
        workflowFiles = data
          .filter((f) => f.type === "file" && /\.(ya?ml)$/i.test(f.name))
          .map((f) => ({ path: f.path, sha: f.sha }));
      }
    } catch {
      // Directory doesn't exist → return empty scan
      const empty: SecurityScanResponse = {
        owner,
        repo,
        workflows_scanned: 0,
        total_findings: 0,
        critical_count: 0,
        high_count: 0,
        medium_count: 0,
        info_count: 0,
        overall_score: 100,
        results: [],
      };
      return NextResponse.json(empty, {
        headers: { "Cache-Control": `private, s-maxage=${CACHE_TTL}, stale-while-revalidate=300` },
      });
    }

    if (workflowFiles.length === 0) {
      const empty: SecurityScanResponse = {
        owner,
        repo,
        workflows_scanned: 0,
        total_findings: 0,
        critical_count: 0,
        high_count: 0,
        medium_count: 0,
        info_count: 0,
        overall_score: 100,
        results: [],
      };
      return NextResponse.json(empty, {
        headers: { "Cache-Control": `private, s-maxage=${CACHE_TTL}, stale-while-revalidate=300` },
      });
    }

    // 2. Fetch content of each workflow file in parallel
    const contentResults = await Promise.allSettled(
      workflowFiles.map(async ({ path }) => {
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
        if (Array.isArray(data) || data.type !== "file") {
          throw new Error("Not a file");
        }
        // GitHub returns base64-encoded content
        const content = Buffer.from(data.content, "base64").toString("utf-8");
        return { path, content };
      })
    );

    // 3. Scan each file
    const results: WorkflowSecurityResult[] = [];
    for (const r of contentResults) {
      if (r.status === "fulfilled") {
        results.push(scanWorkflow(r.value.path, r.value.content));
      }
    }

    // 4. Aggregate counts
    let critical_count = 0;
    let high_count = 0;
    let medium_count = 0;
    let info_count = 0;

    for (const result of results) {
      for (const f of result.findings) {
        if (f.severity === "critical") critical_count++;
        else if (f.severity === "high") high_count++;
        else if (f.severity === "medium") medium_count++;
        else info_count++;
      }
    }

    const total_findings = critical_count + high_count + medium_count + info_count;
    const overall_score =
      results.length > 0
        ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length)
        : 100;

    const response: SecurityScanResponse = {
      owner,
      repo,
      workflows_scanned: results.length,
      total_findings,
      critical_count,
      high_count,
      medium_count,
      info_count,
      overall_score,
      results,
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": `private, s-maxage=${CACHE_TTL}, stale-while-revalidate=300` },
    });
  } catch (e) {
    return safeError(e, "Failed to scan workflow security");
  }
}
