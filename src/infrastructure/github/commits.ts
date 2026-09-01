import type { AppConfig, OrganizationCommit, ProgressReporter } from '../../domain/models.js';
import { errorMessage } from '../../shared/errors.js';
import { githubRest } from './gh-client.js';

interface GitHubCommitPayload {
  sha?: string;
  html_url?: string;
  author?: { login?: string | null } | null;
  commit?: {
    message?: string;
    author?: { name?: string; date?: string } | null;
    committer?: { name?: string; date?: string } | null;
  };
}

interface GitHubRepositoryPayload {
  full_name: string;
  default_branch?: string | null;
  archived?: boolean;
  pushed_at?: string;
  owner?: { login?: string };
}

export interface OrganizationCommitCollection {
  commits: OrganizationCommit[];
  repositories: number;
  activeRepositories: number;
  errors: Array<{ repository: string; error: string }>;
}

interface CollectionOptions {
  signal?: AbortSignal;
}

export function normalizeOrganizationCommit(
  item: GitHubCommitPayload,
  repository: GitHubRepositoryPayload,
): OrganizationCommit {
  const sha = String(item.sha ?? '');
  return {
    sha,
    repository: repository.full_name,
    branch: repository.default_branch ?? 'default',
    author: item.author?.login ?? item.commit?.author?.name ?? item.commit?.committer?.name ?? 'unknown',
    committedAt: item.commit?.committer?.date ?? item.commit?.author?.date ?? '',
    message: String(item.commit?.message ?? '').split('\n')[0],
    url: item.html_url ?? `https://github.com/${repository.full_name}/commit/${sha}`,
    organization: repository.owner?.login ?? repository.full_name.split('/')[0],
  };
}

export async function fetchRepositoryCommits(
  repository: string,
  branch: string,
  hostname: string,
  signal?: AbortSignal,
): Promise<OrganizationCommit[]> {
  const items = await githubRest<GitHubCommitPayload[]>(
    hostname,
    `/repos/${repository}/commits`,
    { sha: branch, per_page: 20 },
    signal,
  );
  return items.map(item => normalizeOrganizationCommit(item, {
    full_name: repository,
    default_branch: branch,
    owner: { login: repository.split('/')[0] },
  }));
}

export async function fetchOrganizationCommits(
  config: AppConfig,
  cursors: Readonly<Record<string, string>> = {},
  reportProgress: ProgressReporter = () => undefined,
  options: CollectionOptions = {},
): Promise<OrganizationCommitCollection> {
  if (!config.organizations.length) return emptyCollection();

  const { signal } = options;
  const windowStart = new Date(Date.now() - config.commitLedgerDays * 86_400_000).toISOString();
  const { repositories, discoveredCount } = await discoverRecentlyPushedRepositories(config, windowStart, signal);
  const commits: OrganizationCommit[] = [];
  const errors: OrganizationCommitCollection['errors'] = [];
  let completed = 0;

  reportProgress(`Checking ${repositories.length} recently pushed repositories…`, {
    current: 0,
    total: Math.max(1, repositories.length),
  });

  for (let offset = 0; offset < repositories.length; offset += 5) {
    await Promise.all(repositories.slice(offset, offset + 5).map(async repository => {
      try {
        commits.push(...await fetchCommitsSinceCursor(config, repository, cursors, windowStart, signal));
      } catch (error: unknown) {
        if (signal?.aborted) throw error;
        errors.push({ repository: repository.full_name, error: errorMessage(error) });
      } finally {
        completed += 1;
        reportProgress(`Organization commits (${completed}/${repositories.length})…`, {
          current: completed,
          total: Math.max(1, repositories.length),
        });
      }
    }));
  }

  commits.sort((left, right) => right.committedAt.localeCompare(left.committedAt));
  return {
    commits,
    repositories: discoveredCount,
    activeRepositories: repositories.length,
    errors,
  };
}

async function discoverRecentlyPushedRepositories(
  config: AppConfig,
  windowStart: string,
  signal?: AbortSignal,
): Promise<{ repositories: GitHubRepositoryPayload[]; discoveredCount: number }> {
  const repositories: GitHubRepositoryPayload[] = [];
  let discoveredCount = 0;

  for (const organization of config.organizations) {
    for (let page = 1; page <= 10; page++) {
      const batch = await githubRest<GitHubRepositoryPayload[]>(
        config.hostname,
        `/orgs/${organization}/repos`,
        { type: 'all', sort: 'full_name', per_page: 100, page },
        signal,
      );
      discoveredCount += batch.length;
      repositories.push(...batch.filter(repository =>
        !repository.archived
        && Boolean(repository.default_branch)
        && Boolean(repository.pushed_at)
        && repository.pushed_at! >= windowStart));
      if (batch.length < 100) break;
    }
  }

  return { repositories, discoveredCount };
}

async function fetchCommitsSinceCursor(
  config: AppConfig,
  repository: GitHubRepositoryPayload,
  cursors: Readonly<Record<string, string>>,
  windowStart: string,
  signal?: AbortSignal,
): Promise<OrganizationCommit[]> {
  const cursor = cursors[repository.full_name];
  const since = cursor
    ? new Date(Math.max(new Date(windowStart).getTime(), new Date(cursor).getTime() - 5 * 60_000)).toISOString()
    : windowStart;
  const commits: OrganizationCommit[] = [];

  for (let page = 1; page <= 10; page++) {
    const items = await githubRest<GitHubCommitPayload[]>(
      config.hostname,
      `/repos/${repository.full_name}/commits`,
      { sha: repository.default_branch ?? 'default', since, per_page: 100, page },
      signal,
    );
    commits.push(...items.map(item => normalizeOrganizationCommit(item, repository)));
    if (items.length < 100) break;
  }

  return commits;
}

function emptyCollection(): OrganizationCommitCollection {
  return { commits: [], repositories: 0, activeRepositories: 0, errors: [] };
}
