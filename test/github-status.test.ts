import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGitHubStatus } from '../src/github-status.js';

test('parses supported GitHub Status responses', () => {
  const status = parseGitHubStatus({ status: { indicator: 'minor', description: 'Minor Service Outage' } });
  assert.equal(status.indicator, 'minor');
  assert.equal(status.description, 'Minor Service Outage');
  assert.match(status.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('rejects malformed GitHub Status responses', () => {
  assert.throws(() => parseGitHubStatus({ status: { indicator: 'surprise', description: 'Fine' } }), /unexpected response/);
  assert.throws(() => parseGitHubStatus({}), /unexpected response/);
});
