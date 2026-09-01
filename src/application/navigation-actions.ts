import { engineerId, repositoryName } from '../domain/configuration.js';
import {
  filterVisiblePullRequests,
  groupCiWorkflows,
  sortVisibleRepositories,
} from '../domain/dashboard-selectors.js';
import { fetchWorkflowPath, fetchWorkflowRunJobs } from '../infrastructure/github/actions.js';
import {
  openEngineerProfile as openEngineer,
  openRepositoryMetric,
  openWebUrl as openGitHubUrl,
  openWebUrl as openPullRequest,
} from '../infrastructure/github/browser.js';
import { fetchRepositoryCommits } from '../infrastructure/github/commits.js';
import { fetchOpenPullRequests } from '../infrastructure/github/pull-requests.js';
import { GITHUB_STATUS_PAGE_URL } from '../infrastructure/github/status.js';
import { ciContextWebUrl } from '../infrastructure/github/web-urls.js';
import { currentCommitPage } from '../presentation/screens/commits-screen.js';
import type { DashboardState } from './dashboard-state.js';

export interface NavigationTarget extends DashboardState {
  render(): void;
  accent(message: string): string;
  success(message: string): string;
}

export class NavigationActions {
  public constructor(private readonly target: NavigationTarget) {}

  public async openCiSelected(): Promise<void> {
    const target = this.target;
    if (!target.ciView) {
      const group = groupCiWorkflows(target.ciRuns)[target.ciSelection];
      if (group) target.ciView = { type: 'workflow', group, selection: 0 };
      target.render();
      return;
    }
    if (target.ciView.type === 'workflow') {
      const { group } = target.ciView;
      const run = group.runs[target.ciView.selection];
      if (!run?.id) return;
      target.message = target.accent(`Loading jobs for ${run.workflow ?? 'workflow'}…`);
      target.render();
      const jobs = await fetchWorkflowRunJobs(run.repository, run.id, target.config.hostname);
      target.ciView = { type: 'run', group, run, jobs, selection: 0 };
      target.message = '';
      target.render();
      return;
    }
    const job = target.ciView.jobs[target.ciView.selection];
    const url = job?.url ?? target.ciView.run.url;
    if (url) await openGitHubUrl(url);
    target.message = target.success(`Opened ${job?.name ?? target.ciView.run.workflow ?? 'workflow'}.`);
    target.render();
  }

  public async openCurrentOnWeb(): Promise<void> {
    const target = this.target;
    if (target.prView) {
      const pullRequests = filterVisiblePullRequests(target.prView.pullRequests, target.showRenovatePullRequests);
      const selected = pullRequests[target.prView.selection];
      if (!selected) return;
      await openGitHubUrl(selected.url);
      target.message = target.success(`Opened ${target.prView.repository}#${selected.number}.`);
      target.render();
      return;
    }
    if (target.currentView() !== 'CI') return;
    const group = target.ciView?.group ?? groupCiWorkflows(target.ciRuns)[target.ciSelection];
    if (!group) return;
    if (!target.ciView && !group.latest?.workflowPath && group.latest?.workflowId) {
      target.message = target.accent(`Resolving ${group.workflow} workflow file…`);
      target.render();
      const workflowPath = await fetchWorkflowPath(group.repository, group.latest.workflowId, target.config.hostname);
      if (workflowPath) {
        group.runs
          .filter(run => run.workflowId === group.latest?.workflowId)
          .forEach(run => { run.workflowPath = workflowPath; });
      }
    }
    const run = target.ciView?.type === 'workflow'
      ? group.runs[target.ciView.selection]
      : target.ciView?.type === 'run'
        ? target.ciView.run
        : undefined;
    const job = target.ciView?.type === 'run' ? target.ciView.jobs[target.ciView.selection] : undefined;
    await openGitHubUrl(ciContextWebUrl(target.config.hostname, group, run, job));
    target.message = target.success(`Opened ${job?.name ?? run?.title ?? group.workflow}.`);
    target.render();
  }

  public async openSelected(): Promise<void> {
    const target = this.target;
    const selectedIndex = target.selection[target.tab] ?? 0;
    if (target.currentView() === 'Engineers') {
      const engineer = target.config.engineers[selectedIndex];
      if (!engineer) return;
      await openEngineer(engineerId(engineer), target.config.hostname);
      target.message = target.success(`Opened @${engineerId(engineer)}.`);
      target.render();
      return;
    }
    if (target.currentView() !== 'Repositories') return;
    const repository = sortVisibleRepositories(target.config)[selectedIndex];
    if (!repository) return;
    const metrics = ['repository', 'openPrs', 'stalePrs', 'waitingReviews', 'openIssues', 'staleIssues', 'failedRuns'];
    const metric = metrics[target.repositoryMetric] ?? 'repository';
    const name = repositoryName(repository);
    if (metric === 'openPrs') {
      target.message = target.accent(`Loading open pull requests for ${name}…`);
      target.render();
      const result = await fetchOpenPullRequests(name, target.config.hostname);
      target.prView = { repository: name, ...result, selection: 0 };
      target.message = '';
      target.render();
      return;
    }
    await openRepositoryMetric(name, target.config.hostname, metric, target.config.thresholds);
    target.message = target.success(`Opened ${name} · ${metric}.`);
    target.render();
  }

  public async filterCommitLedger(): Promise<void> {
    const target = this.target;
    if (target.commitLedger.repositoryFilter) {
      target.commitLedger.repositoryFilter = '';
      target.commitLedger.focusedCommits = null;
      target.commitLedger.page = 0;
      target.commitLedger.selection = 0;
      target.message = target.success('Returned to the organization ledger.');
      target.render();
      return;
    }
    const selected = currentCommitPage(target).rows[target.commitLedger.selection];
    if (!selected) return;
    target.message = target.accent(`Loading the latest 20 commits for ${selected.repository}…`);
    target.render();
    target.commitLedger.focusedCommits = await fetchRepositoryCommits(
      selected.repository,
      selected.branch,
      target.config.hostname,
    );
    target.commitLedger.repositoryFilter = selected.repository;
    target.commitLedger.page = 0;
    target.commitLedger.selection = 0;
    target.message = target.success(`Showing the latest ${target.commitLedger.focusedCommits.length} commits for ${selected.repository}.`);
    target.render();
  }

  public async openCommitOnWeb(): Promise<void> {
    const target = this.target;
    const commit = currentCommitPage(target).rows[target.commitLedger.selection];
    if (!commit) return;
    await openGitHubUrl(commit.url);
    target.message = target.success(`Opened ${commit.repository}@${commit.sha.slice(0, 7)}.`);
    target.render();
  }

  public async openSelectedPullRequest(): Promise<void> {
    const target = this.target;
    const pullRequestView = target.prView;
    if (!pullRequestView) return;
    const pullRequests = filterVisiblePullRequests(pullRequestView.pullRequests, target.showRenovatePullRequests);
    const pullRequest = pullRequests[pullRequestView.selection];
    if (!pullRequest) return;
    await openPullRequest(pullRequest.url);
    target.message = target.success(`Opened ${pullRequestView.repository}#${pullRequest.number}.`);
    target.render();
  }

  public async openGitHubStatus(): Promise<void> {
    await openGitHubUrl(GITHUB_STATUS_PAGE_URL);
    this.target.message = this.target.success('Opened GitHub Status.');
    this.target.render();
  }
}
