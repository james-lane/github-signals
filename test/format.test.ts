import test from 'node:test';
import assert from 'node:assert/strict';
import { fitText, formatDuration, sparkline, stripAnsi, tableCell } from '../src/presentation/terminal/format.js';
import { percentile } from '../src/shared/statistics.js';

test('formats terminal values without counting ANSI styling as content', () => {
  const styled = '\x1b[31mFailure\x1b[0m';
  assert.equal(stripAnsi(styled), 'Failure');
  assert.equal(fitText(styled, 7), styled);
  assert.equal(tableCell('ok', 4), 'ok  ');
});

test('formats durations and charts at their domain edges', () => {
  assert.equal(formatDuration(null), '—');
  assert.equal(formatDuration(65_000), '1m05s');
  assert.equal(percentile([null, 30, 10, 20], 0.5), 20);
  assert.equal(sparkline([]), null);
  assert.equal(sparkline([5, 5]), '▄▄');
});
