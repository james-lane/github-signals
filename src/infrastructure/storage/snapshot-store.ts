import { createHash } from 'node:crypto';
import { chmod } from 'node:fs/promises';
import path from 'node:path';
import { engineerId, repositoryName, visibleRepositories } from '../../domain/configuration.js';
import type {
  AppConfig,
  EngineerFocusHistoryRow,
  EngineerRepositorySignal,
  HistorySnapshot,
} from '../../domain/models.js';
import { HISTORY_FILE, openHistoryDatabase, rollback } from './history-database.js';

interface SnapshotEngineer {
  login: string;
  commits: number;
  pullRequests: number;
  merged: number;
  reviews: number;
  repositories?: EngineerRepositorySignal[];
  error?: string;
}

interface SnapshotRepository {
  name: string;
  openPrs?: number;
  stalePrs?: number;
  waitingReviews?: number;
  staleIssues?: number;
  failedRuns?: number;
  error?: string;
}

interface SnapshotData {
  fetchedAt: string;
  engineers?: SnapshotEngineer[];
  repositories?: SnapshotRepository[];
}

export function scopeFingerprint(config: AppConfig): string {
  const scope = {
    hostname: config.hostname,
    lookbackDays: config.lookbackDays,
    engineers: config.engineers.map(engineerId).sort(),
    repositories: visibleRepositories(config).map(repositoryName).sort(),
    thresholds: config.thresholds,
  };
  return createHash('sha256').update(JSON.stringify(scope)).digest('hex');
}

export async function recordSnapshot(
  config: AppConfig,
  data: SnapshotData | null,
  cwd = process.cwd(),
): Promise<boolean> {
  if (!isCompleteSnapshot(data)) return false;
  const database = openHistoryDatabase(cwd);
  try {
    const fingerprint = scopeFingerprint(config);
    const lastSnapshot = database.prepare(
      'SELECT captured_at FROM snapshots WHERE scope_hash = ? ORDER BY captured_at DESC LIMIT 1',
    ).get(fingerprint) as { captured_at: string } | undefined;
    if (lastSnapshot && isWithinDeduplicationWindow(data.fetchedAt, lastSnapshot.captured_at)) return false;

    const engineers = data.engineers ?? [];
    const repositories = data.repositories ?? [];
    const team = aggregateTeamMetrics(engineers);
    const health = aggregateHealthMetrics(repositories);
    database.exec('BEGIN');
    const result = database.prepare(`INSERT INTO snapshots
      (captured_at, scope_hash, lookback_days, commits, pull_requests, merged, reviews, stale_prs, waiting_reviews, stale_issues, ci_failures)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        data.fetchedAt,
        fingerprint,
        config.lookbackDays,
        team.commits,
        team.pullRequests,
        team.merged,
        team.reviews,
        health.stalePullRequests,
        health.waitingReviews,
        health.staleIssues,
        health.ciFailures,
      );
    const snapshotId = Number(result.lastInsertRowid);
    insertEngineerMetrics(database, snapshotId, engineers);
    insertRepositoryMetrics(database, snapshotId, repositories);
    pruneExpiredSnapshots(database, config.historyRetentionDays);
    database.exec('COMMIT');
    await chmod(path.join(cwd, HISTORY_FILE), 0o600);
    return true;
  } catch (error: unknown) {
    rollback(database);
    throw error;
  } finally {
    database.close();
  }
}

export function loadHistory(config: AppConfig, limit = 30, cwd = process.cwd()): HistorySnapshot[] {
  const database = openHistoryDatabase(cwd);
  try {
    return (database.prepare(
      'SELECT * FROM snapshots WHERE scope_hash = ? ORDER BY captured_at DESC LIMIT ?',
    ).all(scopeFingerprint(config), limit) as unknown as HistorySnapshot[]).reverse();
  } finally {
    database.close();
  }
}

export function loadEngineerFocusHistory(
  config: AppConfig,
  limit = 30,
  cwd = process.cwd(),
): EngineerFocusHistoryRow[] {
  const database = openHistoryDatabase(cwd);
  try {
    const fingerprint = scopeFingerprint(config);
    const rows = database.prepare(`SELECT s.captured_at, m.login, m.repository, m.commits, m.pull_requests, m.merged, m.reviews, m.active_days
      FROM engineer_repository_metrics m
      JOIN snapshots s ON s.id = m.snapshot_id
      WHERE s.scope_hash = ? AND s.id IN (
        SELECT id FROM snapshots WHERE scope_hash = ? ORDER BY captured_at DESC LIMIT ?
      )
      ORDER BY s.captured_at, m.login, m.repository`)
      .all(fingerprint, fingerprint, limit) as unknown as EngineerFocusHistoryRow[];
    return rows.map(row => ({ ...row }));
  } finally {
    database.close();
  }
}

function isCompleteSnapshot(data: SnapshotData | null): data is SnapshotData {
  if (!data) return false;
  return !data.engineers?.some(item => item.error)
    && !data.repositories?.some(item => item.error);
}

function isWithinDeduplicationWindow(current: string, previous: string): boolean {
  return new Date(current).getTime() - new Date(previous).getTime() < 15 * 60_000;
}

function aggregateTeamMetrics(engineers: readonly SnapshotEngineer[]): {
  commits: number;
  pullRequests: number;
  merged: number;
  reviews: number;
} {
  return engineers.reduce((total, engineer) => ({
    commits: total.commits + engineer.commits,
    pullRequests: total.pullRequests + engineer.pullRequests,
    merged: total.merged + engineer.merged,
    reviews: total.reviews + engineer.reviews,
  }), { commits: 0, pullRequests: 0, merged: 0, reviews: 0 });
}

function aggregateHealthMetrics(repositories: readonly SnapshotRepository[]): {
  stalePullRequests: number;
  waitingReviews: number;
  staleIssues: number;
  ciFailures: number;
} {
  return repositories.reduce((total, repository) => ({
    stalePullRequests: total.stalePullRequests + (repository.stalePrs ?? 0),
    waitingReviews: total.waitingReviews + (repository.waitingReviews ?? 0),
    staleIssues: total.staleIssues + (repository.staleIssues ?? 0),
    ciFailures: total.ciFailures + (repository.failedRuns ?? 0),
  }), { stalePullRequests: 0, waitingReviews: 0, staleIssues: 0, ciFailures: 0 });
}

function insertEngineerMetrics(
  database: ReturnType<typeof openHistoryDatabase>,
  snapshotId: number,
  engineers: readonly SnapshotEngineer[],
): void {
  const insertEngineer = database.prepare('INSERT INTO engineer_metrics VALUES (?, ?, ?, ?, ?, ?)');
  const insertRepository = database.prepare('INSERT INTO engineer_repository_metrics VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const engineer of engineers) {
    insertEngineer.run(
      snapshotId,
      engineer.login,
      engineer.commits,
      engineer.pullRequests,
      engineer.merged,
      engineer.reviews,
    );
    for (const repository of engineer.repositories ?? []) {
      insertRepository.run(
        snapshotId,
        engineer.login,
        repository.name,
        repository.commits,
        repository.pullRequests,
        repository.merged,
        repository.reviews,
        repository.activeDays,
      );
    }
  }
}

function insertRepositoryMetrics(
  database: ReturnType<typeof openHistoryDatabase>,
  snapshotId: number,
  repositories: readonly SnapshotRepository[],
): void {
  const insertRepository = database.prepare('INSERT INTO repository_metrics VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const repository of repositories) {
    insertRepository.run(
      snapshotId,
      repository.name,
      repository.openPrs ?? 0,
      repository.stalePrs ?? 0,
      repository.waitingReviews ?? 0,
      repository.staleIssues ?? 0,
      repository.failedRuns ?? 0,
    );
  }
}

function pruneExpiredSnapshots(
  database: ReturnType<typeof openHistoryDatabase>,
  retentionDays: number,
): void {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  database.prepare('DELETE FROM snapshots WHERE captured_at < ?').run(cutoff);
}
