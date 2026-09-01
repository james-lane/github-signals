import { filterVisiblePullRequests, groupCiWorkflows } from '../domain/dashboard-selectors.js';
import { currentCommitPage, COMMIT_PAGE_SIZE } from '../presentation/screens/commits-screen.js';
import { SETTINGS_COUNT } from '../presentation/screens/settings-screen.js';
import type { DashboardState } from './dashboard-state.js';

export interface KeyboardTarget extends DashboardState {
  hasActivePrompt(): boolean;
  handlePromptInput(chunk: Buffer): void;
  quit(): never;
  isBusy(): boolean;
  render(): void;
  warning(message: string): string;
  success(message: string): string;
  runAction(action: () => Promise<unknown> | unknown): Promise<void>;
  openGitHubStatus(): Promise<void>;
  openCommitOnWeb(): Promise<void>;
  openCurrentOnWeb(): Promise<void>;
  filterCommitLedger(): Promise<void>;
  copySettings(): Promise<void>;
  clearDatabaseSection(): Promise<void>;
  cycleTheme(delta: number): Promise<void>;
  add(): Promise<void>;
  remove(): Promise<void>;
  prioritizeRepository(): Promise<void>;
  refresh(): Promise<void>;
  logIn(): Promise<void>;
  openSelectedPullRequest(): Promise<void>;
  openCiSelected(): Promise<void>;
  editSelectedSetting(): Promise<void>;
  openSelected(): Promise<void>;
  moveCiSelection(delta: number): void;
  moveSelection(delta: number): void;
}

export class KeyboardRouter {
  public constructor(private readonly target: KeyboardTarget) {}

  public async handleInput(chunk: Buffer): Promise<void> {
    if (this.target.hasActivePrompt()) {
      this.target.handlePromptInput(chunk);
      return;
    }
    const key = chunk.toString();
    if (key === '\u0003') this.target.quit();
    if (key === 'c' && this.target.refreshController) {
      this.target.refreshController.abort();
      this.target.message = this.target.warning('Cancelling refresh…');
      if (this.target.refreshProgress) this.target.refreshProgress.message = 'Cancelling refresh…';
      this.target.render();
      return;
    }
    if (key === 'q') this.target.quit();
    if (this.target.isBusy() && !this.target.refreshController) return;
    if (await this.handleDirectAction(key)) return;
    if (this.handleEscape(key)) return;
    if (await this.handleNavigation(key)) return;

    this.target.message = '';
    if (key === 'v' && (this.target.prView || this.target.currentView() === 'Repositories')) {
      this.target.showRenovatePullRequests = !this.target.showRenovatePullRequests;
      if (this.target.prView) this.target.prView.selection = 0;
      this.target.render();
      return;
    }
    if (this.target.prView && key !== '\r' && key !== '\n') {
      this.target.render();
      return;
    }
    if (key === 'a') return this.target.runAction(() => this.target.add());
    if (key === 'd') return this.target.runAction(() => this.target.remove());
    if (key === 'p') return this.target.runAction(() => this.target.prioritizeRepository());
    if (key === 'r') return this.target.runAction(() => this.target.refresh());
    if (key === 'l') return this.target.runAction(() => this.target.logIn());
    if (key === '\r' || key === '\n') {
      await this.handleEnter();
      return;
    }
    this.target.render();
  }

  private async handleDirectAction(key: string): Promise<boolean> {
    if (key === 's') {
      await this.target.runAction(() => this.target.openGitHubStatus());
      return true;
    }
    if (key === 'w' && this.target.currentView() === 'Commits' && this.target.contentFocused) {
      await this.target.runAction(() => this.target.openCommitOnWeb());
      return true;
    }
    if (key === 'w' && (this.target.prView || this.target.currentView() === 'CI')) {
      await this.target.runAction(() => this.target.openCurrentOnWeb());
      return true;
    }
    if (key === 'f' && this.target.currentView() === 'Commits' && this.target.contentFocused && this.target.commitLedger.loaded) {
      await this.target.runAction(() => this.target.filterCommitLedger());
      return true;
    }
    if (key === 'y' && this.target.currentView() === 'Settings' && !this.target.themeEditing) {
      await this.target.runAction(() => this.target.copySettings());
      return true;
    }
    if (key === 'x' && this.target.currentView() === 'Settings' && this.target.contentFocused && !this.target.themeEditing) {
      await this.target.runAction(() => this.target.clearDatabaseSection());
      return true;
    }
    return false;
  }

  private handleEscape(key: string): boolean {
    if (key !== '\u001b') return false;
    if (this.target.prView) {
      this.target.prView = null;
      this.target.message = '';
      this.target.render();
      return true;
    }
    if (this.target.ciView) {
      if (this.target.ciView.type === 'run') {
        this.target.ciView = {
          type: 'workflow',
          group: this.target.ciView.group,
          selection: this.target.ciView.group.runs.indexOf(this.target.ciView.run),
        };
      } else this.target.ciView = null;
      this.target.message = '';
      this.target.render();
      return true;
    }
    if (!this.target.contentFocused) return false;
    if (this.target.currentView() === 'Settings' && this.target.themeEditing) {
      this.target.themeEditing = false;
      this.target.message = this.target.success('Theme saved.');
    } else {
      this.target.contentFocused = false;
      this.target.message = '';
    }
    this.target.render();
    return true;
  }

  private async handleNavigation(key: string): Promise<boolean> {
    if (key === '\t' && !this.target.contentFocused) {
      this.target.tab = (this.target.tab + 1) % this.target.tabs.length;
      this.target.render();
      return true;
    }
    if (key === '\u001b[C' || key === '\u001b[D') {
      const delta = key === '\u001b[C' ? 1 : -1;
      if (!this.target.prView && this.target.contentFocused && this.target.currentView() === 'Commits' && this.target.commitLedger.loaded) {
        const commits = this.target.commitLedger.focusedCommits ?? this.target.commitLedger.commits;
        const pageCount = Math.max(1, Math.ceil(commits.length / COMMIT_PAGE_SIZE));
        this.target.commitLedger.page = Math.max(0, Math.min(pageCount - 1, this.target.commitLedger.page + delta));
        this.target.commitLedger.selection = 0;
      } else if (!this.target.prView && this.target.contentFocused && this.target.currentView() === 'Repositories') {
        this.target.repositoryMetric = Math.max(0, Math.min(6, this.target.repositoryMetric + delta));
      } else if (!this.target.prView && this.target.contentFocused && this.target.currentView() === 'Settings' && this.target.themeEditing) {
        await this.target.runAction(() => this.target.cycleTheme(delta));
        return true;
      } else if (!this.target.contentFocused) {
        this.target.tab = (this.target.tab + delta + this.target.tabs.length) % this.target.tabs.length;
      }
      this.target.render();
      return true;
    }
    if ((key === '\u001b[A' || key === '\u001b[B') && this.target.contentFocused && !this.target.themeEditing) {
      this.moveVertical(key === '\u001b[A' ? -1 : 1);
      this.target.render();
      return true;
    }
    return false;
  }

  private moveVertical(delta: number): void {
    if (this.target.prView) {
      const visible = filterVisiblePullRequests(this.target.prView.pullRequests, this.target.showRenovatePullRequests);
      const maximum = Math.max(0, visible.length - 1);
      this.target.prView.selection = Math.max(0, Math.min(maximum, this.target.prView.selection + delta));
    } else if (this.target.currentView() === 'Commits') {
      const maximum = Math.max(0, currentCommitPage(this.target).rows.length - 1);
      this.target.commitLedger.selection = Math.max(0, Math.min(maximum, this.target.commitLedger.selection + delta));
    } else if (this.target.currentView() === 'CI') {
      this.target.moveCiSelection(delta);
    } else if (this.target.currentView() === 'Settings') {
      this.target.settingsSelection = (this.target.settingsSelection + delta + SETTINGS_COUNT) % SETTINGS_COUNT;
    } else if (this.target.currentView() === 'History') {
      this.target.historySelection = Math.max(0, Math.min(this.target.history.length - 1, this.target.historySelection - delta));
    } else {
      this.target.moveSelection(delta);
    }
  }

  private async handleEnter(): Promise<void> {
    if (this.target.prView?.pullRequests.length) {
      await this.target.runAction(() => this.target.openSelectedPullRequest());
      return;
    }
    if (!this.target.contentFocused && this.currentViewHasSelectableContent()) {
      this.target.contentFocused = true;
      this.target.render();
      return;
    }
    if (this.target.contentFocused && this.target.currentView() === 'Commits') return this.target.runAction(() => this.target.openCommitOnWeb());
    if (this.target.contentFocused && this.target.currentView() === 'CI') return this.target.runAction(() => this.target.openCiSelected());
    if (this.target.contentFocused && this.target.currentView() === 'Settings') return this.target.runAction(() => this.target.editSelectedSetting());
    if (this.target.contentFocused) await this.target.runAction(() => this.target.openSelected());
  }

  private currentViewHasSelectableContent(): boolean {
    switch (this.target.currentView()) {
      case 'Engineers': return Boolean(this.target.config.engineers.length);
      case 'Repositories': return Boolean(this.target.config.repositories.length);
      case 'Commits': return true;
      case 'CI': return Boolean(groupCiWorkflows(this.target.ciRuns).length);
      case 'Settings': return true;
      case 'History': return Boolean(this.target.history.length);
      default: return false;
    }
  }
}
