import {
  getAuthenticationStatus as authStatus,
  logInToGitHub as login,
} from '../infrastructure/github/browser.js';
import { serializeConfig } from '../domain/configuration.js';
import { clearStoredData } from '../infrastructure/storage/history-database.js';
import { copyToClipboard } from '../infrastructure/system/clipboard.js';
import { fetchGitHubStatus } from '../infrastructure/github/status.js';
import { filterVisiblePullRequests, groupCiWorkflows, sortVisibleRepositories } from '../domain/dashboard-selectors.js';
import type {
  AppConfig,
  AuthState,
  CiRun,
  EngineerFocusHistoryRow,
  GitHubStatus,
  HistorySnapshot,
  OrganizationCommit,
  SignalSnapshot,
  ThemeName,
} from '../domain/models.js';
import type {
  CiView,
  CommitLedgerState,
  DashboardState,
  PromptState,
  PullRequestView,
  RefreshProgress,
  ViewName,
} from './dashboard-state.js';
import { DashboardRenderer } from '../presentation/dashboard-renderer.js';
import { currentCommitPage } from '../presentation/screens/commits-screen.js';
import { ANSI_ESCAPE } from '../presentation/terminal/format.js';
import { errorMessage } from '../shared/errors.js';
import { KeyboardRouter } from './keyboard-router.js';
import { SettingsActions } from './settings-actions.js';
import { RefreshActions } from './refresh-actions.js';
import { ConfigurationActions } from './configuration-actions.js';
import { NavigationActions } from './navigation-actions.js';

export interface AppInitialState {
  version: string;
  config: AppConfig;
  cache: SignalSnapshot | null;
  auth: AuthState;
  history?: HistorySnapshot[];
  ciRuns?: CiRun[];
  focusHistory?: EngineerFocusHistoryRow[];
  organizationCommits?: OrganizationCommit[];
}

export class GitHubSignalsApp implements DashboardState {
  public config: AppConfig;
  public data: SignalSnapshot | null;
  public auth: AuthState;
  public history: HistorySnapshot[];
  public focusHistory: EngineerFocusHistoryRow[];
  public tab = 0;
  public tabs: ViewName[];
  public message = '';
  public prompting = false;
  public refreshController: AbortController | null = null;
  public refreshProgress: RefreshProgress | null = null;
  public selection: Record<number, number> = { 1: 0, 2: 0 };
  public repositoryMetric = 0;
  public historySelection: number;
  public contentFocused = false;
  public settingsSelection = 0;
  public themeEditing = false;
  public prView: PullRequestView | null = null;
  public ciRuns: CiRun[];
  public ciErrors: CiRun[];
  public ciSelection = 0;
  public ciView: CiView | null = null;
  public showRenovatePullRequests = true;
  public githubStatus: GitHubStatus | null = null;
  public commitLedger: CommitLedgerState;

  private readonly renderer: DashboardRenderer;
  private readonly keyboard: KeyboardRouter;
  private readonly settings: SettingsActions;
  private readonly refreshes: RefreshActions;
  private readonly configuration: ConfigurationActions;
  private readonly navigation: NavigationActions;
  private busy = false;
  private promptState: PromptState | null = null;
  private statusTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  public constructor(initial: AppInitialState) {
    this.config = initial.config;
    this.data = initial.cache;
    this.auth = initial.auth;
    this.history = initial.history ?? [];
    this.focusHistory = initial.focusHistory ?? [];
    this.historySelection = Math.max(0, this.history.length - 1);
    this.ciRuns = initial.ciRuns ?? [];
    this.ciErrors = (initial.cache?.ciRuns ?? []).filter(run => Boolean(run.error));
    const commits = initial.organizationCommits ?? [];
    this.commitLedger = {
      loaded: true,
      commits,
      focusedCommits: null,
      repositories: new Set(commits.map(commit => commit.repository)).size,
      activeRepositories: 0,
      errors: [],
      page: 0,
      selection: 0,
      repositoryFilter: '',
    };
    this.tabs = this.buildTabs();
    this.renderer = new DashboardRenderer(this.config.theme, initial.version);
    this.keyboard = new KeyboardRouter(this);
    this.settings = new SettingsActions(this);
    this.refreshes = new RefreshActions(this);
    this.configuration = new ConfigurationActions(this);
    this.navigation = new NavigationActions(this);
  }

  public currentView(): ViewName {
    return this.tabs[this.tab] ?? 'Overview';
  }

  public start(): void {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error('GitHub Signals needs an interactive terminal.');
    }
    process.stdout.write(`${ANSI_ESCAPE}?1049h${ANSI_ESCAPE}H${ANSI_ESCAPE}2J${ANSI_ESCAPE}3J`);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', chunk => { void this.keyboard.handleInput(chunk); });
    process.stdout.on('resize', () => { if (!this.prompting) this.render(); });
    process.on('SIGTERM', () => this.quit());
    this.render();
    if (this.config.githubStatusEnabled) this.startGitHubStatusPolling();
  }

  private buildTabs(): ViewName[] {
    return [
      'Overview',
      'Engineers',
      'Repositories',
      ...(this.config.organizations.length ? ['Commits' as const] : []),
      ...(this.config.ciEnabled && this.config.repositories.length ? ['CI' as const] : []),
      ...(this.history.length ? ['History' as const] : []),
      'Settings',
    ];
  }

  private syncTabs(): void {
    const current = this.currentView();
    this.tabs = this.buildTabs();
    this.tab = Math.max(0, this.tabs.indexOf(current));
  }

  public render(): void {
    this.syncTabs();
    this.normalizeSelections();
    this.renderer.render(this);
  }

  private normalizeSelections(): void {
    this.selection[1] = Math.min(this.selection[1] ?? 0, Math.max(0, this.config.engineers.length - 1));
    this.selection[2] = Math.min(this.selection[2] ?? 0, Math.max(0, sortVisibleRepositories(this.config).length - 1));
    this.historySelection = Math.min(this.historySelection, Math.max(0, this.history.length - 1));
    this.ciSelection = Math.min(this.ciSelection, Math.max(0, groupCiWorkflows(this.ciRuns).length - 1));
    if (this.prView) {
      const pullRequests = filterVisiblePullRequests(this.prView.pullRequests, this.showRenovatePullRequests);
      this.prView.selection = Math.min(this.prView.selection, Math.max(0, pullRequests.length - 1));
    }
    if (this.ciView) {
      const items = this.ciView.type === 'workflow' ? this.ciView.group.runs : this.ciView.jobs;
      this.ciView.selection = Math.min(this.ciView.selection, Math.max(0, items.length - 1));
    }
    const commitPage = currentCommitPage(this);
    this.commitLedger.page = commitPage.page;
    this.commitLedger.selection = Math.min(this.commitLedger.selection, Math.max(0, commitPage.rows.length - 1));
  }

  private selectableItemCount(): number {
    if (this.currentView() === 'Engineers') return this.config.engineers.length;
    if (this.currentView() === 'Repositories') return sortVisibleRepositories(this.config).length;
    return 0;
  }

  public moveSelection(delta: number): void {
    const itemCount = this.selectableItemCount();
    if (!itemCount) return;
    const current = this.selection[this.tab] ?? 0;
    this.selection[this.tab] = (current + delta + itemCount) % itemCount;
  }

  public moveCiSelection(delta: number): void {
    if (!this.ciView) {
      const groups = groupCiWorkflows(this.ciRuns);
      if (groups.length) this.ciSelection = Math.max(0, Math.min(groups.length - 1, this.ciSelection + delta));
      return;
    }
    const items = this.ciView.type === 'workflow' ? this.ciView.group.runs : this.ciView.jobs;
    if (items.length) this.ciView.selection = Math.max(0, Math.min(items.length - 1, this.ciView.selection + delta));
  }

  public async openCiSelected(): Promise<void> {
    await this.navigation.openCiSelected();
  }

  public async openCurrentOnWeb(): Promise<void> {
    await this.navigation.openCurrentOnWeb();
  }

  public async openSelected(): Promise<void> {
    await this.navigation.openSelected();
  }

  public async filterCommitLedger(): Promise<void> {
    await this.navigation.filterCommitLedger();
  }

  public async openCommitOnWeb(): Promise<void> {
    await this.navigation.openCommitOnWeb();
  }

  public async copySettings(): Promise<void> {
    await copyToClipboard(serializeConfig(this.config));
    this.message = this.success('Setup copied to clipboard · cache and history excluded.');
    this.render();
  }

  public async editSelectedSetting(): Promise<void> {
    await this.settings.editSelectedSetting();
  }

  public async cycleTheme(delta: number): Promise<void> {
    await this.settings.cycleTheme(delta);
  }

  public async prompt(question: string, initial = ''): Promise<string> {
    this.prompting = true;
    process.stdout.write(`${ANSI_ESCAPE}?25h\n${question}${initial ? ` [${initial}]` : ''}: `);
    const answer = await new Promise<string>(resolve => {
      this.promptState = { buffer: '', initial, resolve };
    });
    this.prompting = false;
    return answer.trim() || initial;
  }

  public handlePromptInput(chunk: Buffer): void {
    const state = this.promptState;
    if (!state) return;
    for (const character of chunk.toString()) {
      if (character === '\r' || character === '\n') {
        this.promptState = null;
        process.stdout.write('\n');
        state.resolve(state.buffer);
        return;
      }
      if (character === '\u0003') this.quit();
      if (character === '\u001b') {
        this.promptState = null;
        process.stdout.write(`${this.muted('(cancelled)')}\n`);
        state.resolve(state.initial);
        return;
      }
      if (character === '\u007f' || character === '\b') {
        if (state.buffer) {
          state.buffer = state.buffer.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (character >= ' ' && character !== '\u007f') {
        state.buffer += character;
        process.stdout.write(character);
      }
    }
  }

  public async add(): Promise<void> {
    await this.configuration.add();
  }

  public async remove(): Promise<void> {
    await this.configuration.remove();
  }

  public async prioritizeRepository(): Promise<void> {
    await this.configuration.prioritizeRepository();
  }

  public async refresh(): Promise<void> {
    await this.refreshes.refresh();
  }

  public async logIn(): Promise<void> {
    this.prompting = true;
    process.stdout.write(`${ANSI_ESCAPE}?25h${ANSI_ESCAPE}2J${ANSI_ESCAPE}H`);
    process.stdin.setRawMode(false);
    try {
      await login(this.config.hostname);
      this.auth = await authStatus(this.config.hostname);
      this.message = this.success('Authenticated. Press r to refresh.');
    } catch (error: unknown) {
      this.message = this.error(errorMessage(error));
    } finally {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      this.prompting = false;
    }
    this.render();
  }

  public async runAction(action: () => Promise<unknown> | unknown): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await action();
    } catch (error: unknown) {
      this.message = this.error(errorMessage(error));
      this.render();
    } finally {
      this.busy = false;
    }
  }

  public async clearDatabaseSection(): Promise<void> {
    const section = (await this.prompt('Clear database section (snapshots/ci/commits/all)')).toLowerCase();
    if (!['snapshots', 'ci', 'commits', 'all'].includes(section)) {
      this.message = this.warning('Nothing cleared. Choose snapshots, ci, commits, or all.');
      this.render();
      return;
    }
    const confirmation = await this.prompt(`Type clear ${section} to confirm`);
    if (confirmation.toLowerCase() !== `clear ${section}`) {
      this.message = this.warning('Database clear cancelled.');
      this.render();
      return;
    }
    clearStoredData(section);
    if (section === 'snapshots' || section === 'all') {
      this.history = [];
      this.focusHistory = [];
    }
    if (section === 'ci' || section === 'all') this.ciRuns = [];
    if (section === 'commits' || section === 'all') {
      Object.assign(this.commitLedger, {
        commits: [],
        focusedCommits: null,
        repositoryFilter: '',
        repositories: 0,
        errors: [],
        page: 0,
        selection: 0,
      });
    }
    this.message = this.success(`${section} database data cleared. Configuration and cache retained.`);
    this.render();
  }

  public hasActivePrompt(): boolean {
    return this.promptState !== null;
  }

  public isBusy(): boolean {
    return this.busy;
  }

  public async openGitHubStatus(): Promise<void> {
    await this.navigation.openGitHubStatus();
  }

  public async openSelectedPullRequest(): Promise<void> {
    await this.navigation.openSelectedPullRequest();
  }

  public applyTheme(theme: ThemeName): void {
    this.renderer.theme.set(theme);
  }

  public setGitHubStatusPolling(enabled: boolean): void {
    if (enabled) {
      this.startGitHubStatusPolling();
      return;
    }
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = null;
    this.githubStatus = null;
  }

  private startGitHubStatusPolling(): void {
    if (this.statusTimer) clearInterval(this.statusTimer);
    void this.updateGitHubStatus();
    this.statusTimer = setInterval(() => { void this.updateGitHubStatus(); }, 60_000);
    this.statusTimer.unref();
  }

  private async updateGitHubStatus(): Promise<void> {
    try {
      this.githubStatus = await fetchGitHubStatus();
    } catch {
      this.githubStatus = {
        indicator: 'unavailable',
        description: 'Unavailable',
        checkedAt: new Date().toISOString(),
      };
    }
    if (!this.stopped && !this.prompting) this.render();
  }

  public quit(): never {
    this.stopped = true;
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.refreshController?.abort();
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(`${ANSI_ESCAPE}?25h${ANSI_ESCAPE}?1049l`);
    process.exit(0);
  }

  public accent(message: string): string { return this.renderer.theme.accent(message); }
  public success(message: string): string { return this.renderer.theme.success(message); }
  public warning(message: string): string { return this.renderer.theme.warning(message); }
  public error(message: string): string { return this.renderer.theme.error(message); }
  private muted(message: string): string { return this.renderer.theme.muted(message); }
}
