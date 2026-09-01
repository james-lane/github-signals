import { repositoryName } from '../../domain/configuration.js';
import type { DashboardState } from '../../application/dashboard-state.js';
import { sortVisibleRepositories } from '../../domain/dashboard-selectors.js';
import { isRenovateAuthor } from '../../domain/renovate.js';
import { elapsedTime, fitText, formatDuration, stripAnsi, tableCell } from '../terminal/format.js';
import type { TerminalCanvas } from '../terminal/canvas.js';

const REPOSITORY_METRICS = [
  { label: 'Open PRs', width: 8, key: 'openPrs' },
  { label: 'Stale PRs', width: 9, key: 'stalePrs' },
  { label: 'Waiting', width: 7, key: 'waitingReviews' },
  { label: 'Issues', width: 6, key: 'openIssues' },
  { label: 'Stale', width: 5, key: 'staleIssues' },
  { label: 'CI bad', width: 6, key: 'failedRuns' },
] as const;

export function renderRepositoriesScreen(canvas: TerminalCanvas, state: DashboardState): void {
  if (state.prView) {
    renderPullRequestScreen(canvas, state);
    return;
  }

  const { theme } = canvas;
  canvas.line(`${theme.bold('Repository health')}  ${state.showRenovatePullRequests ? theme.muted('Renovate included') : theme.warning('Renovate hidden')}`);
  const metricsWidth = REPOSITORY_METRICS.reduce((sum, metric) => sum + metric.width + 2, 0);
  const repositories = sortVisibleRepositories(state.config);
  const longestName = Math.max(10, ...repositories.map(repository => repositoryName(repository).length + 4));
  const nameWidth = Math.max(18, Math.min(longestName, canvas.width - metricsWidth));
  const headerCells = [
    tableCell('Repository', nameWidth),
    ...REPOSITORY_METRICS.map(metric => tableCell(metric.label, metric.width)),
  ];
  if (state.contentFocused) headerCells[state.repositoryMetric] = theme.bold(theme.accent(headerCells[state.repositoryMetric]));
  canvas.line(theme.muted(headerCells.join('  ')));

  repositories.forEach((repository, index) => {
    const name = repositoryName(repository);
    const selected = state.contentFocused && index === state.selection[2];
    const displayName = `${selected ? '›' : ' '} ${repository.priority === 'owned' ? '★' : '·'} ${name}`;
    const signal = state.data?.repositories.find(item => item.name === name);
    if (signal?.error) {
      canvas.errorLines(tableCell(displayName, nameWidth), signal.error);
      return;
    }
    const values: Record<string, number | string> = {
      openPrs: state.showRenovatePullRequests ? signal?.openPrs ?? '—' : signal?.openPrsWithoutRenovate ?? '—',
      stalePrs: state.showRenovatePullRequests ? signal?.stalePrs ?? '—' : signal?.stalePrsWithoutRenovate ?? '—',
      waitingReviews: state.showRenovatePullRequests ? signal?.waitingReviews ?? '—' : signal?.waitingReviewsWithoutRenovate ?? '—',
      openIssues: signal?.openIssues ?? '—',
      staleIssues: signal?.staleIssues ?? '—',
      failedRuns: signal?.failedRuns ?? '—',
    };
    const cells = [
      tableCell(displayName, nameWidth),
      ...REPOSITORY_METRICS.map(metric => tableCell(values[metric.key], metric.width)),
    ];
    if (!selected) canvas.line(cells.join('  '));
    else canvas.line(cells.map((cell, cellIndex) =>
      cellIndex === state.repositoryMetric ? theme.bold(theme.selectedCell(cell)) : theme.selectedRow(cell))
      .join(theme.selectedRow('  ')));
  });

  if (!state.config.repositories.length) canvas.line(theme.muted('No repositories configured. Press a to add owner/repo.'));
  else if (!repositories.length) canvas.line(theme.muted('No owned repositories. Enable contributing repositories in Settings to show them.'));
  const hiddenCount = state.config.repositories.length - repositories.length;
  if (hiddenCount) canvas.line(theme.muted(`${hiddenCount} contributing repositories hidden · enable them in Settings`));
}

function renderPullRequestScreen(canvas: TerminalCanvas, state: DashboardState): void {
  const pullRequestView = state.prView;
  if (!pullRequestView) return;
  const { repository, totalCount, rateLimit } = pullRequestView;
  const pullRequests = pullRequestView.pullRequests.filter(pullRequest =>
    state.showRenovatePullRequests || !isRenovateAuthor(pullRequest.author?.login));
  const selected = pullRequests[pullRequestView.selection];
  const { theme } = canvas;
  canvas.line(theme.bold(`Open pull requests · ${repository}`));
  if (!selected) {
    canvas.line(theme.success(state.showRenovatePullRequests ? 'No open pull requests.' : 'No non-Renovate pull requests.'));
    return;
  }

  const listWidth = Math.max(28, canvas.width - 4);
  const visibleRows = Math.min(8, Math.max(6, pullRequests.length));
  const listStart = Math.max(0, Math.min(
    pullRequestView.selection - Math.floor(visibleRows / 2),
    pullRequests.length - visibleRows,
  ));
  const visiblePullRequests = pullRequests.slice(listStart, listStart + visibleRows);
  const hiddenRenovate = pullRequestView.pullRequests.length - pullRequests.length;
  const apiRemaining = rateLimit ? ` · API ${rateLimit.remaining} remaining` : '';
  canvas.line(theme.muted(`${totalCount} open · showing ${pullRequests.length}${hiddenRenovate ? ` · ${hiddenRenovate} Renovate hidden` : ''}${totalCount > pullRequestView.pullRequests.length ? ' · most recently updated' : ''}${apiRemaining}`));
  canvas.line();
  renderPullRequestList(canvas, visiblePullRequests, selected, listStart, pullRequests.length, visibleRows, listWidth);
  renderPullRequestDetails(canvas, state, repository, selected);
}

function renderPullRequestList(
  canvas: TerminalCanvas,
  pullRequests: NonNullable<DashboardState['prView']>['pullRequests'],
  selected: NonNullable<DashboardState['prView']>['pullRequests'][number],
  listStart: number,
  totalCount: number,
  visibleRows: number,
  listWidth: number,
): void {
  const { theme } = canvas;
  const range = `${listStart + 1}–${Math.min(listStart + visibleRows, totalCount)} of ${totalCount}`;
  canvas.line(theme.muted(`┌─ Pull requests · ${range} ${'─'.repeat(Math.max(0, listWidth - range.length - 19))}┐`));
  pullRequests.forEach(pullRequest => {
    const active = pullRequest === selected;
    const flags = `${pullRequest.isDraft ? 'draft · ' : ''}${pullRequest.reviewDecision ? pullRequest.reviewDecision.toLowerCase().replaceAll('_', ' ') : 'review pending'}`;
    const prefix = `${active ? '›' : ' '} #${pullRequest.number} `;
    const flagWidth = Math.min(24, flags.length);
    const titleWidth = Math.max(8, listWidth - prefix.length - flagWidth - 2);
    const row = `${prefix}${tableCell(pullRequest.title, titleWidth)}  ${fitText(flags, flagWidth).padEnd(flagWidth)}`;
    const content = active ? theme.selectedRow(tableCell(row, listWidth)) : tableCell(row, listWidth);
    canvas.line(`${theme.muted('│')} ${content} ${theme.muted('│')}`);
  });
  for (let index = pullRequests.length; index < visibleRows; index++) {
    canvas.line(`${theme.muted('│')} ${' '.repeat(listWidth)} ${theme.muted('│')}`);
  }
  canvas.line(theme.muted(`└${'─'.repeat(listWidth + 2)}┘`));
  canvas.line();
}

function renderPullRequestDetails(
  canvas: TerminalCanvas,
  state: DashboardState,
  repository: string,
  pullRequest: NonNullable<DashboardState['prView']>['pullRequests'][number],
): void {
  const { theme } = canvas;
  canvas.line(theme.bold(`#${pullRequest.number} ${pullRequest.title}`));
  canvas.line(`${theme.accent(`@${pullRequest.author?.login ?? 'unknown'}`)} opened ${new Date(pullRequest.createdAt).toLocaleString()} · updated ${new Date(pullRequest.updatedAt).toLocaleString()}`);
  canvas.line(`${pullRequest.isDraft ? theme.warning('Draft') : theme.success('Ready')} · ${pullRequest.mergeable?.toLowerCase() ?? 'merge status unknown'} · ${pullRequest.reviewDecision?.toLowerCase().replaceAll('_', ' ') ?? 'no review decision'}`);
  canvas.line();
  canvas.line(theme.bold('Key metrics'));
  renderPullRequestMetrics(canvas, pullRequest);
  renderPullRequestCi(canvas, state, repository, pullRequest.headRefOid);
  if (pullRequest.labels.length) canvas.line(`Labels: ${pullRequest.labels.map(theme.accent.bind(theme)).join(', ')}`);
  if (pullRequest.assignees.length) canvas.line(`Assignees: ${pullRequest.assignees.map(login => `@${login}`).join(', ')}`);
  if (pullRequest.requestedReviewers.length) canvas.line(`Review requested: ${pullRequest.requestedReviewers.map(login => `@${login}`).join(', ')}`);
  if (pullRequest.reviews.length) canvas.line(`Latest reviews: ${pullRequest.reviews.map(review => `${review.author?.login ? `@${review.author.login}` : 'unknown'} ${review.state.toLowerCase()}`).join(' · ')}`);
  canvas.line();
  canvas.line(theme.bold(`Commits · ${pullRequest.commitCount}`));
  pullRequest.commits.slice(-8).forEach(commit => {
    const authors = [...new Set(commit.authors.nodes
      .map(author => author.user?.login ? `@${author.user.login}` : author.name)
      .filter((author): author is string => Boolean(author)))].join(', ');
    canvas.line(`${theme.muted(commit.oid.slice(0, 7))} ${fitText(commit.messageHeadline, Math.max(20, canvas.width - authors.length - 14))}  ${theme.accent(authors || 'unknown')}`);
  });
  if (pullRequest.commitCount > pullRequest.commits.length) {
    canvas.line(theme.muted(`${pullRequest.commitCount - pullRequest.commits.length} earlier commits not loaded`));
  }
}

function renderPullRequestMetrics(
  canvas: TerminalCanvas,
  pullRequest: NonNullable<DashboardState['prView']>['pullRequests'][number],
): void {
  const metrics = [
    ['Age', elapsedTime(pullRequest.createdAt)],
    ['In review', pullRequest.isDraft ? 'not yet' : elapsedTime(pullRequest.createdAt)],
    ['Commits', pullRequest.commitCount],
    ['Change', `+${pullRequest.additions} / -${pullRequest.deletions}`],
    ['Files', pullRequest.changedFiles],
    ['Reviews', pullRequest.reviews.length],
    ['Comments', pullRequest.commentCount],
  ] as const;
  const metricCells = metrics.map(([label, value]) =>
    `${canvas.theme.muted(label)} ${canvas.theme.accent(String(value))}`);
  let row = '';
  metricCells.forEach(metricCell => {
    const separator = row ? canvas.theme.muted('  │  ') : '';
    if (row && stripAnsi(`${row}${separator}${metricCell}`).length > canvas.width - 2) {
      canvas.line(row);
      row = metricCell;
    } else {
      row += `${separator}${metricCell}`;
    }
  });
  if (row) canvas.line(row);
}

function renderPullRequestCi(canvas: TerminalCanvas, state: DashboardState, repository: string, headSha: string): void {
  if (!state.config.ciEnabled) return;
  const runs = state.ciRuns.filter(run => run.repository === repository && run.headSha === headSha);
  if (!runs.length) {
    canvas.line(canvas.theme.muted('CI: no stored workflow runs matched this PR commit'));
    return;
  }
  const passed = runs.filter(run => run.conclusion === 'success').length;
  const failed = runs.filter(run => ['failure', 'timed_out', 'action_required'].includes(run.conclusion ?? '')).length;
  const running = runs.filter(run => run.status !== 'completed').length;
  const totalDuration = runs.reduce((sum, run) => sum + (run.durationMs ?? 0), 0);
  const { theme } = canvas;
  canvas.line(`CI: ${theme.success(`${passed} passed`)} · ${failed ? theme.error(`${failed} failed`) : theme.muted('0 failed')} · ${running ? theme.warning(`${running} running`) : theme.muted('0 running')} · ${theme.accent(formatDuration(totalDuration))} total`);
}
