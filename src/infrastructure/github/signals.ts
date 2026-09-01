import { engineerId, repositoryName, visibleRepositories } from '../../domain/configuration.js';
import type {
  AppConfig,
  EngineerConfig,
  EngineerRepositorySignal,
  EngineerSignal,
  ProgressReporter,
  RateLimit,
  RepositorySignal,
  SignalSnapshot,
} from '../../domain/models.js';
import { errorMessage } from '../../shared/errors.js';
import { isRenovateAuthor } from '../../domain/renovate.js';
import { fetchActionsSignals } from './actions.js';
import { githubGraphql, waitForPacing } from './gh-client.js';

interface RepositoryActivity {
  name: string;
  commits: CommitActivity[];
  pullRequests: PullRequestActivity[];
}

interface CommitActivity {
  oid: string;
  committedDate: string;
  authors: { nodes: Array<{ user?: { login?: string | null } | null }> };
}

interface PullRequestActivity {
  id: string;
  createdAt: string;
  mergedAt?: string | null;
  author?: { login?: string | null } | null;
  reviews: { nodes: ReviewActivity[] };
}

interface ReviewActivity {
  submittedAt: string;
  author?: { login?: string | null } | null;
}

interface RepositoryNode {
  visibility: string;
  isArchived: boolean;
  defaultBranchRef?: {
    name: string;
    target?: {
      statusCheckRollup?: { state?: string } | null;
      history?: { nodes: CommitActivity[] };
    } | null;
  } | null;
  pullRequests: {
    totalCount: number;
    nodes: Array<{ createdAt: string; updatedAt: string; reviewDecision?: string | null; author?: { login?: string | null } | null }>;
  };
  activityPullRequests: {
    nodes: Array<Omit<PullRequestActivity, 'reviews'> & { latestReviews: { nodes: ReviewActivity[] } }>;
  };
  issues: { totalCount: number; nodes: Array<{ updatedAt: string }> };
}

interface ContributionGroup {
  repository: { nameWithOwner: string };
  contributions: { totalCount: number };
}

interface EngineerNode {
  contributionsCollection: {
    commitContributionsByRepository: ContributionGroup[];
    pullRequestContributionsByRepository: ContributionGroup[];
    pullRequestReviewContributionsByRepository: ContributionGroup[];
  };
  pullRequests: {
    nodes: Array<{
      createdAt: string;
      mergedAt?: string | null;
      repository: { nameWithOwner: string };
    }>;
  };
}

interface GraphqlData {
  rateLimit?: RateLimit;
  [alias: string]: unknown;
}

interface GraphqlResponse {
  data?: GraphqlData;
}

interface SignalCollectionOptions {
  signal?: AbortSignal;
}

export async function fetchSignals(
  config: AppConfig,
  reportProgress: ProgressReporter = () => undefined,
  options: SignalCollectionOptions = {},
): Promise<SignalSnapshot> {
  const { signal } = options;
  const since = new Date(Date.now() - config.lookbackDays * 86_400_000).toISOString().slice(0, 10);
  const repositoriesInScope = visibleRepositories(config);
  const progress = createProgressPlan(config, repositoriesInScope.length);
  let engineers: EngineerSignal[] = [];
  let rateLimit: RateLimit | null = null;
  let repositories: RepositorySignal[] = [];
  let activity: RepositoryActivity[] = [];
  let completedProgress = 0;

  reportProgress('Starting refresh…', { current: 0, total: progress.total });

  if (repositoriesInScope.length) {
    reportProgress(`Checking health and activity across ${repositoriesInScope.length} repositories…`, {
      current: completedProgress,
      total: progress.total,
    });
    const result = await collectRepositorySignals(
      config,
      repositoriesInScope.map(repositoryName),
      since,
      signal,
      processed => {
        completedProgress = Math.ceil(processed / 2);
        reportProgress(`Repository health and activity (${processed}/${repositoriesInScope.length})`, {
          current: completedProgress,
          total: progress.total,
        });
      },
    );
    repositories = result.repositories;
    activity = result.activity;
    rateLimit = result.rateLimit;
  }

  if (config.engineers.length) {
    if (repositoriesInScope.length) {
      reportProgress('Calculating engineer system focus…', { current: completedProgress, total: progress.total });
      engineers = engineerSignalsFromRepositories(config.engineers, activity, since);
      completedProgress += 1;
      reportProgress('Engineer system focus calculated', { current: completedProgress, total: progress.total });
    } else if (config.repositories.length) {
      engineers = config.engineers.map(engineer => emptyEngineerSignal(engineerId(engineer)));
    } else {
      reportProgress(`Fetching activity for ${config.engineers.length} engineers…`, {
        current: completedProgress,
        total: progress.total,
      });
      const result = await collectEngineerSignals(config, since, signal, processed => {
        completedProgress = Math.ceil(processed / 20);
        reportProgress(`Engineer activity (${processed}/${config.engineers.length})`, {
          current: completedProgress,
          total: progress.total,
        });
      });
      engineers = result.engineers;
      rateLimit = result.rateLimit;
    }
  }

  const ciRuns = config.ciEnabled && repositoriesInScope.length
    ? await fetchActionsSignals(config, reportProgress, {
      signal,
      progressOffset: completedProgress,
      progressTotal: progress.total,
    })
    : [];

  reportProgress('Refresh data collected', { current: progress.total, total: progress.total });
  return { fetchedAt: new Date().toISOString(), since, engineers, repositories, ciRuns, rateLimit };
}

export function engineerSignalsFromRepositories(
  engineers: readonly EngineerConfig[],
  activity: readonly RepositoryActivity[],
  since: string,
): EngineerSignal[] {
  const from = `${since}T00:00:00Z`;
  const signalsByLogin = new Map(engineers.map(engineer => {
    const login = engineerId(engineer);
    return [login.toLowerCase(), createMutableEngineerSignal(login)] as const;
  }));

  for (const repository of activity) {
    collectCommitActivity(repository, signalsByLogin);
    collectPullRequestActivity(repository, signalsByLogin, from);
  }

  return [...signalsByLogin.values()].map(signal => ({
    login: signal.login,
    commits: signal.commits,
    pullRequests: signal.pullRequests,
    reviews: signal.reviews,
    merged: signal.merged,
    repositories: [...signal.repositoryActivity.values()].map(({ activeDates, ...repository }) => ({
      ...repository,
      activeDays: activeDates.size,
    })),
  }));
}

async function collectRepositorySignals(
  config: AppConfig,
  names: readonly string[],
  since: string,
  signal: AbortSignal | undefined,
  onChunk: (processed: number) => void,
): Promise<{ repositories: RepositorySignal[]; activity: RepositoryActivity[]; rateLimit: RateLimit | null }> {
  const repositories: RepositorySignal[] = [];
  const activity: RepositoryActivity[] = [];
  let rateLimit: RateLimit | null = null;
  const from = `${since}T00:00:00Z`;

  for (let offset = 0; offset < names.length; offset += 2) {
    if (offset) await waitForPacing(250, signal);
    const chunk = names.slice(offset, offset + 2);
    try {
      const result = await githubGraphql<GraphqlResponse>(
        config.hostname,
        repositoryQuery(chunk, from),
        signal,
      );
      rateLimit = result.data?.rateLimit ?? rateLimit;
      chunk.forEach((fullName, index) => {
        const repository = result.data?.[`r${index}`] as RepositoryNode | null | undefined;
        repositories.push(toRepositorySignal(config, fullName, repository));
        if (repository) activity.push(toRepositoryActivity(fullName, repository));
      });
    } catch (error: unknown) {
      if (signal?.aborted) throw error;
      chunk.forEach(name => repositories.push({ name, error: errorMessage(error) }));
    }
    onChunk(Math.min(names.length, offset + chunk.length));
  }

  return { repositories, activity, rateLimit };
}

async function collectEngineerSignals(
  config: AppConfig,
  since: string,
  signal: AbortSignal | undefined,
  onChunk: (processed: number) => void,
): Promise<{ engineers: EngineerSignal[]; rateLimit: RateLimit | null }> {
  const engineers: EngineerSignal[] = [];
  let rateLimit: RateLimit | null = null;
  const names = config.engineers.map(engineerId);
  const from = `${since}T00:00:00Z`;
  const to = new Date().toISOString();

  for (let offset = 0; offset < names.length; offset += 20) {
    const chunk = names.slice(offset, offset + 20);
    try {
      const result = await githubGraphql<GraphqlResponse>(
        config.hostname,
        engineerQuery(chunk, from, to),
        signal,
      );
      rateLimit = result.data?.rateLimit ?? rateLimit;
      chunk.forEach((login, index) => {
        const user = result.data?.[`u${index}`] as EngineerNode | null | undefined;
        engineers.push(user
          ? toEngineerSignal(login, user, config.repositories.map(repositoryName), from)
          : { ...emptyEngineerSignal(login), error: 'GitHub user not found or not accessible.' });
      });
    } catch (error: unknown) {
      if (signal?.aborted) throw error;
      chunk.forEach(login => engineers.push({ ...emptyEngineerSignal(login), error: errorMessage(error) }));
    }
    onChunk(Math.min(names.length, offset + chunk.length));
  }

  return { engineers, rateLimit };
}

function toRepositorySignal(config: AppConfig, name: string, repository?: RepositoryNode | null): RepositorySignal {
  if (!repository) return { name, error: 'Repository not found or not accessible.' };
  const pullRequests = repository.pullRequests.nodes;
  const issues = repository.issues.nodes;
  const nonRenovatePullRequests = pullRequests.filter(pullRequest => !isRenovateAuthor(pullRequest.author?.login));
  const isStalePullRequest = (pullRequest: { updatedAt: string }): boolean => ageInDays(pullRequest.updatedAt) >= config.thresholds.stalePrDays;
  const isWaitingForReview = (pullRequest: { createdAt: string; reviewDecision?: string | null }): boolean =>
    ageInDays(pullRequest.createdAt) * 24 >= config.thresholds.reviewWaitHours
    && pullRequest.reviewDecision === 'REVIEW_REQUIRED';
  const ciState = repository.defaultBranchRef?.target?.statusCheckRollup?.state ?? 'UNKNOWN';

  return {
    name,
    visibility: repository.visibility.toLowerCase(),
    defaultBranch: repository.defaultBranchRef?.name ?? '—',
    openPrs: repository.pullRequests.totalCount,
    stalePrs: pullRequests.filter(isStalePullRequest).length,
    waitingReviews: pullRequests.filter(isWaitingForReview).length,
    openPrsWithoutRenovate: nonRenovatePullRequests.length,
    stalePrsWithoutRenovate: nonRenovatePullRequests.filter(isStalePullRequest).length,
    waitingReviewsWithoutRenovate: nonRenovatePullRequests.filter(isWaitingForReview).length,
    openIssues: repository.issues.totalCount,
    staleIssues: issues.filter(issue => ageInDays(issue.updatedAt) >= config.thresholds.staleIssueDays).length,
    failedRuns: ['FAILURE', 'ERROR'].includes(ciState) ? 1 : 0,
    archived: repository.isArchived,
  };
}

function toRepositoryActivity(name: string, repository: RepositoryNode): RepositoryActivity {
  return {
    name,
    commits: repository.defaultBranchRef?.target?.history?.nodes ?? [],
    pullRequests: repository.activityPullRequests.nodes.map(pullRequest => ({
      ...pullRequest,
      reviews: pullRequest.latestReviews,
    })),
  };
}

function toEngineerSignal(login: string, user: EngineerNode, repositories: readonly string[], from: string): EngineerSignal {
  const contributions = user.contributionsCollection;
  const allowedRepositories = new Set(repositories.map(name => name.toLowerCase()));
  const recentPullRequests = user.pullRequests.nodes.filter(pullRequest =>
    pullRequest.createdAt >= from
    && (!allowedRepositories.size || allowedRepositories.has(pullRequest.repository.nameWithOwner.toLowerCase())));
  const repositoryActivity = new Map<string, EngineerRepositorySignal>();

  addContributionGroups(repositoryActivity, contributions.commitContributionsByRepository, 'commits', allowedRepositories);
  addContributionGroups(repositoryActivity, contributions.pullRequestContributionsByRepository, 'pullRequests', allowedRepositories);
  addContributionGroups(repositoryActivity, contributions.pullRequestReviewContributionsByRepository, 'reviews', allowedRepositories);
  for (const pullRequest of recentPullRequests.filter(item => item.mergedAt)) {
    const name = pullRequest.repository.nameWithOwner;
    const repository = repositoryActivity.get(name) ?? emptyRepositoryActivity(name);
    repository.merged += 1;
    repositoryActivity.set(name, repository);
  }

  return {
    login,
    commits: contributionCount(contributions.commitContributionsByRepository, repositories),
    pullRequests: contributionCount(contributions.pullRequestContributionsByRepository, repositories),
    reviews: contributionCount(contributions.pullRequestReviewContributionsByRepository, repositories),
    merged: recentPullRequests.filter(pullRequest => pullRequest.mergedAt).length,
    repositories: [...repositoryActivity.values()],
  };
}

function addContributionGroups(
  repositoryActivity: Map<string, EngineerRepositorySignal>,
  groups: readonly ContributionGroup[],
  key: 'commits' | 'pullRequests' | 'reviews',
  allowedRepositories: ReadonlySet<string>,
): void {
  for (const group of groups) {
    const name = group.repository.nameWithOwner;
    if (allowedRepositories.size && !allowedRepositories.has(name.toLowerCase())) continue;
    const repository = repositoryActivity.get(name) ?? emptyRepositoryActivity(name);
    repository[key] += group.contributions.totalCount;
    repositoryActivity.set(name, repository);
  }
}

function contributionCount(groups: readonly ContributionGroup[], repositories: readonly string[]): number {
  if (!repositories.length) return groups.reduce((sum, group) => sum + group.contributions.totalCount, 0);
  const allowedRepositories = new Set(repositories.map(name => name.toLowerCase()));
  return groups.reduce((sum, group) =>
    allowedRepositories.has(group.repository.nameWithOwner.toLowerCase())
      ? sum + group.contributions.totalCount
      : sum, 0);
}

interface MutableRepositoryActivity extends Omit<EngineerRepositorySignal, 'activeDays'> {
  activeDates: Set<string>;
}

interface MutableEngineerSignal {
  login: string;
  commits: number;
  pullRequests: number;
  reviews: number;
  merged: number;
  reviewedPullRequests: Set<string>;
  repositoryActivity: Map<string, MutableRepositoryActivity>;
}

function createMutableEngineerSignal(login: string): MutableEngineerSignal {
  return {
    login,
    commits: 0,
    pullRequests: 0,
    reviews: 0,
    merged: 0,
    reviewedPullRequests: new Set(),
    repositoryActivity: new Map(),
  };
}

function repositoryActivityFor(signal: MutableEngineerSignal, repository: string): MutableRepositoryActivity {
  const activity = signal.repositoryActivity.get(repository) ?? {
    name: repository,
    commits: 0,
    pullRequests: 0,
    merged: 0,
    reviews: 0,
    activeDates: new Set<string>(),
  };
  signal.repositoryActivity.set(repository, activity);
  return activity;
}

function collectCommitActivity(repository: RepositoryActivity, signalsByLogin: Map<string, MutableEngineerSignal>): void {
  for (const commit of repository.commits) {
    const creditedLogins = new Set<string>();
    for (const author of commit.authors.nodes) {
      const signal = signalsByLogin.get(author.user?.login?.toLowerCase() ?? '');
      if (!signal || creditedLogins.has(signal.login)) continue;
      signal.commits += 1;
      const focus = repositoryActivityFor(signal, repository.name);
      focus.commits += 1;
      markActive(focus, commit.committedDate);
      creditedLogins.add(signal.login);
    }
  }
}

function collectPullRequestActivity(
  repository: RepositoryActivity,
  signalsByLogin: Map<string, MutableEngineerSignal>,
  from: string,
): void {
  for (const pullRequest of repository.pullRequests) {
    const author = signalsByLogin.get(pullRequest.author?.login?.toLowerCase() ?? '');
    if (author && pullRequest.createdAt >= from) {
      author.pullRequests += 1;
      const focus = repositoryActivityFor(author, repository.name);
      focus.pullRequests += 1;
      markActive(focus, pullRequest.createdAt);
    }
    if (author && pullRequest.mergedAt && pullRequest.mergedAt >= from) {
      author.merged += 1;
      const focus = repositoryActivityFor(author, repository.name);
      focus.merged += 1;
      markActive(focus, pullRequest.mergedAt);
    }
    collectReviewActivity(repository.name, pullRequest, signalsByLogin, from);
  }
}

function collectReviewActivity(
  repository: string,
  pullRequest: PullRequestActivity,
  signalsByLogin: Map<string, MutableEngineerSignal>,
  from: string,
): void {
  for (const review of pullRequest.reviews.nodes) {
    const reviewer = signalsByLogin.get(review.author?.login?.toLowerCase() ?? '');
    const reviewKey = `${repository}:${pullRequest.id}`;
    if (!reviewer || review.submittedAt < from || reviewer.reviewedPullRequests.has(reviewKey)) continue;
    reviewer.reviews += 1;
    reviewer.reviewedPullRequests.add(reviewKey);
    const focus = repositoryActivityFor(reviewer, repository);
    focus.reviews += 1;
    markActive(focus, review.submittedAt);
  }
}

function markActive(activity: MutableRepositoryActivity, date?: string): void {
  if (date) activity.activeDates.add(date.slice(0, 10));
}

function emptyEngineerSignal(login: string): EngineerSignal {
  return { login, commits: 0, pullRequests: 0, reviews: 0, merged: 0 };
}

function emptyRepositoryActivity(name: string): EngineerRepositorySignal {
  return { name, commits: 0, pullRequests: 0, merged: 0, reviews: 0, activeDays: 0 };
}

function ageInDays(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / 86_400_000;
}

function createProgressPlan(config: AppConfig, repositoryCount: number): { total: number } {
  const repositoryUnits = repositoryCount ? Math.ceil(repositoryCount / 2) : 0;
  const engineerUnits = config.engineers.length
    ? (repositoryCount ? 1 : config.repositories.length ? 0 : Math.ceil(config.engineers.length / 20))
    : 0;
  const actionsUnits = config.ciEnabled ? repositoryCount : 0;
  return { total: Math.max(1, repositoryUnits + engineerUnits + actionsUnits) };
}

function repositoryQuery(names: readonly string[], from: string): string {
  const selections = names.map((fullName, index) => {
    const [owner = '', name = ''] = fullName.split('/');
    return `r${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
      visibility isArchived
      defaultBranchRef { name target { ... on Commit {
        statusCheckRollup { state }
        history(first: 100, since: ${JSON.stringify(from)}) { nodes { oid committedDate authors(first: 10) { nodes { user { login } } } } }
      } } }
      pullRequests(first: 100, states: OPEN) {
        totalCount nodes { createdAt updatedAt reviewDecision author { login } }
      }
      activityPullRequests: pullRequests(first: 50, states: [OPEN, CLOSED, MERGED], orderBy: { field: CREATED_AT, direction: DESC }) {
        nodes { id createdAt mergedAt author { login } latestReviews(first: 10) { nodes { submittedAt author { login } } } }
      }
      issues(first: 100, states: OPEN) { totalCount nodes { updatedAt } }
    }`;
  }).join('\n');
  return `query { ${selections} rateLimit { cost remaining resetAt } }`;
}

function engineerQuery(names: readonly string[], from: string, to: string): string {
  const selections = names.map((login, index) => `u${index}: user(login: ${JSON.stringify(login)}) {
    contributionsCollection(from: ${JSON.stringify(from)}, to: ${JSON.stringify(to)}) {
      commitContributionsByRepository(maxRepositories: 100) { repository { nameWithOwner } contributions { totalCount } }
      pullRequestContributionsByRepository(maxRepositories: 100) { repository { nameWithOwner } contributions { totalCount } }
      pullRequestReviewContributionsByRepository(maxRepositories: 100) { repository { nameWithOwner } contributions { totalCount } }
    }
    pullRequests(first: 100, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes { createdAt mergedAt repository { nameWithOwner } }
    }
  }`).join('\n');
  return `query { ${selections} rateLimit { cost remaining resetAt } }`;
}
