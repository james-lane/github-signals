import type { WorkflowGroup } from '../domain/dashboard-selectors.js';
import type {
  AppConfig,
  AuthState,
  CiRun,
  EngineerFocusHistoryRow,
  GitHubStatus,
  HistorySnapshot,
  OpenPullRequests,
  OrganizationCommit,
  SignalSnapshot,
  WorkflowJob,
} from '../domain/models.js';

export type ViewName = 'Overview' | 'Engineers' | 'Repositories' | 'Commits' | 'CI' | 'History' | 'Settings';

export interface PullRequestView extends OpenPullRequests {
  repository: string;
  selection: number;
}

export type CiView =
  | { type: 'workflow'; group: WorkflowGroup; selection: number }
  | { type: 'run'; group: WorkflowGroup; run: CiRun; jobs: WorkflowJob[]; selection: number };

export interface CommitLedgerState {
  loaded: boolean;
  commits: OrganizationCommit[];
  focusedCommits: OrganizationCommit[] | null;
  repositories: number;
  activeRepositories: number;
  errors: Array<{ repository: string; error: string }>;
  page: number;
  selection: number;
  repositoryFilter: string;
}

export interface PromptState {
  buffer: string;
  initial: string;
  resolve: (answer: string) => void;
}

export interface RefreshProgress {
  message: string;
  current: number;
  total: number;
}

export interface DashboardState {
  config: AppConfig;
  data: SignalSnapshot | null;
  auth: AuthState;
  history: HistorySnapshot[];
  focusHistory: EngineerFocusHistoryRow[];
  tab: number;
  tabs: ViewName[];
  message: string;
  prompting: boolean;
  refreshController: AbortController | null;
  refreshProgress: RefreshProgress | null;
  selection: Record<number, number>;
  repositoryMetric: number;
  historySelection: number;
  contentFocused: boolean;
  settingsSelection: number;
  themeEditing: boolean;
  prView: PullRequestView | null;
  ciRuns: CiRun[];
  ciErrors: CiRun[];
  ciSelection: number;
  ciWorkflowFilter: string;
  ciView: CiView | null;
  showRenovatePullRequests: boolean;
  githubStatus: GitHubStatus | null;
  commitLedger: CommitLedgerState;
  currentView(): ViewName;
}
