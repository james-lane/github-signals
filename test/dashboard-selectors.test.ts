import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCiMetrics, groupCiWorkflows, paginateCommits } from '../src/domain/dashboard-selectors.js';
import type { CiRun, OrganizationCommit } from '../src/domain/models.js';

const runs: CiRun[] = [
  {
    repository: 'org/core', id: 1, workflowId: 10, workflow: 'CI', title: 'success', status: 'completed', conclusion: 'success',
    createdAt: '2026-08-31T10:00:00Z', durationMs: 1000, queueMs: 100,
  },
  {
    repository: 'org/core', id: 2, workflowId: 10, workflow: 'CI', title: 'failure', status: 'completed', conclusion: 'failure',
    createdAt: '2026-08-31T11:00:00Z', durationMs: 3000, queueMs: 300,
  },
  {
    repository: 'org/web', id: 3, workflowId: 20, workflow: 'Deploy', title: 'running', status: 'in_progress',
    createdAt: '2026-08-31T12:00:00Z', durationMs: null, queueMs: 200,
  },
  { repository: 'org/unavailable', error: 'forbidden' },
];

test('calculates CI metrics without counting adapter errors', () => {
  assert.deepEqual(calculateCiMetrics(runs, 2, '2026-09-01T12:00:00Z'), {
    runs: 3,
    workflows: 2,
    failingWorkflows: 1,
    failed: 1,
    running: 1,
    successRate: 50,
    p50: 1000,
    p95: 3000,
    queue: 100,
  });
});

test('groups workflows by repository and workflow identity', () => {
  const groups = groupCiWorkflows(runs);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].workflow, 'CI');
  assert.equal(groups[0].failures, 1);
  assert.equal(groups[0].latest?.id, 2);
  assert.equal(groups[1].workflow, 'Deploy');
});

test('clamps commit pagination after a result set shrinks', () => {
  const commits: OrganizationCommit[] = Array.from({ length: 21 }, (_, index) => ({
    organization: 'org',
    repository: 'org/core',
    sha: String(index),
    branch: 'main',
    author: 'octocat',
    committedAt: '2026-09-01T00:00:00Z',
    message: `Change ${index}`,
    url: `https://github.com/org/core/commit/${index}`,
  }));
  const page = paginateCommits(commits, 99, 20);
  assert.equal(page.page, 1);
  assert.equal(page.pages, 2);
  assert.equal(page.rows.length, 1);
});
