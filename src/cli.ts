#!/usr/bin/env node
import { GitHubSignalsApp } from './application/github-signals-app.js';
import type { SignalSnapshot } from './domain/models.js';
import { loadConfig, loadCache } from './infrastructure/config/config-store.js';
import { getAuthenticationStatus as authStatus } from './infrastructure/github/browser.js';
import { APP_VERSION } from './infrastructure/runtime/version.js';
import { loadCiRuns } from './infrastructure/storage/ci-run-store.js';
import { loadOrganizationCommits } from './infrastructure/storage/commit-store.js';
import { loadEngineerFocusHistory, loadHistory } from './infrastructure/storage/snapshot-store.js';
import { ANSI_ESCAPE } from './presentation/terminal/format.js';
import { errorMessage } from './shared/errors.js';

async function main(): Promise<void> {
  const config = await loadConfig();
  const [cache, auth] = await Promise.all([
    loadCache<SignalSnapshot>(),
    authStatus(config.hostname),
  ]);
  new GitHubSignalsApp({
    version: APP_VERSION,
    config,
    cache,
    auth,
    history: loadHistory(config),
    focusHistory: loadEngineerFocusHistory(config),
    ciRuns: config.ciEnabled ? loadCiRuns(config) : [],
    organizationCommits: loadOrganizationCommits(config),
  }).start();
}

try {
  await main();
} catch (error: unknown) {
  process.stdout.write(`${ANSI_ESCAPE}?25h`);
  console.error(`github-signals: ${errorMessage(error)}`);
  process.exitCode = 1;
}
