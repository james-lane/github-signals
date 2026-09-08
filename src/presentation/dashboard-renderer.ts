import type { DashboardState } from '../application/dashboard-state.js';
import { renderCiScreen } from './screens/ci-screen.js';
import { renderCommitsScreen } from './screens/commits-screen.js';
import { renderEngineersScreen } from './screens/engineers-screen.js';
import { renderHistoryScreen } from './screens/history-screen.js';
import { renderOverviewScreen } from './screens/overview-screen.js';
import { renderRepositoriesScreen } from './screens/repositories-screen.js';
import { renderSettingsScreen } from './screens/settings-screen.js';
import { TerminalCanvas } from './terminal/canvas.js';
import { ANSI_ESCAPE, fitText, stripAnsi } from './terminal/format.js';
import { TerminalTheme } from './terminal/theme.js';

export class DashboardRenderer {
  public readonly theme: TerminalTheme;
  private readonly canvas: TerminalCanvas;

  public constructor(themeName: DashboardState['config']['theme'], version: string) {
    this.theme = new TerminalTheme(themeName);
    this.canvas = new TerminalCanvas(this.theme, version);
  }

  public render(state: DashboardState): void {
    if (!state.prompting && process.stdin.isTTY && !process.stdin.isRaw) process.stdin.setRawMode(true);
    this.writeScreenPreamble(state);
    this.renderHeader(state);
    this.renderNavigation(state);
    this.canvas.line();
    this.renderCurrentScreen(state);
    this.canvas.line();
    this.canvas.line(this.theme.muted('─'.repeat(Math.max(60, this.canvas.width))));
    this.canvas.footer(state.refreshController ? this.refreshFooter(state) : this.footerText(state));
    process.stdout.write(`${ANSI_ESCAPE}3J`);
  }

  private writeScreenPreamble(state: DashboardState): void {
    process.stdout.write(`\x1b]0;GitHub Signals — ${state.currentView()}\x07${ANSI_ESCAPE}?25l${ANSI_ESCAPE}H${ANSI_ESCAPE}2J`);
  }

  private renderHeader(state: DashboardState): void {
    const authentication = state.auth.loggedIn
      ? this.theme.success('● gh authenticated')
      : this.theme.warning('○ login required');
    const left = `${this.theme.bold(this.theme.accent('◈ GitHub Signals'))}  ${authentication}  ${this.theme.muted(state.config.hostname)}`;
    const right = this.statusBadge(state);
    if (!right) {
      this.canvas.line(left);
    } else {
      const headerWidth = Math.max(60, this.canvas.width) - 2;
      const visibleRight = fitText(right, Math.max(1, headerWidth - stripAnsi(left).length - 2));
      const gap = Math.max(2, headerWidth - stripAnsi(left).length - stripAnsi(visibleRight).length);
      this.canvas.line(`${left}${' '.repeat(gap)}${visibleRight}`);
    }
    this.canvas.line(this.theme.muted('─'.repeat(Math.max(60, this.canvas.width))));
  }

  private renderNavigation(state: DashboardState): void {
    this.canvas.line(state.tabs.map((tab, index) => {
      if (index !== state.tab) return this.theme.muted(`  ${tab}  `);
      const selected = this.theme.bold(`[ ${tab} ]`);
      return state.contentFocused ? this.theme.navigationAccent(selected) : selected;
    }).join(' '));
  }

  private renderCurrentScreen(state: DashboardState): void {
    switch (state.currentView()) {
      case 'Overview': renderOverviewScreen(this.canvas, state); break;
      case 'Engineers': renderEngineersScreen(this.canvas, state); break;
      case 'Repositories': renderRepositoriesScreen(this.canvas, state); break;
      case 'Commits': renderCommitsScreen(this.canvas, state); break;
      case 'CI': renderCiScreen(this.canvas, state); break;
      case 'History': renderHistoryScreen(this.canvas, state); break;
      case 'Settings': renderSettingsScreen(this.canvas, state); break;
    }
  }

  private statusBadge(state: DashboardState): string {
    if (!state.config.githubStatusEnabled) return '';
    if (!state.githubStatus) return this.theme.muted('GitHub status ◌ checking');
    const { indicator, description } = state.githubStatus;
    if (indicator === 'unavailable') return this.theme.muted('GitHub status ○ unavailable');
    const statusColor = indicator === 'none'
      ? this.theme.success.bind(this.theme)
      : indicator === 'minor' || indicator === 'maintenance'
        ? this.theme.warning.bind(this.theme)
        : this.theme.error.bind(this.theme);
    return `${this.theme.muted('GitHub status')} ${statusColor('●')} ${statusColor(description)}`;
  }

  private refreshFooter(state: DashboardState): string {
    const progress = state.refreshProgress ?? { message: 'Refreshing…', current: 0, total: 1 };
    const ratio = Math.max(0, Math.min(1, progress.total ? progress.current / progress.total : 0));
    const barWidth = Math.max(10, Math.min(28, Math.floor(this.canvas.width / 7)));
    const filled = Math.round(ratio * barWidth);
    const bar = `${this.theme.accent('█'.repeat(filled))}${this.theme.muted('░'.repeat(barWidth - filled))}`;
    return `${this.theme.muted('[')}${bar}${this.theme.muted(']')} ${this.theme.accent(`${String(Math.round(ratio * 100)).padStart(3)}%`)}  ${progress.message}  ${this.theme.muted('c cancel')}`;
  }

  private footerText(state: DashboardState): string {
    if (state.message) return state.message;
    const renovateToggle = state.prView || state.currentView() === 'Repositories'
      ? `  v Renovate ${state.showRenovatePullRequests ? 'shown' : 'hidden'}`
      : '';
    const navigation = state.prView
      ? '↑/↓ pull request  Enter open  w web  Esc repositories'
      : state.currentView() === 'CI' && state.ciView?.type === 'run'
        ? '↑/↓ job  Enter open  w web  Esc runs'
        : state.currentView() === 'CI' && state.ciView?.type === 'workflow'
          ? '↑/↓ run  Enter jobs  w web  Esc workflows'
          : state.contentFocused
            ? this.focusedNavigation(state)
            : '←/→ views  Enter select';
    return this.theme.muted(`${navigation}${renovateToggle}  r refresh  s status  a add  d delete  p priority  l login  q quit`);
  }

  private focusedNavigation(state: DashboardState): string {
    switch (state.currentView()) {
      case 'Repositories': return '↑/↓ repo  ←/→ metric  Enter open  Esc nav';
      case 'Commits': return '↑/↓ commit  ←/→ page  f repo focus  Enter/w web  Esc nav';
      case 'CI': return `↑/↓ workflow  Enter runs  f ${state.ciWorkflowFilter ? 'clear filter' : 'filter'}  w web  Esc nav`;
      case 'History': return '↑/↓ snapshot  Esc nav';
      case 'Settings': return state.themeEditing
        ? '←/→ preview theme  Enter apply  Esc setting'
        : '↑/↓ setting  Enter edit  y copy setup  x clear data  Esc nav';
      default: return '↑/↓ engineer  Enter open  Esc nav';
    }
  }
}
