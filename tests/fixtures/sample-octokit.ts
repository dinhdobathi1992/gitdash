/**
 * A minimal fake Octokit whose REST methods answer from the playground's
 * bundled sample responses (src/lib/playground/sample-responses.json). Lets a
 * test run the real fetch layer (or a main-snapshot oracle) over the same raw
 * data the playground cooks. Pages past the first return [] (end of list).
 */
import type { Octokit } from "@octokit/rest";
import { SAMPLE_REPO, sampleSource, type GitHubRequest } from "@/lib/playground/source";

type Params = Record<string, unknown>;

function toReq(path: string, params: Params, omit: string[]): GitHubRequest {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (["owner", "repo", ...omit].includes(k) || v === undefined) continue;
    out[k] = String(v);
  }
  return { method: "GET", path, params: out };
}

export function sampleOctokit(): Octokit {
  const source = sampleSource();
  const base = `/repos/${SAMPLE_REPO.owner}/${SAMPLE_REPO.repo}`;
  const call = (path: string, omit: string[] = []) => async (params: Params) => {
    const req = toReq(path, params, omit);
    if (Number(req.params.page ?? 1) > 1) return { data: [] };
    return { data: (await source(req)).body };
  };
  const dyn = (build: (p: Params) => string, omit: string[]) => async (params: Params) => call(build(params), omit)(params);

  return {
    rest: {
      pulls: {
        list: call(`${base}/pulls`),
        listReviews: dyn((p) => `${base}/pulls/${p.pull_number}/reviews`, ["pull_number"]),
        listCommits: dyn((p) => `${base}/pulls/${p.pull_number}/commits`, ["pull_number"]),
        get: dyn((p) => `${base}/pulls/${p.pull_number}`, ["pull_number"]),
      },
      repos: {
        listReleases: call(`${base}/releases`),
        listCommits: call(`${base}/commits`),
        getCommit: dyn((p) => `${base}/commits/${p.ref}`, ["ref"]),
      },
      actions: {
        listWorkflowRunsForRepo: call(`${base}/actions/runs`),
        listWorkflowRuns: dyn((p) => `${base}/actions/workflows/${p.workflow_id}/runs`, ["workflow_id"]),
      },
    },
  } as unknown as Octokit;
}
