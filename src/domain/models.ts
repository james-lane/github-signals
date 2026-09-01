export type ThemeName =
  | 'default'
  | 'tva'
  | 'cyberpunk'
  | 'matrix'
  | 'dracula'
  | 'nord'
  | 'solarized-dark'
  | 'synthwave'
  | 'blueprint';

export type RepositoryPriority = 'owned' | 'contributing';

export interface EngineerConfig {
  id: string;
  name: string;
}

export interface RepositoryConfig {
  name: string;
  priority: RepositoryPriority;
}

export interface SignalThresholds {
  stalePrDays: number;
  staleIssueDays: number;
  reviewWaitHours: number;
  workflowFailureCount: number;
}

export interface AppConfig {
  hostname: string;
  organizations: string[];
  commitLedgerDays: number;
  lookbackDays: number;
  theme: ThemeName;
  showContributingRepositories: boolean;
  ciEnabled: boolean;
  githubStatusEnabled: boolean;
  historyRetentionDays: number;
  engineers: EngineerConfig[];
  repositories: RepositoryConfig[];
  thresholds: SignalThresholds;
}

export interface AuthState {
  loggedIn: boolean;
  detail: string;
}

export interface RateLimit {
  cost?: number;
  remaining: number;
  resetAt?: string;
}

export interface EngineerRepositorySignal {
  name: string;
  commits: number;
  pullRequests: number;
  merged: number;
  reviews: number;
  activeDays: number;
}

export interface EngineerSignal {
  login: string;
  commits: number;
  pullRequests: number;
  merged: number;
  reviews: number;
  repositories?: EngineerRepositorySignal[];
  error?: string;
}

export interface RepositorySignal {
  name: string;
  visibility?: string;
  defaultBranch?: string;
  openPrs?: number;
  stalePrs?: number;
  waitingReviews?: number;
  openPrsWithoutRenovate?: number;
  stalePrsWithoutRenovate?: number;
  waitingReviewsWithoutRenovate?: number;
  openIssues?: number;
  staleIssues?: number;
  failedRuns?: number;
  archived?: boolean;
  error?: string;
}

export interface CiRun {
  repository: string;
  id?: number;
  attempt?: number;
  workflowId?: number;
  workflowPath?: string | null;
  workflow?: string;
  title?: string;
  event?: string | null;
  status?: string | null;
  conclusion?: string | null;
  createdAt?: string;
  startedAt?: string | null;
  updatedAt?: string | null;
  durationMs?: number | null;
  queueMs?: number | null;
  headSha?: string | null;
  headBranch?: string | null;
  actor?: string | null;
  url?: string | null;
  pullRequests?: number[];
  error?: string;
}

export interface SignalSnapshot {
  fetchedAt: string;
  since: string;
  engineers: EngineerSignal[];
  repositories: RepositorySignal[];
  ciRuns: CiRun[];
  rateLimit: RateLimit | null;
}

export interface HistorySnapshot {
  id: number;
  captured_at: string;
  scope_hash: string;
  lookback_days: number;
  commits: number;
  pull_requests: number;
  merged: number;
  reviews: number;
  stale_prs: number;
  waiting_reviews: number;
  stale_issues: number;
  ci_failures: number;
}

export interface EngineerFocusHistoryRow {
  captured_at: string;
  login: string;
  repository: string;
  commits: number;
  pull_requests: number;
  merged: number;
  reviews: number;
  active_days: number;
}

export interface OrganizationCommit {
  organization: string;
  repository: string;
  sha: string;
  branch: string;
  author: string;
  committedAt: string;
  message: string;
  url: string;
}

export interface CollectionProgress {
  current: number;
  total: number;
}

export type ProgressReporter = (message: string, progress: CollectionProgress) => void;

export interface GitHubStatus {
  indicator: 'none' | 'minor' | 'major' | 'critical' | 'maintenance' | 'unavailable';
  description: string;
  checkedAt: string;
}

export interface WorkflowStep {
  name: string;
  number: number;
  status?: string | null;
  conclusion?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
}

export interface WorkflowJob {
  id: number;
  name: string;
  status?: string | null;
  conclusion?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  runnerName?: string | null;
  runnerGroup?: string | null;
  url?: string | null;
  steps: WorkflowStep[];
}

export interface PullRequestReview {
  state: string;
  submittedAt: string;
  author?: { login?: string | null } | null;
}

export interface PullRequestCommit {
  oid: string;
  committedDate: string;
  messageHeadline: string;
  authors: { nodes: Array<{ name?: string | null; user?: { login?: string | null } | null }> };
}

export interface PullRequestDetails {
  number: number;
  title: string;
  body?: string;
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  url: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  headRefOid: string;
  mergeable?: string | null;
  reviewDecision?: string | null;
  author?: { login?: string | null } | null;
  commits: PullRequestCommit[];
  commitCount: number;
  reviews: PullRequestReview[];
  labels: string[];
  assignees: string[];
  requestedReviewers: string[];
  commentCount: number;
}

export interface OpenPullRequests {
  totalCount: number;
  rateLimit: RateLimit | null;
  pullRequests: PullRequestDetails[];
}
