import test from 'node:test';
import assert from 'node:assert/strict';
import { ciContextWebUrl, workflowWebUrl } from '../src/web-navigation.js';
const group = {
    repository: 'octo-org/core',
    latest: { workflowId: 42, workflowPath: '.github/workflows/pull-request-build.yml', url: 'https://github.com/octo-org/core/actions/runs/100' },
};
test('builds a workflow page URL for the selected CI pipeline', () => {
    assert.equal(workflowWebUrl('github.com', group), 'https://github.com/octo-org/core/actions/workflows/pull-request-build.yml');
});
test('falls back to workflow ID for older stored runs', () => {
    assert.equal(workflowWebUrl('github.com', { ...group, latest: { workflowId: 42 } }), 'https://github.com/octo-org/core/actions/workflows/42');
});
test('prefers the most specific CI web target', () => {
    const run = { url: 'https://github.com/octo-org/core/actions/runs/100' };
    const job = { url: 'https://github.com/octo-org/core/actions/runs/100/job/7' };
    assert.equal(ciContextWebUrl('github.com', group, run), run.url);
    assert.equal(ciContextWebUrl('github.com', group, run, job), job.url);
});
//# sourceMappingURL=web-navigation.test.js.map