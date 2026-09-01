import { chmod } from 'node:fs/promises';
import path from 'node:path';
import { repositoryName, visibleRepositories } from '../../domain/configuration.js';
import type { AppConfig, CiRun } from '../../domain/models.js';
import { HISTORY_FILE, openHistoryDatabase, rollback } from './history-database.js';

interface CiRunRow {
  repository: string;
  run_id: number;
  attempt: number;
  workflow_id: number | null;
  workflow_path: string | null;
  workflow: string;
  title: string;
  event: string | null;
  status: string | null;
  conclusion: string | null;
  created_at: string;
  started_at: string | null;
  updated_at: string | null;
  duration_ms: number | null;
  queue_ms: number | null;
  head_sha: string | null;
  head_branch: string | null;
  actor: string | null;
  url: string | null;
  pull_requests: string;
}

export async function recordCiRuns(
  config: AppConfig,
  runs: readonly CiRun[] | null,
  cwd = process.cwd(),
): Promise<number> {
  if (!runs?.length) return 0;
  const database = openHistoryDatabase(cwd);
  try {
    const insert = database.prepare(`INSERT INTO ci_runs
      (repository, run_id, attempt, workflow_id, workflow_path, workflow, title, event, status, conclusion, created_at, started_at, updated_at,
       duration_ms, queue_ms, head_sha, head_branch, actor, url, pull_requests)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(repository, run_id, attempt) DO UPDATE SET
       status=excluded.status, conclusion=excluded.conclusion, updated_at=excluded.updated_at,
       duration_ms=excluded.duration_ms, queue_ms=excluded.queue_ms, workflow_path=excluded.workflow_path,
       pull_requests=excluded.pull_requests`);
    database.exec('BEGIN');
    let storedCount = 0;
    for (const run of runs) {
      if (run.error || !run.id || !run.createdAt) continue;
      insert.run(
        run.repository,
        run.id,
        run.attempt ?? 1,
        run.workflowId ?? null,
        run.workflowPath ?? null,
        run.workflow ?? 'Workflow',
        run.title ?? 'Workflow run',
        run.event ?? null,
        run.status ?? null,
        run.conclusion ?? null,
        run.createdAt,
        run.startedAt ?? null,
        run.updatedAt ?? null,
        run.durationMs ?? null,
        run.queueMs ?? null,
        run.headSha ?? null,
        run.headBranch ?? null,
        run.actor ?? null,
        run.url ?? null,
        JSON.stringify(run.pullRequests ?? []),
      );
      storedCount += 1;
    }
    pruneExpiredRuns(database, config.historyRetentionDays);
    database.exec('COMMIT');
    await chmod(path.join(cwd, HISTORY_FILE), 0o600);
    return storedCount;
  } catch (error: unknown) {
    rollback(database);
    throw error;
  } finally {
    database.close();
  }
}

export function loadCiRuns(config: AppConfig, limitPerRepository = 100, cwd = process.cwd()): CiRun[] {
  const database = openHistoryDatabase(cwd);
  try {
    const repositories = visibleRepositories(config).map(repositoryName);
    if (!repositories.length) return [];
    const select = database.prepare('SELECT * FROM ci_runs WHERE repository = ? ORDER BY created_at DESC LIMIT ?');
    const rows = repositories.flatMap(repository =>
      select.all(repository, limitPerRepository) as unknown as CiRunRow[]);
    return rows.map(fromDatabaseRow);
  } finally {
    database.close();
  }
}

function fromDatabaseRow(row: CiRunRow): CiRun {
  return {
    repository: row.repository,
    id: row.run_id,
    attempt: row.attempt,
    workflowId: row.workflow_id ?? undefined,
    workflowPath: row.workflow_path,
    workflow: row.workflow,
    title: row.title,
    event: row.event,
    status: row.status,
    conclusion: row.conclusion,
    createdAt: row.created_at,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    durationMs: row.duration_ms,
    queueMs: row.queue_ms,
    headSha: row.head_sha,
    headBranch: row.head_branch,
    actor: row.actor,
    url: row.url,
    pullRequests: parsePullRequestNumbers(row.pull_requests),
  };
}

function parsePullRequestNumbers(value: string): number[] {
  const parsed = JSON.parse(value || '[]') as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is number => typeof item === 'number') : [];
}

function pruneExpiredRuns(
  database: ReturnType<typeof openHistoryDatabase>,
  retentionDays: number,
): void {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  database.prepare('DELETE FROM ci_runs WHERE created_at < ?').run(cutoff);
}
