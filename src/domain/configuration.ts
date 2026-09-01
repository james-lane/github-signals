import type { AppConfig, EngineerConfig, RepositoryConfig, ThemeName } from './models.js';

export const THEMES = [
  'default',
  'tva',
  'cyberpunk',
  'matrix',
  'dracula',
  'nord',
  'solarized-dark',
  'synthwave',
  'blueprint',
] as const satisfies readonly ThemeName[];

export const defaults: AppConfig = {
  hostname: 'github.com',
  organizations: [],
  commitLedgerDays: 1,
  lookbackDays: 14,
  theme: 'default',
  showContributingRepositories: false,
  ciEnabled: false,
  githubStatusEnabled: true,
  historyRetentionDays: 90,
  engineers: [],
  repositories: [],
  thresholds: {
    stalePrDays: 3,
    staleIssueDays: 14,
    reviewWaitHours: 24,
    workflowFailureCount: 1,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsedValue = Number(value);
  return Number.isSafeInteger(parsedValue) && parsedValue >= minimum && parsedValue <= maximum
    ? parsedValue
    : fallback;
}

function normalizeHostname(value: unknown): string {
  const hostname = cleanText(value).toLowerCase();
  const validHostname = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  return validHostname.test(hostname) ? hostname : defaults.hostname;
}

function normalizeOrganization(value: unknown): string {
  const organization = cleanText(value);
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(organization) ? organization : '';
}

export function normalizeRepository(value: unknown): RepositoryConfig {
  const repository = typeof value === 'string' ? { name: value, priority: 'contributing' } : value;
  const record = isRecord(repository) ? repository : {};
  const name = cleanText(record.name);
  return {
    name: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name) ? name : '',
    priority: record.priority === 'owned' ? 'owned' : 'contributing',
  };
}

export function repositoryName(repository: RepositoryConfig | string): string {
  return normalizeRepository(repository).name;
}

export function visibleRepositories(config: AppConfig): RepositoryConfig[] {
  return config.repositories.filter(repository => config.showContributingRepositories || repository.priority === 'owned');
}

export function normalizeEngineer(value: unknown): EngineerConfig {
  const engineer = typeof value === 'string' ? { id: value, name: value } : value;
  const record = isRecord(engineer) ? engineer : {};
  const id = cleanText(record.id);
  return {
    id: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(id) ? id : '',
    name: cleanText(record.name || id).slice(0, 100),
  };
}

export function engineerId(engineer: EngineerConfig | string): string {
  return normalizeEngineer(engineer).id;
}

export function validateConfig(value: unknown = {}): AppConfig {
  const parsed = isRecord(value) ? value : {};
  const thresholds = isRecord(parsed.thresholds) ? parsed.thresholds : {};
  const theme = cleanText(parsed.theme);

  return {
    ...defaults,
    hostname: normalizeHostname(parsed.hostname),
    organizations: [...new Set((Array.isArray(parsed.organizations) ? parsed.organizations : [])
      .map(normalizeOrganization)
      .filter(Boolean))],
    commitLedgerDays: boundedInteger(parsed.commitLedgerDays, defaults.commitLedgerDays, 1, 30),
    lookbackDays: boundedInteger(parsed.lookbackDays, defaults.lookbackDays, 1, 365),
    historyRetentionDays: boundedInteger(parsed.historyRetentionDays, defaults.historyRetentionDays, 1, 3650),
    showContributingRepositories: parsed.showContributingRepositories === true,
    ciEnabled: parsed.ciEnabled === true,
    githubStatusEnabled: parsed.githubStatusEnabled !== false,
    theme: THEMES.includes(theme as ThemeName) ? theme as ThemeName : 'default',
    engineers: (Array.isArray(parsed.engineers) ? parsed.engineers : [])
      .map(normalizeEngineer)
      .filter(engineer => engineer.id),
    repositories: (Array.isArray(parsed.repositories) ? parsed.repositories : [])
      .map(normalizeRepository)
      .filter(repository => repository.name),
    thresholds: {
      stalePrDays: boundedInteger(thresholds.stalePrDays, defaults.thresholds.stalePrDays, 1, 365),
      staleIssueDays: boundedInteger(thresholds.staleIssueDays, defaults.thresholds.staleIssueDays, 1, 3650),
      reviewWaitHours: boundedInteger(thresholds.reviewWaitHours, defaults.thresholds.reviewWaitHours, 1, 8760),
      workflowFailureCount: boundedInteger(thresholds.workflowFailureCount, defaults.thresholds.workflowFailureCount, 1, 100),
    },
  };
}

export function serializeConfig(config: unknown): string {
  return `${JSON.stringify(validateConfig(config), null, 2)}\n`;
}
