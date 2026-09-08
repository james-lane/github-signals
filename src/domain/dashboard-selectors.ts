import { repositoryName, visibleRepositories } from './configuration.js';
import type { AppConfig, CiRun, OrganizationCommit, PullRequestDetails, RepositoryConfig } from './models.js';
import { percentile } from '../shared/statistics.js';
import { isRenovateAuthor } from './renovate.js';

const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out', 'action_required', 'startup_failure']);

export interface CiMetrics {
  runs: number;
  workflows: number;
  failingWorkflows: number;
  failed: number;
  running: number;
  successRate: number | null;
  p50: number | null;
  p95: number | null;
  queue: number | null;
}

export interface WorkflowGroup {
  key: string;
  repository: string;
  workflow: string;
  runs: CiRun[];
  completed: number;
  successRate: number | null;
  failures: number;
  p50: number | null;
  p95: number | null;
  queue: number | null;
  latest?: CiRun;
}

export interface CommitPage {
  commits: OrganizationCommit[];
  pages: number;
  rows: OrganizationCommit[];
  page: number;
}

export function calculateCiMetrics(
  runs: readonly CiRun[],
  lookbackDays: number,
  capturedAt = new Date().toISOString(),
): CiMetrics {
  const end = new Date(capturedAt).getTime();
  const start = end - lookbackDays * 86_400_000;
  const runsInWindow = runs.filter(run => {
    const createdAt = run.createdAt ? new Date(run.createdAt).getTime() : Number.NaN;
    return !run.error && createdAt >= start && createdAt <= end;
  });
  const decidedRuns = runsInWindow.filter(run =>
    run.conclusion === 'success' || FAILED_CONCLUSIONS.has(run.conclusion ?? ''));
  const successfulRuns = decidedRuns.filter(run => run.conclusion === 'success').length;
  const completedRuns = runsInWindow.filter(run => run.status === 'completed');
  const workflowKey = (run: CiRun): string => `${run.repository}:${run.workflowId ?? run.workflow ?? 'Workflow'}`;

  return {
    runs: runsInWindow.length,
    workflows: new Set(runsInWindow.map(workflowKey)).size,
    failingWorkflows: new Set(runsInWindow.filter(run => FAILED_CONCLUSIONS.has(run.conclusion ?? '')).map(workflowKey)).size,
    failed: decidedRuns.length - successfulRuns,
    running: runsInWindow.filter(run => run.status !== 'completed').length,
    successRate: decidedRuns.length ? Math.round(successfulRuns / decidedRuns.length * 100) : null,
    p50: percentile(completedRuns.map(run => run.durationMs), 0.5),
    p95: percentile(completedRuns.map(run => run.durationMs), 0.95),
    queue: percentile(completedRuns.map(run => run.queueMs), 0.5),
  };
}

export function groupCiWorkflows(runs: readonly CiRun[]): WorkflowGroup[] {
  const groupsByKey = new Map<string, { key: string; repository: string; workflow: string; runs: CiRun[] }>();
  for (const run of runs.filter(item => !item.error)) {
    const workflow = run.workflow ?? 'Workflow';
    const key = `${run.repository}:${run.workflowId ?? workflow}`;
    const group = groupsByKey.get(key) ?? { key, repository: run.repository, workflow, runs: [] };
    group.runs.push(run);
    groupsByKey.set(key, group);
  }

  return [...groupsByKey.values()].map(group => {
    group.runs.sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''));
    const completedRuns = group.runs.filter(run => Boolean(run.conclusion));
    const successfulRuns = completedRuns.filter(run => run.conclusion === 'success').length;
    return {
      ...group,
      completed: completedRuns.length,
      successRate: completedRuns.length ? successfulRuns / completedRuns.length : null,
      failures: completedRuns.filter(run => FAILED_CONCLUSIONS.has(run.conclusion ?? '')).length,
      p50: percentile(completedRuns.map(run => run.durationMs), 0.5),
      p95: percentile(completedRuns.map(run => run.durationMs), 0.95),
      queue: percentile(completedRuns.map(run => run.queueMs), 0.5),
      latest: group.runs[0],
    };
  }).sort((left, right) =>
    right.failures - left.failures
    || (right.latest?.createdAt ?? '').localeCompare(left.latest?.createdAt ?? ''));
}

export function visibleCiWorkflowGroups(runs: readonly CiRun[], textFilter: string): WorkflowGroup[] {
  const normalizedFilter = textFilter.trim().toLocaleLowerCase();
  const groups = groupCiWorkflows(runs);
  if (!normalizedFilter) return groups;
  return groups.filter(group => `${group.repository} · ${group.workflow}`.toLocaleLowerCase().includes(normalizedFilter));
}

export function sortVisibleRepositories(config: AppConfig): RepositoryConfig[] {
  return [...visibleRepositories(config)].sort((left, right) => {
    if (left.priority !== right.priority) return left.priority === 'owned' ? -1 : 1;
    return repositoryName(left).localeCompare(repositoryName(right));
  });
}

export function paginateCommits(
  commits: OrganizationCommit[],
  requestedPage: number,
  pageSize: number,
): CommitPage {
  const pages = Math.max(1, Math.ceil(commits.length / pageSize));
  const page = Math.min(requestedPage, pages - 1);
  return {
    commits,
    pages,
    page,
    rows: commits.slice(page * pageSize, (page + 1) * pageSize),
  };
}

export function filterVisiblePullRequests(
  pullRequests: readonly PullRequestDetails[],
  showRenovate: boolean,
): PullRequestDetails[] {
  return pullRequests.filter(pullRequest => showRenovate || !isRenovateAuthor(pullRequest.author?.login));
}
