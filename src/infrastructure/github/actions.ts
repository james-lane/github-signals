import { repositoryName, visibleRepositories } from '../../domain/configuration.js';
import type { AppConfig, CiRun, ProgressReporter, WorkflowJob } from '../../domain/models.js';
import { errorMessage } from '../../shared/errors.js';
import { githubRest, waitForPacing } from './gh-client.js';

interface ActionRunPayload {
  id: number;
  run_attempt?: number;
  workflow_id?: number;
  path?: string;
  name?: string;
  display_title?: string;
  event?: string;
  status?: string;
  conclusion?: string;
  created_at?: string;
  run_started_at?: string;
  updated_at?: string;
  head_sha?: string;
  head_branch?: string;
  actor?: { login?: string };
  html_url?: string;
  pull_requests?: Array<{ number: number }>;
}

interface WorkflowRunsPayload {
  workflow_runs?: ActionRunPayload[];
}

interface WorkflowJobPayload {
  id: number;
  name: string;
  status?: string;
  conclusion?: string;
  started_at?: string;
  completed_at?: string;
  runner_name?: string;
  runner_group_name?: string;
  html_url?: string;
  steps?: Array<{
    name: string;
    number: number;
    status?: string;
    conclusion?: string;
    started_at?: string;
    completed_at?: string;
  }>;
}

interface ActionCollectionOptions {
  signal?: AbortSignal;
  progressOffset?: number;
  progressTotal?: number;
}

export async function fetchActionsSignals(
  config: AppConfig,
  reportProgress: ProgressReporter = () => undefined,
  options: ActionCollectionOptions = {},
): Promise<CiRun[]> {
  const { signal, progressOffset = 0 } = options;
  const repositories = visibleRepositories(config).map(repositoryName);
  const total = options.progressTotal ?? repositories.length;
  const runs: CiRun[] = [];

  for (const [index, repository] of repositories.entries()) {
    reportProgress(`Checking Actions for ${repository} (${index + 1}/${repositories.length})…`, {
      current: progressOffset + index,
      total,
    });

    try {
      const result = await githubRest<WorkflowRunsPayload>(
        config.hostname,
        `/repos/${repository}/actions/runs`,
        { per_page: 20 },
        signal,
      );
      runs.push(...(result.workflow_runs ?? []).map(run => normalizeActionRun(run, repository)));
    } catch (error: unknown) {
      if (signal?.aborted) throw error;
      runs.push({ repository, error: errorMessage(error) });
    }

    reportProgress(`Checked Actions for ${repository} (${index + 1}/${repositories.length})`, {
      current: progressOffset + index + 1,
      total,
    });
    if (index < repositories.length - 1) await waitForPacing(100, signal);
  }

  return runs;
}

export async function fetchWorkflowPath(
  repository: string,
  workflowId: number,
  hostname: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const workflow = await githubRest<{ path?: string }>(
    hostname,
    `/repos/${repository}/actions/workflows/${workflowId}`,
    {},
    signal,
  );
  return workflow.path ?? null;
}

export async function fetchWorkflowRunJobs(
  repository: string,
  runId: number,
  hostname: string,
  signal?: AbortSignal,
): Promise<WorkflowJob[]> {
  const result = await githubRest<{ jobs?: WorkflowJobPayload[] }>(
    hostname,
    `/repos/${repository}/actions/runs/${runId}/jobs`,
    { filter: 'latest', per_page: 100 },
    signal,
  );
  return (result.jobs ?? []).map(job => ({
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    durationMs: durationBetween(job.started_at, job.completed_at),
    runnerName: job.runner_name,
    runnerGroup: job.runner_group_name,
    url: job.html_url,
    steps: (job.steps ?? []).map(step => ({
      name: step.name,
      number: step.number,
      status: step.status,
      conclusion: step.conclusion,
      startedAt: step.started_at,
      completedAt: step.completed_at,
      durationMs: durationBetween(step.started_at, step.completed_at),
    })),
  }));
}

function normalizeActionRun(run: ActionRunPayload, repository: string): CiRun {
  return {
    repository,
    id: run.id,
    attempt: run.run_attempt ?? 1,
    workflowId: run.workflow_id,
    workflowPath: run.path,
    workflow: run.name ?? run.display_title ?? 'Workflow',
    title: run.display_title ?? run.name ?? 'Workflow run',
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
    createdAt: run.created_at,
    startedAt: run.run_started_at,
    updatedAt: run.updated_at,
    durationMs: durationBetween(run.run_started_at, run.updated_at),
    queueMs: durationBetween(run.created_at, run.run_started_at),
    headSha: run.head_sha,
    headBranch: run.head_branch,
    actor: run.actor?.login,
    url: run.html_url,
    pullRequests: (run.pull_requests ?? []).map(pullRequest => pullRequest.number),
  };
}

function durationBetween(start?: string, end?: string): number | null {
  return start && end ? Math.max(0, new Date(end).getTime() - new Date(start).getTime()) : null;
}
