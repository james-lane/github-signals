// @ts-nocheck -- Node's experimental SQLite result types need a dedicated model layer.
import { chmod } from 'node:fs/promises';
import { chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { engineerId, repositoryName, visibleRepositories } from './config.js';

export const HISTORY_FILE = '.github-signals-history.sqlite';

export function scopeFingerprint(config) {
  const scope = {
    hostname: config.hostname,
    lookbackDays: config.lookbackDays,
    engineers: config.engineers.map(engineerId).sort(),
    repositories: visibleRepositories(config).map(repositoryName).sort(),
    thresholds: config.thresholds,
  };
  return createHash('sha256').update(JSON.stringify(scope)).digest('hex');
}

function openHistory(cwd = process.cwd()) {
  const filename = path.join(cwd, HISTORY_FILE);
  const db = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  db.exec(`
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
    DELETE FROM engineer_metrics WHERE snapshot_id NOT IN (SELECT id FROM snapshots);
    DELETE FROM repository_metrics WHERE snapshot_id NOT IN (SELECT id FROM snapshots);
  `);
  for (const suffix of ['-wal', '-shm']) {
    try { chmodSync(`${filename}${suffix}`, 0o600); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return db;
}

export async function recordSnapshot(config, data, cwd = process.cwd()) {
  if (!data || data.engineers?.some(item => item.error) || data.repositories?.some(item => item.error)) return false;
  const db = openHistory(cwd);
  try {
    const hash = scopeFingerprint(config);
    const last = db.prepare('SELECT captured_at FROM snapshots WHERE scope_hash = ? ORDER BY captured_at DESC LIMIT 1').get(hash);
    if (last && new Date(data.fetchedAt).getTime() - new Date(last.captured_at).getTime() < 15 * 60_000) return false;
    const engineers = data.engineers || [];
    const repositories = data.repositories || [];
    const team = engineers.reduce((a, x) => ({ commits: a.commits + x.commits, prs: a.prs + x.pullRequests, merged: a.merged + x.merged, reviews: a.reviews + x.reviews }), { commits: 0, prs: 0, merged: 0, reviews: 0 });
    const health = repositories.reduce((a, x) => ({ stale: a.stale + x.stalePrs, waiting: a.waiting + x.waitingReviews, issues: a.issues + x.staleIssues, ci: a.ci + x.failedRuns }), { stale: 0, waiting: 0, issues: 0, ci: 0 });
    db.exec('BEGIN');
    const result = db.prepare(`INSERT INTO snapshots
      (captured_at, scope_hash, lookback_days, commits, pull_requests, merged, reviews, stale_prs, waiting_reviews, stale_issues, ci_failures)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(data.fetchedAt, hash, config.lookbackDays, team.commits, team.prs, team.merged, team.reviews, health.stale, health.waiting, health.issues, health.ci);
    const snapshotId = Number(result.lastInsertRowid);
    const insertEngineer = db.prepare('INSERT INTO engineer_metrics VALUES (?, ?, ?, ?, ?, ?)');
    engineers.forEach(x => insertEngineer.run(snapshotId, x.login, x.commits, x.pullRequests, x.merged, x.reviews));
    const insertRepo = db.prepare('INSERT INTO repository_metrics VALUES (?, ?, ?, ?, ?, ?, ?)');
    repositories.forEach(x => insertRepo.run(snapshotId, x.name, x.openPrs, x.stalePrs, x.waitingReviews, x.staleIssues, x.failedRuns));
    const cutoff = new Date(Date.now() - config.historyRetentionDays * 86400000).toISOString();
    db.prepare('DELETE FROM snapshots WHERE captured_at < ?').run(cutoff);
    db.exec('COMMIT');
    await chmod(path.join(cwd, HISTORY_FILE), 0o600);
    return true;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  } finally { db.close(); }
}

export function loadHistory(config, limit = 30, cwd = process.cwd()) {
  const db = openHistory(cwd);
  try {
    return db.prepare('SELECT * FROM snapshots WHERE scope_hash = ? ORDER BY captured_at DESC LIMIT ?')
      .all(scopeFingerprint(config), limit).reverse();
  } finally { db.close(); }
}
// @ts-nocheck -- Node's experimental SQLite result types need a dedicated model layer.
