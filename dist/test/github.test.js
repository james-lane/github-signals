import test from 'node:test';
import assert from 'node:assert/strict';
import { engineerSignalsFromRepositories } from '../src/github.js';
test('derives private repository engineer activity from repository nodes', () => {
    const activity = [{
            name: 'org/private-repo',
            commits: [{ oid: '1', authors: { nodes: [{ user: { login: 'octocat' } }] } }],
            pullRequests: [{
                    id: 'PR_1',
                    createdAt: '2026-08-10T10:00:00Z',
                    mergedAt: '2026-08-11T10:00:00Z',
                    author: { login: 'octocat' },
                    reviews: { nodes: [
                            { submittedAt: '2026-08-11T09:00:00Z', author: { login: 'hubot' } },
                            { submittedAt: '2026-08-11T09:30:00Z', author: { login: 'hubot' } },
                        ] },
                }],
        }];
    assert.deepEqual(engineerSignalsFromRepositories([
        { id: 'octocat', name: 'Mona' },
        { id: 'hubot', name: 'Hubot' },
    ], activity, '2026-08-01'), [
        { login: 'octocat', commits: 1, pullRequests: 1, reviews: 0, merged: 1 },
        { login: 'hubot', commits: 0, pullRequests: 0, reviews: 1, merged: 0 },
    ]);
});
//# sourceMappingURL=github.test.js.map