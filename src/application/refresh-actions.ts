import { saveCache } from '../infrastructure/config/config-store.js';
import { fetchOrganizationCommits } from '../infrastructure/github/commits.js';
import { fetchSignals } from '../infrastructure/github/signals.js';
import { loadCiRuns, recordCiRuns } from '../infrastructure/storage/ci-run-store.js';
import {
  loadOrganizationCommitCursors,
  loadOrganizationCommits,
  recordOrganizationCommits,
} from '../infrastructure/storage/commit-store.js';
import {
  loadEngineerFocusHistory,
  loadHistory,
  recordSnapshot,
} from '../infrastructure/storage/snapshot-store.js';
import { errorMessage } from '../shared/errors.js';
import type { DashboardState } from './dashboard-state.js';

export interface RefreshTarget extends DashboardState {
  render(): void;
  success(message: string): string;
  warning(message: string): string;
  error(message: string): string;
}

export class RefreshActions {
  private lastRefreshStartedAt = 0;

  public constructor(private readonly target: RefreshTarget) {}

  public async refresh(): Promise<void> {
    if (!this.target.auth.loggedIn) {
      this.target.message = this.target.warning('Log in first with l.');
      this.target.render();
      return;
    }
    const remainingMilliseconds = 60_000 - (Date.now() - this.lastRefreshStartedAt);
    if (remainingMilliseconds > 0) {
      this.target.message = this.target.warning(`Please wait ${Math.ceil(remainingMilliseconds / 1000)}s before refreshing again.`);
      this.target.render();
      return;
    }

    this.lastRefreshStartedAt = Date.now();
    const controller = new AbortController();
    this.target.refreshController = controller;
    this.target.refreshProgress = { message: 'Starting refresh…', current: 0, total: 1 };
    try {
      const nextData = await fetchSignals(this.target.config, (message, progress) => {
        this.target.refreshProgress = { message, current: progress.current, total: progress.total };
        this.target.render();
      }, { signal: controller.signal });
      await this.persistRefresh(nextData, controller.signal);
    } catch (error: unknown) {
      this.target.message = controller.signal.aborted
        ? this.target.warning('Refresh cancelled. Previous signals retained.')
        : this.target.error(errorMessage(error));
    } finally {
      this.target.refreshController = null;
      this.target.refreshProgress = null;
    }
    this.target.render();
  }

  private async persistRefresh(nextData: NonNullable<DashboardState['data']>, signal: AbortSignal): Promise<void> {
    const target = this.target;
    target.data = nextData;
    target.ciView = null;
    target.ciErrors = nextData.ciRuns.filter(run => Boolean(run.error));
    await saveCache(nextData);
    if (target.config.ciEnabled) await recordCiRuns(target.config, nextData.ciRuns);
    target.ciRuns = target.config.ciEnabled ? loadCiRuns(target.config) : [];
    const recorded = await recordSnapshot(target.config, nextData);
    target.history = loadHistory(target.config);
    target.focusHistory = loadEngineerFocusHistory(target.config);
    if (target.config.organizations.length) await this.refreshCommitLedger(signal);
    target.message = target.success(recorded
      ? 'Signals refreshed · snapshot saved.'
      : 'Signals refreshed · recent snapshot retained.');
  }

  private async refreshCommitLedger(signal: AbortSignal): Promise<void> {
    const target = this.target;
    const cursors = loadOrganizationCommitCursors(target.config);
    const result = await fetchOrganizationCommits(target.config, cursors, (message, progress) => {
      target.refreshProgress = { message, current: progress.current, total: progress.total };
      target.render();
    }, { signal });
    await recordOrganizationCommits(target.config, result.commits);
    target.commitLedger.commits = loadOrganizationCommits(target.config);
    target.commitLedger.focusedCommits = null;
    target.commitLedger.repositoryFilter = '';
    target.commitLedger.repositories = new Set(target.commitLedger.commits.map(commit => commit.repository)).size;
    target.commitLedger.activeRepositories = result.activeRepositories;
    target.commitLedger.errors = result.errors;
    target.commitLedger.page = 0;
    target.commitLedger.selection = 0;
  }
}
