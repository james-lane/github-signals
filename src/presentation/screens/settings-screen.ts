import type { DashboardState } from '../../application/dashboard-state.js';
import { CACHE_FILE, CONFIG_FILE } from '../../shared/local-file-names.js';
import { tableCell } from '../terminal/format.js';
import { THEME_LABELS } from '../terminal/theme.js';
import type { TerminalCanvas } from '../terminal/canvas.js';

export const SETTINGS_COUNT = 13;

export function renderSettingsScreen(canvas: TerminalCanvas, state: DashboardState): void {
  const { theme } = canvas;
  const thresholds = state.config.thresholds;
  const rows = [
    ['GitHub hostname', theme.accent(state.config.hostname)],
    ['Theme', theme.accent(THEME_LABELS[state.config.theme])],
    ['Activity lookback', `${theme.accent(String(state.config.lookbackDays))} days`],
    ['Contributing repos', state.config.showContributingRepositories ? theme.success('shown') : theme.muted('hidden (owned only)')],
    ['CI visibility', state.config.ciEnabled ? theme.success('enabled') : theme.muted('disabled')],
    ['GitHub status', state.config.githubStatusEnabled ? theme.success('enabled') : theme.muted('disabled')],
    ['Stale pull request', `${theme.accent(String(thresholds.stalePrDays))} days without an update`],
    ['Review wait', `${theme.accent(String(thresholds.reviewWaitHours))} hours`],
    ['Stale issue', `${theme.accent(String(thresholds.staleIssueDays))} days without an update`],
    ['Recent CI failures', `last ${theme.accent(String(thresholds.workflowFailureCount))} failed runs`],
    ['History retention', `${theme.accent(String(state.config.historyRetentionDays))} days`],
    ['Commit ledger orgs', state.config.organizations.length ? theme.accent(state.config.organizations.join(', ')) : theme.muted('not configured')],
    ['Commit ledger window', `${theme.accent(String(state.config.commitLedgerDays))} day${state.config.commitLedgerDays === 1 ? '' : 's'}`],
  ] as const;
  canvas.line(theme.bold('Configuration'));
  rows.forEach(([label, value], index) => {
    const active = state.contentFocused && index === state.settingsSelection;
    const themePreview = active && index === 1 && state.themeEditing ? theme.muted('  ◀ live preview ▶') : '';
    const rendered = `${active ? '› ' : '  '}${tableCell(label, 20)}  ${value}${themePreview}`;
    canvas.line(active ? theme.selectedRow(rendered) : rendered);
  });
  canvas.line();
  canvas.line(theme.muted(`Enter Settings to make adjustments. Data stays local in ${CONFIG_FILE} and ${CACHE_FILE}.`));
  canvas.line(theme.muted('Press y to copy the complete portable setup. Cache and history are excluded.'));
}
