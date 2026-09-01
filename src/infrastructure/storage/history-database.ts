import { chmodSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { HISTORY_FILE } from '../../shared/local-file-names.js';

export { HISTORY_FILE } from '../../shared/local-file-names.js';

export type StoredDataSection = 'snapshots' | 'ci' | 'commits' | 'all';

export function openHistoryDatabase(cwd = process.cwd()): DatabaseSync {
  const filename = path.join(cwd, HISTORY_FILE);
  const database = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  initializeSchema(database);
  protectJournalFiles(filename);
  return database;
}

export function clearStoredData(section: string, cwd = process.cwd()): void {
  if (!isStoredDataSection(section)) throw new Error('Unknown database section.');
  const database = openHistoryDatabase(cwd);
  try {
    database.exec('BEGIN');
    if (section === 'snapshots' || section === 'all') database.exec('DELETE FROM snapshots');
    if (section === 'ci' || section === 'all') database.exec('DELETE FROM ci_runs');
    if (section === 'commits' || section === 'all') database.exec('DELETE FROM organization_commits');
    database.exec('COMMIT');
  } catch (error: unknown) {
    rollback(database);
    throw error;
  } finally {
    database.close();
  }
}

export function rollback(database: DatabaseSync): void {
  try {
    database.exec('ROLLBACK');
  } catch {
    // Preserve the original transaction error when rollback is unnecessary.
  }
}

function isStoredDataSection(value: string): value is StoredDataSection {
  return value === 'snapshots' || value === 'ci' || value === 'commits' || value === 'all';
}

function initializeSchema(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY,
      captured_at TEXT NOT NULL,
      scope_hash TEXT NOT NULL,
      lookback_days INTEGER NOT NULL,
      commits INTEGER NOT NULL,
      pull_requests INTEGER NOT NULL,
      merged INTEGER NOT NULL,
      reviews INTEGER NOT NULL,
      stale_prs INTEGER NOT NULL,
      waiting_reviews INTEGER NOT NULL,
      stale_issues INTEGER NOT NULL,
      ci_failures INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS snapshots_scope_time ON snapshots(scope_hash, captured_at);
    CREATE TABLE IF NOT EXISTS engineer_metrics (
      snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
      login TEXT NOT NULL, commits INTEGER NOT NULL, pull_requests INTEGER NOT NULL,
      merged INTEGER NOT NULL, reviews INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS repository_metrics (
      snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
      name TEXT NOT NULL, open_prs INTEGER NOT NULL, stale_prs INTEGER NOT NULL,
      waiting_reviews INTEGER NOT NULL, stale_issues INTEGER NOT NULL, ci_failures INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS engineer_repository_metrics (
      snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
      login TEXT NOT NULL,
      repository TEXT NOT NULL,
      commits INTEGER NOT NULL,
      pull_requests INTEGER NOT NULL,
      merged INTEGER NOT NULL,
      reviews INTEGER NOT NULL,
      active_days INTEGER NOT NULL,
      PRIMARY KEY (snapshot_id, login, repository)
    );
    CREATE TABLE IF NOT EXISTS ci_runs (
      repository TEXT NOT NULL,
      run_id INTEGER NOT NULL,
      attempt INTEGER NOT NULL,
      workflow_id INTEGER,
      workflow_path TEXT,
      workflow TEXT NOT NULL,
      title TEXT NOT NULL,
      event TEXT,
      status TEXT,
      conclusion TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      updated_at TEXT,
      duration_ms INTEGER,
      queue_ms INTEGER,
      head_sha TEXT,
      head_branch TEXT,
      actor TEXT,
      url TEXT,
      pull_requests TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (repository, run_id, attempt)
    );
    CREATE INDEX IF NOT EXISTS ci_runs_repo_time ON ci_runs(repository, created_at DESC);
    CREATE TABLE IF NOT EXISTS organization_commits (
      hostname TEXT NOT NULL,
      organization TEXT NOT NULL,
      repository TEXT NOT NULL,
      sha TEXT NOT NULL,
      branch TEXT NOT NULL,
      author TEXT NOT NULL,
      committed_at TEXT NOT NULL,
      message TEXT NOT NULL,
      url TEXT NOT NULL,
      PRIMARY KEY (hostname, organization, repository, sha)
    );
    CREATE INDEX IF NOT EXISTS organization_commits_scope_time
      ON organization_commits(hostname, organization, committed_at DESC);
    DELETE FROM engineer_metrics WHERE snapshot_id NOT IN (SELECT id FROM snapshots);
    DELETE FROM repository_metrics WHERE snapshot_id NOT IN (SELECT id FROM snapshots);
    DELETE FROM engineer_repository_metrics WHERE snapshot_id NOT IN (SELECT id FROM snapshots);
  `);

  const columns = database.prepare('PRAGMA table_info(ci_runs)').all() as Array<{ name: string }>;
  if (!columns.some(column => column.name === 'workflow_path')) {
    database.exec('ALTER TABLE ci_runs ADD COLUMN workflow_path TEXT');
  }
}

function protectJournalFiles(filename: string): void {
  for (const suffix of ['-wal', '-shm']) {
    try {
      chmodSync(`${filename}${suffix}`, 0o600);
    } catch (error: unknown) {
      if (!isMissingFileError(error)) throw error;
    }
  }
}

function isMissingFileError(error: unknown): error is Error & { code: 'ENOENT' } {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
