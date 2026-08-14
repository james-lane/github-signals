import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaults, loadConfig, saveConfig, THEMES } from '../src/config.js';

test('uses defaults in a new workspace', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'signals-'));
  assert.deepEqual(await loadConfig(dir), defaults);
});

test('merges persisted thresholds with defaults', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'signals-'));
  await saveConfig({ hostname: 'github.example.com', engineers: ['octo'], repositories: [], thresholds: { stalePrDays: 7 } }, dir);
  const loaded = await loadConfig(dir);
  assert.equal(loaded.hostname, 'github.example.com');
  assert.equal(loaded.theme, 'default');
  assert.equal(loaded.showContributingRepositories, false);
  assert.equal(loaded.ciEnabled, false);
  assert.equal(loaded.historyRetentionDays, 90);
  assert.equal(loaded.thresholds.stalePrDays, 7);
  assert.equal(loaded.thresholds.reviewWaitHours, defaults.thresholds.reviewWaitHours);
  assert.equal((await readFile(path.join(dir, '.github-signals.json'))).toString().endsWith('\n'), true);
});

test('CI visibility is opt-in', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'signals-'));
  await saveConfig({ ...defaults, ciEnabled: true }, dir);
  assert.equal((await loadConfig(dir)).ciEnabled, true);
  await saveConfig({ ...defaults, ciEnabled: 'yes' }, dir);
  assert.equal((await loadConfig(dir)).ciEnabled, false);
});

test('accepts TVA theme and rejects unknown themes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'signals-'));
  await saveConfig({ ...defaults, theme: 'tva' }, dir);
  assert.equal((await loadConfig(dir)).theme, 'tva');
  await saveConfig({ ...defaults, theme: 'unknown' }, dir);
  assert.equal((await loadConfig(dir)).theme, 'default');
});

test('accepts every supported theme', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'signals-'));
  for (const theme of THEMES) {
    await saveConfig({ ...defaults, theme }, dir);
    assert.equal((await loadConfig(dir)).theme, theme);
  }
});

test('normalizes legacy and prioritised repositories', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'signals-'));
  await saveConfig({
    ...defaults,
    repositories: ['org/legacy', { name: 'org/core', priority: 'owned' }],
  }, dir);
  const loaded = await loadConfig(dir);
  assert.deepEqual(loaded.repositories, [
    { name: 'org/legacy', priority: 'contributing' },
    { name: 'org/core', priority: 'owned' },
  ]);
});

test('normalizes legacy and named engineers', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'signals-'));
  await saveConfig({
    ...defaults,
    engineers: ['octocat', { id: 'hubot', name: 'Hubot Robot' }],
  }, dir);
  const loaded = await loadConfig(dir);
  assert.deepEqual(loaded.engineers, [
    { id: 'octocat', name: 'octocat' },
    { id: 'hubot', name: 'Hubot Robot' },
  ]);
});

test('enforces private permissions on existing config and cache files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'signals-'));
  const configFile = path.join(dir, '.github-signals.json');
  const cacheFile = path.join(dir, '.github-signals-cache.json');
  await writeFile(configFile, '{}'); await chmod(configFile, 0o644);
  await writeFile(cacheFile, '{}'); await chmod(cacheFile, 0o644);
  await saveConfig({ ...defaults }, dir);
  const { saveCache } = await import('../src/config.js');
  await saveCache({}, dir);
  assert.equal((await stat(configFile)).mode & 0o777, 0o600);
  assert.equal((await stat(cacheFile)).mode & 0o777, 0o600);
});

test('rejects unsafe identifiers and bounds numeric settings', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'signals-'));
  await saveConfig({ ...defaults, hostname: 'evil.com/path', lookbackDays: 99999,
    engineers: [{ id: 'bad\u001b[2J', name: 'Bad\u001b]52;c;secret\u0007' }],
    repositories: [{ name: '../etc/passwd', priority: 'owned' }],
    thresholds: { stalePrDays: -1 }, historyRetentionDays: 0 }, dir);
  const loaded = await loadConfig(dir);
  assert.equal(loaded.hostname, 'github.com');
  assert.equal(loaded.lookbackDays, 14);
  assert.deepEqual(loaded.engineers, []);
  assert.deepEqual(loaded.repositories, []);
  assert.equal(loaded.historyRetentionDays, 90);
  assert.equal(loaded.thresholds.stalePrDays, 3);
});
