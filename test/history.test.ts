import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaults } from '../src/config.js';
import { loadCiRuns, loadEngineerFocusHistory, loadHistory, recordCiRuns, recordSnapshot, scopeFingerprint } from '../src/history.js';

const config = {
  ...defaults,
  engineers: [{ id: 'octocat', name: 'Mona' }],
  repositories: [{ name: 'org/core', priority: 'owned' }],
};
const data = {
  fetchedAt: '2026-08-12T12:00:00Z',
  engineers: [{ login: 'octocat', commits: 3, pullRequests: 2, merged: 1, reviews: 4, repositories: [
    { name: 'org/core', commits: 3, pullRequests: 2, merged: 1, reviews: 4, activeDays: 3 },
  ] }],
  repositories: [{ name: 'org/core', openPrs: 5, stalePrs: 1, waitingReviews: 2, staleIssues: 3, failedRuns: 0 }],
};

test('stores complete aggregate snapshots and deduplicates close refreshes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'signals-history-'));
  assert.equal(await recordSnapshot(config, data, dir), true);
  assert.equal(await recordSnapshot(config, { ...data, fetchedAt: '2026-08-12T12:05:00Z' }, dir), false);
  const history = loadHistory(config, 30, dir);
  assert.equal(history.length, 1);
  assert.equal(history[0].commits, 3);
  assert.equal(history[0].waiting_reviews, 2);
  assert.deepEqual(loadEngineerFocusHistory(config, 30, dir), [{
    captured_at: '2026-08-12T12:00:00Z', login: 'octocat', repository: 'org/core', commits: 3,
    pull_requests: 2, merged: 1, reviews: 4, active_days: 3,
  }]);
});

test('scope fingerprint changes with visible repository scope', () => {
  const withContribution = { ...config, repositories: [...config.repositories, { name: 'org/shared', priority: 'contributing' }] };
  assert.notEqual(scopeFingerprint(withContribution), scopeFingerprint({ ...withContribution, showContributingRepositories: true }));
});

test('does not store partial snapshots', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'signals-history-'));
  assert.equal(await recordSnapshot(config, { ...data, repositories: [{ name: 'org/core', error: 'failed' }] }, dir), false);
  assert.equal(loadHistory(config, 30, dir).length, 0);
});

test('stores and updates GitHub Actions runs without duplicates', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'github-signals-'));
  const run = {
    repository: 'org/core', id: 42, attempt: 1, workflowId: 7, workflowPath: '.github/workflows/ci.yml', workflow: 'CI', title: 'test change', event: 'pull_request',
    status: 'completed', conclusion: 'success', createdAt: '2026-08-12T10:00:00Z', startedAt: '2026-08-12T10:00:10Z',
    updatedAt: '2026-08-12T10:05:00Z', durationMs: 290000, queueMs: 10000, headSha: 'abc', headBranch: 'feature',
    actor: 'octocat', url: 'https://github.com/org/core/actions/runs/42', pullRequests: [12],
  };
  assert.equal(await recordCiRuns(config, [run], dir), 1);
  assert.equal(await recordCiRuns(config, [{ ...run, conclusion: 'failure' }], dir), 1);
  const runs = loadCiRuns(config, 100, dir);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].conclusion, 'failure');
  assert.equal(runs[0].workflowPath, '.github/workflows/ci.yml');
  assert.deepEqual(runs[0].pullRequests, [12]);
});
