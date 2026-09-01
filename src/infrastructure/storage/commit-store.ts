import { chmod } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig, OrganizationCommit } from '../../domain/models.js';
import { HISTORY_FILE, openHistoryDatabase, rollback } from './history-database.js';

interface OrganizationCommitRow {
  organization: string;
  repository: string;
  sha: string;
  branch: string;
  author: string;
  committed_at: string;
  message: string;
  url: string;
}

export async function recordOrganizationCommits(
  config: AppConfig,
  commits: readonly OrganizationCommit[] | null,
  cwd = process.cwd(),
): Promise<number> {
  const database = openHistoryDatabase(cwd);
  try {
    const insert = database.prepare(`INSERT INTO organization_commits
      (hostname, organization, repository, sha, branch, author, committed_at, message, url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(hostname, organization, repository, sha) DO UPDATE SET
        branch=excluded.branch, author=excluded.author, committed_at=excluded.committed_at,
        message=excluded.message, url=excluded.url`);
    database.exec('BEGIN');
    for (const commit of commits ?? []) {
      insert.run(
        config.hostname,
        commit.organization,
        commit.repository,
        commit.sha,
        commit.branch,
        commit.author,
        commit.committedAt,
        commit.message,
        commit.url,
      );
    }
    pruneExpiredCommits(database, config);
    database.exec('COMMIT');
    await chmod(path.join(cwd, HISTORY_FILE), 0o600);
    return commits?.length ?? 0;
  } catch (error: unknown) {
    rollback(database);
    throw error;
  } finally {
    database.close();
  }
}

export function loadOrganizationCommits(config: AppConfig, cwd = process.cwd()): OrganizationCommit[] {
  if (!config.organizations.length) return [];
  const database = openHistoryDatabase(cwd);
  try {
    const cutoff = commitCutoff(config.commitLedgerDays);
    const placeholders = config.organizations.map(() => '?').join(',');
    const rows = database.prepare(`SELECT organization, repository, sha, branch, author, committed_at, message, url
      FROM organization_commits
      WHERE hostname = ? AND organization IN (${placeholders}) AND committed_at >= ?
      ORDER BY committed_at DESC`)
      .all(config.hostname, ...config.organizations, cutoff) as unknown as OrganizationCommitRow[];
    return rows.map(row => ({
      organization: row.organization,
      repository: row.repository,
      sha: row.sha,
      branch: row.branch,
      author: row.author,
      committedAt: row.committed_at,
      message: row.message,
      url: row.url,
    }));
  } finally {
    database.close();
  }
}

export function loadOrganizationCommitCursors(
  config: AppConfig,
  cwd = process.cwd(),
): Record<string, string> {
  if (!config.organizations.length) return {};
  const database = openHistoryDatabase(cwd);
  try {
    const placeholders = config.organizations.map(() => '?').join(',');
    const rows = database.prepare(`SELECT repository, MAX(committed_at) AS committed_at
      FROM organization_commits WHERE hostname = ? AND organization IN (${placeholders}) GROUP BY repository`)
      .all(config.hostname, ...config.organizations) as unknown as Array<{ repository: string; committed_at: string }>;
    return Object.fromEntries(rows.map(row => [row.repository, row.committed_at]));
  } finally {
    database.close();
  }
}

function pruneExpiredCommits(
  database: ReturnType<typeof openHistoryDatabase>,
  config: AppConfig,
): void {
  database.prepare('DELETE FROM organization_commits WHERE hostname = ? AND committed_at < ?')
    .run(config.hostname, commitCutoff(config.commitLedgerDays));
}

function commitCutoff(commitLedgerDays: number): string {
  return new Date(Date.now() - commitLedgerDays * 86_400_000).toISOString();
}
