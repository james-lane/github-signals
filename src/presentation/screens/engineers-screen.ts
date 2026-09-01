import { engineerId, repositoryName } from '../../domain/configuration.js';
import type { DashboardState } from '../../application/dashboard-state.js';
import type { EngineerConfig, EngineerRepositorySignal } from '../../domain/models.js';
import { focusScore, aggregateEngineerFocus } from '../../domain/focus.js';
import { tableCell } from '../terminal/format.js';
import type { TerminalCanvas } from '../terminal/canvas.js';

export function renderEngineersScreen(canvas: TerminalCanvas, state: DashboardState): void {
  const { theme } = canvas;
  canvas.line(theme.bold(`Engineer activity and system focus · last ${state.config.lookbackDays} days`));
  const labels = state.config.engineers.map(engineerLabel);
  const engineerWidth = Math.max(25, Math.min(
    Math.max(8, ...labels.map(label => label.length + 2)),
    canvas.width - 39,
  ));
  const engineerRows = Math.max(3, Math.min(8, canvas.height - 20, state.config.engineers.length));
  const engineerStart = Math.max(0, Math.min(
    (state.selection[1] ?? 0) - Math.floor(engineerRows / 2),
    state.config.engineers.length - engineerRows,
  ));
  const engineerEnd = Math.min(state.config.engineers.length, engineerStart + engineerRows);
  canvas.line(theme.muted(`${tableCell(`Engineer · ${state.config.engineers.length ? `${engineerStart + 1}–${engineerEnd} of ${state.config.engineers.length}` : '0'}`, engineerWidth)}  ${tableCell('Commits', 8)}  ${tableCell('PRs', 5)}  ${tableCell('Merged', 7)}  Reviews`));

  state.config.engineers.slice(engineerStart, engineerEnd).forEach((engineer, visibleIndex) => {
    const index = engineerStart + visibleIndex;
    const id = engineerId(engineer);
    const selected = state.contentFocused && index === state.selection[1];
    const label = `${selected ? '›' : ' '} ${engineerLabel(engineer)}`;
    const signal = state.data?.engineers.find(item => item.login === id);
    if (signal?.error) {
      canvas.errorLines(tableCell(label, engineerWidth), signal.error);
      return;
    }
    const row = `${tableCell(label, engineerWidth)}  ${tableCell(signal?.commits ?? '—', 8)}  ${tableCell(signal?.pullRequests ?? '—', 5)}  ${tableCell(signal?.merged ?? '—', 7)}  ${signal?.reviews ?? '—'}`;
    canvas.line(selected ? theme.bold(theme.accent(row)) : row);
  });

  if (!state.config.engineers.length) {
    canvas.line(theme.muted('No engineers configured. Press a to add one.'));
    return;
  }
  if (state.contentFocused) {
    const selectedEngineer = state.config.engineers[state.selection[1] ?? 0];
    const selectedSignal = selectedEngineer
      ? state.data?.engineers.find(item => item.login === engineerId(selectedEngineer))
      : undefined;
    if (selectedEngineer && selectedSignal && !selectedSignal.error) {
      renderSystemFocus(canvas, state, selectedEngineer.name || `@${selectedSignal.login}`, selectedSignal.repositories ?? [], engineerRows, [selectedSignal.login]);
    }
    return;
  }
  if (state.data?.engineers) {
    const configuredLogins = new Set(state.config.engineers.map(engineer => engineerId(engineer).toLowerCase()));
    const teamSignals = state.data.engineers.filter(signal => configuredLogins.has(signal.login.toLowerCase()));
    renderSystemFocus(canvas, state, 'All engineers', aggregateEngineerFocus(teamSignals).repositories, engineerRows, [...configuredLogins], true);
  }
}

function renderSystemFocus(
  canvas: TerminalCanvas,
  state: DashboardState,
  label: string,
  repositories: readonly EngineerRepositorySignal[],
  engineerRows: number,
  historyLogins: readonly string[],
  team = false,
): void {
  const { theme } = canvas;
  canvas.line();
  const scored = repositories
    .map(repository => ({ ...repository, score: focusScore(repository) }))
    .filter(repository => repository.score > 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
  canvas.line(theme.bold(`System focus · ${label}`));
  if (!scored.length) {
    canvas.line(theme.muted('No repository-level focus data cached yet. Press r to refresh.'));
    return;
  }

  const totalScore = scored.reduce((sum, repository) => sum + repository.score, 0);
  const priorities = new Map(state.config.repositories.map(repository => [repositoryName(repository), repository.priority]));
  const ownedScore = scored
    .filter(repository => priorities.get(repository.name) === 'owned')
    .reduce((sum, repository) => sum + repository.score, 0);
  const primaryShare = Math.round(scored[0].score / totalScore * 100);
  const ownedShare = Math.round(ownedScore / totalScore * 100);
  const concentration = primaryShare >= 75
    ? 'high focus'
    : primaryShare >= 50
      ? 'moderate focus'
      : scored.length >= 6 && primaryShare < 30
        ? 'broadly distributed'
        : 'shared focus';
  const concentrationTrend = calculateConcentrationTrend(state, historyLogins);
  const trend = concentrationTrend.length
    ? ` · ${canvas.sparkline(concentrationTrend)} ${theme.muted('primary share')}`
    : '';
  canvas.line(`${theme.accent(String(scored.length))} active systems · ${theme.accent(`${ownedShare}%`)} owned · primary ${theme.accent(`${primaryShare}%`)} · ${theme.warning(concentration)}${trend}`);

  const daysWidth = team ? 8 : 5;
  const nameWidth = Math.max(20, canvas.width - 53 - daysWidth);
  canvas.line(theme.muted(`${tableCell('Repository', nameWidth)} ${tableCell('Focus', 19)} ${tableCell(team ? 'Eng days' : 'Days', daysWidth)} ${tableCell('Commits', 7)} ${tableCell('PRs', 4)} ${tableCell('Merged', 7)} Reviews`));
  const repositoryRows = Math.max(2, Math.min(6, canvas.height - engineerRows - 17));
  scored.slice(0, repositoryRows).forEach(repository => {
    const share = Math.round(repository.score / totalScore * 100);
    const filledBars = Math.round(share / 10);
    const focusBar = `${'█'.repeat(filledBars)}${'░'.repeat(10 - filledBars)}`;
    const shortName = repository.name.split('/').pop() ?? repository.name;
    canvas.line(`${tableCell(shortName, nameWidth)} ${tableCell(`${focusBar} ${share}%`, 19)} ${tableCell(repository.activeDays || '—', daysWidth)} ${tableCell(repository.commits, 7)} ${tableCell(repository.pullRequests, 4)} ${tableCell(repository.merged, 7)} ${repository.reviews}`);
  });
  if (scored.length > repositoryRows) canvas.line(theme.muted(`${scored.length - repositoryRows} more systems not shown`));
  canvas.line(theme.muted('Focus weights: commit 1 · PR 3 · merge 2 · review 2. This represents work distribution, not hours.'));
}

function calculateConcentrationTrend(state: DashboardState, historyLogins: readonly string[]): number[] {
  const scoresBySnapshot = new Map<string, Map<string, number>>();
  const includedLogins = new Set(historyLogins.map(login => login.toLowerCase()));
  state.focusHistory.filter(row => includedLogins.has(row.login.toLowerCase())).forEach(row => {
    const repositories = scoresBySnapshot.get(row.captured_at) ?? new Map<string, number>();
    repositories.set(row.repository, (repositories.get(row.repository) ?? 0) + focusScore({
      commits: row.commits,
      pullRequests: row.pull_requests,
      merged: row.merged,
      reviews: row.reviews,
    }));
    scoresBySnapshot.set(row.captured_at, repositories);
  });
  return [...scoresBySnapshot.values()].map(repositories => {
    const scores = [...repositories.values()];
    return scores.length
      ? Math.round(Math.max(...scores) / scores.reduce((sum, score) => sum + score, 0) * 100)
      : 0;
  });
}

function engineerLabel(engineer: EngineerConfig): string {
  return engineer.name && engineer.name !== engineerId(engineer)
    ? `${engineer.name} (@${engineerId(engineer)})`
    : `@${engineerId(engineer)}`;
}
