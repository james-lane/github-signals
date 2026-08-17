import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateEngineerFocus, focusScore } from '../src/focus.js';
test('aggregates team focus by repository and ignores failed engineers', () => {
    const result = aggregateEngineerFocus([
        { login: 'one', repositories: [
                { name: 'org/api', commits: 2, pullRequests: 1, merged: 0, reviews: 1, activeDays: 2 },
                { name: 'org/web', commits: 1, pullRequests: 0, merged: 0, reviews: 0, activeDays: 1 },
            ] },
        { login: 'two', repositories: [
                { name: 'org/api', commits: 3, pullRequests: 0, merged: 1, reviews: 0, activeDays: 2 },
            ] },
        { login: 'failed', error: 'unavailable', repositories: [{ name: 'org/api', commits: 99 }] },
    ]);
    assert.deepEqual(result.repositories, [
        { name: 'org/api', commits: 5, pullRequests: 1, merged: 1, reviews: 1, activeDays: 4 },
        { name: 'org/web', commits: 1, pullRequests: 0, merged: 0, reviews: 0, activeDays: 1 },
    ]);
    assert.equal(focusScore(result.repositories[0]), 12);
});
//# sourceMappingURL=focus.test.js.map