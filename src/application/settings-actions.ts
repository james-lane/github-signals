import { THEMES } from '../domain/configuration.js';
import { saveConfig } from '../infrastructure/config/config-store.js';
import { getAuthenticationStatus as authStatus } from '../infrastructure/github/browser.js';
import { loadCiRuns } from '../infrastructure/storage/ci-run-store.js';
import type { ThemeName } from '../domain/models.js';
import { THEME_LABELS } from '../presentation/terminal/theme.js';
import type { DashboardState } from './dashboard-state.js';

export interface SettingsTarget extends DashboardState {
  prompt(question: string, initial?: string): Promise<string>;
  render(): void;
  success(message: string): string;
  applyTheme(theme: ThemeName): void;
  setGitHubStatusPolling(enabled: boolean): void;
}

export class SettingsActions {
  public constructor(private readonly target: SettingsTarget) {}

  public async editSelectedSetting(): Promise<void> {
    if (this.target.settingsSelection === 1) {
      this.target.themeEditing = !this.target.themeEditing;
      if (!this.target.themeEditing) {
        await saveConfig(this.target.config);
        this.target.message = this.target.success('Theme saved.');
      }
      this.target.render();
      return;
    }
    if (this.target.settingsSelection === 3) {
      await this.toggleContributingRepositories();
      return;
    }
    if (this.target.settingsSelection === 4) {
      await this.toggleCiVisibility();
      return;
    }
    if (this.target.settingsSelection === 5) {
      await this.toggleGitHubStatus();
      return;
    }
    await this.promptAndApplySetting();
  }

  public async cycleTheme(delta: number): Promise<void> {
    const current = Math.max(0, THEMES.indexOf(this.target.config.theme));
    const theme = THEMES[(current + delta + THEMES.length) % THEMES.length] as ThemeName;
    this.target.config.theme = theme;
    this.target.applyTheme(theme);
    await saveConfig(this.target.config);
    this.target.message = `${THEME_LABELS[theme]} · live preview`;
    this.target.render();
  }

  private async toggleContributingRepositories(): Promise<void> {
    const config = this.target.config;
    config.showContributingRepositories = !config.showContributingRepositories;
    await saveConfig(config);
    this.target.message = this.target.success(`Contributing repositories ${config.showContributingRepositories ? 'shown' : 'hidden'}.`);
    this.target.render();
  }

  private async toggleCiVisibility(): Promise<void> {
    const config = this.target.config;
    config.ciEnabled = !config.ciEnabled;
    await saveConfig(config);
    this.target.ciRuns = config.ciEnabled ? loadCiRuns(config) : [];
    this.target.ciErrors = [];
    this.target.ciView = null;
    this.target.message = this.target.success(`CI visibility ${config.ciEnabled ? 'enabled' : 'disabled'}.`);
    this.target.render();
  }

  private async toggleGitHubStatus(): Promise<void> {
    const config = this.target.config;
    config.githubStatusEnabled = !config.githubStatusEnabled;
    await saveConfig(config);
    this.target.setGitHubStatusPolling(config.githubStatusEnabled);
    this.target.message = this.target.success(`GitHub status ${config.githubStatusEnabled ? 'enabled' : 'disabled'}.`);
    this.target.render();
  }

  private async promptAndApplySetting(): Promise<void> {
    const editor = settingEditor(this.target, this.target.settingsSelection);
    if (!editor) return;
    editor.apply(await this.target.prompt(editor.question, String(editor.current)));
    await saveConfig(this.target.config);
    if (this.target.settingsSelection === 0) this.target.auth = await authStatus(this.target.config.hostname);
    this.target.message = this.target.success('Setting saved.');
    this.target.render();
  }
}

interface SettingEditor {
  question: string;
  current: string | number;
  apply: (value: string) => void;
}

function settingEditor(target: SettingsTarget, index: number): SettingEditor | undefined {
  const config = target.config;
  const thresholds = config.thresholds;
  const editors: Partial<Record<number, SettingEditor>> = {
    0: { question: 'GitHub hostname', current: config.hostname, apply: value => { config.hostname = value; } },
    2: { question: 'Activity lookback (days)', current: config.lookbackDays, apply: value => { config.lookbackDays = Number(value) || 14; } },
    6: { question: 'Stale PR threshold (days)', current: thresholds.stalePrDays, apply: value => { thresholds.stalePrDays = Number(value) || 3; } },
    7: { question: 'Review wait threshold (hours)', current: thresholds.reviewWaitHours, apply: value => { thresholds.reviewWaitHours = Number(value) || 24; } },
    8: { question: 'Stale issue threshold (days)', current: thresholds.staleIssueDays, apply: value => { thresholds.staleIssueDays = Number(value) || 14; } },
    9: { question: 'Recent CI failure count', current: thresholds.workflowFailureCount, apply: value => { thresholds.workflowFailureCount = Number(value) || 1; } },
    10: { question: 'History retention (days)', current: config.historyRetentionDays, apply: value => { config.historyRetentionDays = Number(value) || 90; } },
    11: {
      question: 'GitHub organizations (comma separated, * disables)',
      current: config.organizations.join(', '),
      apply: value => { config.organizations = value === '*' ? [] : value.split(',').map(item => item.trim()).filter(Boolean); },
    },
    12: { question: 'Commit ledger window (days, 1–30)', current: config.commitLedgerDays, apply: value => { config.commitLedgerDays = Number(value) || 1; } },
  };
  return editors[index];
}
