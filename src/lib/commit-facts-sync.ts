/**
 * Nightly commit-facts sync for working habits.
 *
 * Stores every commit of each merged PR (last WINDOW_DAYS) with its size, so
 * commit size is measured inside the PR that carried it. Measuring on the
 * default branch instead would misread squash merges: one squash commit
 * stands for many small commits.
 *
 * PRs are read oldest merge first, CHUNK_SIZE per GraphQL query. A commit
 * shared by stacked PRs is kept once, under the PR that was merged first (the
 * one that introduced it): rows are deduplicated in the chunk and the insert
 * is ON CONFLICT (repo, sha) DO NOTHING.
 *
 * Progress is committed per chunk. A PR whose data did not come back stays
 * unsynced and is retried on the next run; its chunk-mates are still stored.
 */

import type { getOctokit } from "@/lib/github";
import {
  listPrsNeedingCommitSync, upsertPrCommitFacts, markPrCommitsSynced,
  type PrCommitFactRow, type PrNeedingCommitSync,
} from "@/lib/db";

type Octokit = ReturnType<typeof getOctokit>;

export const WINDOW_DAYS = 90;
/** PRs per GraphQL query. Lower it if a query's rateLimit cost gets high. */
export const CHUNK_SIZE = 10;
/** PRs read from pr_facts per repo per run; the rest wait for the next run. */
export const LIST_LIMIT = 200;
const COMMITS_PER_PAGE = 100;

export interface CommitNode {
  commit: {
    oid: string;
    additions: number;
    deletions: number;
    changedFilesIfAvailable: number | null;
    committedDate: string | null;
    parents: { totalCount: number };
    author: { user: { login: string } | null } | null;
  };
}

interface CommitConnection {
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: CommitNode[];
}

export interface PrCommitsNode {
  author: { login: string } | null;
  commits: CommitConnection;
}

/**
 * GraphQL list items are nullable: a field error on one commit nulls that
 * node. A PR with a missing commit is left unsynced rather than stored short.
 */
function complete(nodes: (CommitNode | null)[]): nodes is CommitNode[] {
  return nodes.every((n) => n !== null && n.commit != null);
}

const COMMIT_FIELDS = `
  totalCount
  pageInfo { hasNextPage endCursor }
  nodes { commit {
    oid additions deletions changedFilesIfAvailable committedDate
    parents { totalCount }
    author { user { login } }
  } }`;

export function buildChunkQuery(numbers: number[]): string {
  const aliases = numbers
    .map((n) => `p${n}: pullRequest(number: ${n}) { author { login } commits(first: ${COMMITS_PER_PAGE}) { ${COMMIT_FIELDS} } }`)
    .join("\n");
  return `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {\n${aliases}\n} }`;
}

const PAGE_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    commits(first: ${COMMITS_PER_PAGE}, after: $cursor) { ${COMMIT_FIELDS} }
  } } }`;

/**
 * One PR's commits as rows. Author is the linked GitHub login; a commit made
 * with an email not linked to any account is credited to the PR author and
 * flagged author_linked = false.
 */
export function mapPrCommits(
  repo: string,
  prNumber: number,
  prAuthor: string | null,
  nodes: CommitNode[],
): PrCommitFactRow[] {
  return nodes.map(({ commit }) => {
    const linked = commit.author?.user?.login ?? null;
    return {
      repo,
      sha: commit.oid,
      pr_number: prNumber,
      author: linked ?? prAuthor,
      author_linked: linked !== null,
      files: commit.changedFilesIfAvailable ?? null,
      additions: commit.additions,
      deletions: commit.deletions,
      is_merge: commit.parents.totalCount > 1,
      committed_at: commit.committedDate ?? null,
    };
  });
}

type RepoData = Record<string, PrCommitsNode | null>;

/**
 * Run a chunk query. A GraphQL error response still carries the aliases that
 * resolved (GraphqlResponseError.data), so one bad PR does not sink its
 * chunk-mates. Any other failure (network, 5xx) returns null for the chunk.
 */
async function queryChunk(octokit: Octokit, owner: string, name: string, numbers: number[]): Promise<RepoData | null> {
  try {
    const res = await octokit.graphql<{ repository: RepoData | null }>(buildChunkQuery(numbers), { owner, name });
    return res.repository ?? null;
  } catch (err) {
    const e = err as { name?: string; data?: { repository?: RepoData | null } };
    if (e?.name === "GraphqlResponseError" && e.data?.repository) return e.data.repository;
    return null;
  }
}

/** Remaining commit pages of one PR (GitHub caps a PR at 250 commits). Null on any failure. */
async function fetchRemainingPages(
  octokit: Octokit, owner: string, name: string, number: number, first: CommitConnection, onCall: () => void,
): Promise<CommitNode[] | null> {
  const nodes = [...first.nodes];
  let pageInfo = first.pageInfo;
  while (pageInfo.hasNextPage && pageInfo.endCursor) {
    onCall();
    try {
      const res = await octokit.graphql<{ repository: { pullRequest: { commits: CommitConnection } | null } | null }>(
        PAGE_QUERY, { owner, name, number, cursor: pageInfo.endCursor },
      );
      const page = res.repository?.pullRequest?.commits;
      if (!page) return null;
      nodes.push(...page.nodes);
      pageInfo = page.pageInfo;
    } catch {
      return null;
    }
  }
  return nodes;
}

export interface CommitFactsSyncResult {
  repo: string;
  prs_synced: number;
  rows: number;
  failed: number;
  /** Of the PRs listed this run (at most LIST_LIMIT), those still unsynced. More may wait beyond the limit. */
  remaining: number;
  graphql_calls: number;
  stopped_at_deadline: boolean;
}

export async function syncPrCommitFacts(
  octokit: Octokit,
  owner: string,
  name: string,
  deadline: number,
  now: Date = new Date(),
): Promise<CommitFactsSyncResult> {
  const repo = `${owner}/${name}`;
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const pending = await listPrsNeedingCommitSync(repo, since, LIST_LIMIT);
  const result: CommitFactsSyncResult = {
    repo, prs_synced: 0, rows: 0, failed: 0, remaining: pending.length, graphql_calls: 0, stopped_at_deadline: false,
  };

  for (let i = 0; i < pending.length; i += CHUNK_SIZE) {
    if (Date.now() >= deadline) {
      result.stopped_at_deadline = true;
      break;
    }
    const chunk: PrNeedingCommitSync[] = pending.slice(i, i + CHUNK_SIZE);
    try {
      await syncChunk(chunk);
    } catch (err) {
      // One bad chunk must not abort the repo (or skip its alert evaluation).
      result.failed += chunk.length;
      console.error(`[commit-facts] ${repo}: chunk failed:`, err);
    }
  }

  async function syncChunk(chunk: PrNeedingCommitSync[]) {
    result.graphql_calls++;
    const data = await queryChunk(octokit, owner, name, chunk.map((p) => p.pr_number));

    const rows: PrCommitFactRow[] = [];
    const done: { pr_number: number; total_count: number }[] = [];
    for (const pr of chunk) {
      const node = data?.[`p${pr.pr_number}`];
      if (!node?.commits) {
        result.failed++;
        continue;
      }
      let nodes = node.commits.nodes;
      if (node.commits.pageInfo.hasNextPage) {
        const all = await fetchRemainingPages(octokit, owner, name, pr.pr_number, node.commits, () => result.graphql_calls++);
        if (!all) {
          result.failed++;
          continue;
        }
        nodes = all;
      }
      if (!complete(nodes)) {
        result.failed++;
        continue;
      }
      rows.push(...mapPrCommits(repo, pr.pr_number, node.author?.login ?? pr.author, nodes));
      done.push({ pr_number: pr.pr_number, total_count: node.commits.totalCount });
    }

    // Chunk is in merge order, so the first occurrence of a sha is the PR that introduced it.
    const seen = new Set<string>();
    const unique = rows.filter((r) => (seen.has(r.sha) ? false : (seen.add(r.sha), true)));
    result.rows += await upsertPrCommitFacts(unique);
    await markPrCommitsSynced(repo, done);
    result.prs_synced += done.length;
  }

  result.remaining = pending.length - result.prs_synced;
  console.log(
    `[commit-facts] ${repo}: prs=${result.prs_synced} rows=${result.rows} failed=${result.failed} remaining=${result.remaining}`,
  );
  return result;
}
