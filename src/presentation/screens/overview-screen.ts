import { engineerId, repositoryName, visibleRepositories } from '../../domain/configuration.js';
import { calculateCiMetrics } from '../../domain/dashboard-selectors.js';
import type { DashboardState } from '../../application/dashboard-state.js';
import type { EngineerSignal, RepositorySignal } from '../../domain/models.js';
import { CONFIG_FILE } from '../../shared/local-file-names.js';
import { formatDuration } from '../terminal/format.js';
import type { TerminalCanvas } from '../terminal/canvas.js';

export function renderOverviewScreen(canvas: TerminalCanvas, state: DashboardState): void {
  const { theme } = canvas;
  canvas.line(theme.bold('Dashboard'));
  if (!state.config.engineers.length && !state.config.repositories.length) {
    canvas.line(theme.warning('No signals configured yet. Press a to add an engineer or repository.'));
    canvas.line(theme.muted(`Configuration is saved in ${CONFIG_FILE}.`));
    return;
  }
  if (!state.data) {
    canvas.line(theme.muted('Press r to fetch GitHub data.'));
    return;
  }

  const engineers = state.data.engineers;
  const visibleNames = new Set(visibleRepositories(state.config).map(repositoryName));
  const repositories = state.data.repositories.filter(repository => visibleNames.has(repository.name));
  const activity = engineers.reduce((total, engineer) => ({
    commits: total.commits + engineer.commits,
    pullRequests: total.pullRequests + engineer.pullRequests,
    merged: total.merged + engineer.merged,
    reviews: total.reviews + engineer.reviews,
  }), { commits: 0, pullRequests: 0, merged: 0, reviews: 0 });
  const health = repositories.reduce((total, repository) => ({
    stalePullRequests: total.stalePullRequests + (repository.stalePrs ?? 0),
    waitingReviews: total.waitingReviews + (repository.waitingReviews ?? 0),
    staleIssues: total.staleIssues + (repository.staleIssues ?? 0),
    ciFailures: total.ciFailures + (repository.failedRuns ?? 0),
  }), { stalePullRequests: 0, waitingReviews: 0, staleIssues: 0, ciFailures: 0 });
  const ci = calculateCiMetrics(state.ciRuns, state.config.lookbackDays, state.data.fetchedAt);
  const panelWidth = canvas.width >= 96 ? Math.floor((canvas.width - 2) / 2) : canvas.width;
  const previousSnapshot = state.history.at(-2);

  const activityPanel = canvas.panel(`Team activity · ${state.config.lookbackDays} days`, [
    `${theme.accent(String(activity.commits).padStart(3))} commits ${canvas.trend(activity.commits, previousSnapshot?.commits)}   ${theme.accent(String(activity.pullRequests).padStart(3))} pull requests ${canvas.trend(activity.pullRequests, previousSnapshot?.pull_requests)}`,
    `${theme.success(String(activity.merged).padStart(3))} merged     ${theme.accent(String(activity.reviews).padStart(3))} reviews`,
    `${canvas.sparkline(state.history.map(item => item.commits))} ${theme.muted(`commits · ${state.history.length} snapshots`)}`,
  ], panelWidth);
  const healthPanel = canvas.panel(`Repository health · ${repositories.length} in scope`, [
    `${health.stalePullRequests ? theme.error(String(health.stalePullRequests).padStart(3)) : theme.success('  0')} stale PRs   ${health.waitingReviews ? theme.warning(String(health.waitingReviews).padStart(3)) : theme.success('  0')} waiting`,
    `${health.staleIssues ? theme.error(String(health.staleIssues).padStart(3)) : theme.success('  0')} stale issues ${health.ciFailures ? theme.error(String(health.ciFailures).padStart(3)) : theme.success('  0')} CI failures`,
    `${canvas.sparkline(state.history.map(item => item.stale_prs + item.waiting_reviews + item.stale_issues + item.ci_failures), theme.error.bind(theme))} ${theme.muted(`attention · ${state.history.length} snapshots`)}`,
  ], panelWidth);
  canvas.drawPanels(activityPanel, healthPanel);
  canvas.line();

  if (state.config.ciEnabled) {
    const ciHistory = state.history.map(snapshot => calculateCiMetrics(state.ciRuns, state.config.lookbackDays, snapshot.captured_at));
    const performancePanel = canvas.panel(`CI performance · ${state.config.lookbackDays} days`, [
      `${ci.successRate == null ? theme.muted('  —') : ci.successRate >= 90 ? theme.success(`${String(ci.successRate).padStart(3)}%`) : theme.error(`${String(ci.successRate).padStart(3)}%`)} success   ${theme.accent(String(ci.runs).padStart(3))} runs across ${theme.accent(String(ci.workflows))} workflows`,
      `p50 ${theme.accent(formatDuration(ci.p50))}   p95 ${theme.accent(formatDuration(ci.p95))}   queue ${theme.accent(formatDuration(ci.queue))}`,
      `${canvas.sparkline(ciHistory.map(item => item.successRate ?? 0))} ${theme.muted(`success rate · ${state.history.length} snapshots`)}`,
    ], panelWidth);
    const attentionPanel = canvas.panel('CI attention', [
      `${ci.failed ? theme.error(String(ci.failed).padStart(3)) : theme.success('  0')} failed runs   ${ci.running ? theme.warning(String(ci.running).padStart(3)) : theme.success('  0')} running`,
      `${ci.failingWorkflows ? theme.error(String(ci.failingWorkflows).padStart(3)) : theme.success('  0')} workflows with failures`,
      ci.runs ? theme.muted('Enter the CI view for workflow, run, job and step detail') : theme.muted('No stored Actions runs yet · press r to refresh'),
    ], panelWidth);
    canvas.drawPanels(performancePanel, attentionPanel);
    canvas.line();
  }

  renderRankedPanels(canvas, state, engineers, repositories, panelWidth);
  canvas.line();
  const isCurrent = Date.now() - new Date(state.data.fetchedAt).getTime() < 3_600_000;
  const freshness = isCurrent ? theme.success('● current') : theme.warning('● cached');
  const rateLimit = state.data.rateLimit ? ` · API ${state.data.rateLimit.remaining} remaining` : '';
  canvas.line(`${freshness}  ${theme.muted(`Refreshed ${new Date(state.data.fetchedAt).toLocaleString()} · ${state.config.showContributingRepositories ? 'owned + contributing' : 'owned only'}${rateLimit}`)}`);
}

function renderRankedPanels(
  canvas: TerminalCanvas,
  state: DashboardState,
  engineers: readonly EngineerSignal[],
  repositories: readonly RepositorySignal[],
  panelWidth: number,
): void {
  const { theme } = canvas;
  const engineerById = new Map(state.config.engineers.map(engineer => [engineerId(engineer), engineer]));
  const mostActive = [...engineers]
    .filter(engineer => !engineer.error)
    .sort((left, right) =>
      right.commits + right.pullRequests + right.reviews - left.commits - left.pullRequests - left.reviews)
    .slice(0, 4);
  const hotspots = [...repositories]
    .filter(repository => !repository.error)
    .map(repository => ({
      ...repository,
      attention: (repository.stalePrs ?? 0) + (repository.waitingReviews ?? 0)
        + (repository.staleIssues ?? 0) + (repository.failedRuns ?? 0),
    }))
    .sort((left, right) => right.attention - left.attention)
    .slice(0, 4);

  const peoplePanel = canvas.panel('Most active', mostActive.length
    ? mostActive.map((person, index) => {
      const engineer = engineerById.get(person.login);
      return `${index + 1}. ${engineer?.name ?? `@${person.login}`}  ${theme.muted(`${person.commits} commits · ${person.pullRequests} PRs · ${person.reviews} reviews`)}`;
    })
    : [theme.muted('No activity in this period')], panelWidth);
  const hotspotPanel = canvas.panel('Needs attention', hotspots.length
    ? hotspots.map((repository, index) => {
      const shortName = repository.name.split('/').pop() ?? repository.name;
      return `${index + 1}. ${shortName}  ${repository.attention ? theme.error(`${repository.attention} signals`) : theme.success('healthy')}`;
    })
    : [theme.success('No repository attention signals')], panelWidth);
  canvas.drawPanels(peoplePanel, hotspotPanel);
}
