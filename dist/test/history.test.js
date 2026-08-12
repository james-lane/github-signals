import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaults } from '../src/config.js';
import { loadHistory, recordSnapshot, scopeFingerprint } from '../src/history.js';
const config = {
    ...defaults,
    engineers: [{ id: 'octocat', name: 'Mona' }],
    repositories: [{ name: 'org/core', priority: 'owned' }],
};
const data = {
    fetchedAt: '2026-08-12T12:00:00Z',
    engineers: [{ login: 'octocat', commits: 3, pullRequests: 2, merged: 1, reviews: 4 }],
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
//# sourceMappingURL=history.test.js.map