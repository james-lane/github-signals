import { spawn } from 'node:child_process';
import type { AuthState, SignalThresholds } from '../../domain/models.js';
import { runGitHubCli } from './gh-client.js';

export async function getAuthenticationStatus(hostname: string): Promise<AuthState> {
  const result = await runGitHubCli(['auth', 'status', '--hostname', hostname], { allowFailure: true });
  return { loggedIn: result.code === 0, detail: (result.stderr || result.stdout).trim() };
}

export function logInToGitHub(hostname: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'gh',
      ['auth', 'login', '--hostname', hostname, '--web', '--git-protocol', 'https'],
      { stdio: 'inherit' },
    );
    child.on('error', reject);
    child.on('close', code => code === 0
      ? resolve()
      : reject(new Error(`gh auth login exited with status ${code}`)));
  });
}

export function openEngineerProfile(login: string, hostname: string): Promise<void> {
  return openWebUrl(`https://${hostname}/${encodeURIComponent(login)}`);
}

export async function openRepository(fullName: string, hostname: string): Promise<void> {
  const repository = hostname === 'github.com' ? fullName : `${hostname}/${fullName}`;
  await runGitHubCli(['browse', '--repo', repository]);
}

export function openRepositoryMetric(
  fullName: string,
  hostname: string,
  metric: string,
  thresholds: SignalThresholds,
): Promise<void> {
  const baseUrl = `https://${hostname}/${fullName}`;
  const dateBefore = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const reviewBefore = new Date(Date.now() - thresholds.reviewWaitHours * 3_600_000).toISOString();
  const pages: Record<string, string> = {
    repository: baseUrl,
    openPrs: `${baseUrl}/pulls?q=${encodeURIComponent('is:pr is:open')}`,
    stalePrs: `${baseUrl}/pulls?q=${encodeURIComponent(`is:pr is:open updated:<${dateBefore(thresholds.stalePrDays)}`)}`,
    waitingReviews: `${baseUrl}/pulls?q=${encodeURIComponent(`is:pr is:open review:required created:<${reviewBefore}`)}`,
    openIssues: `${baseUrl}/issues?q=${encodeURIComponent('is:issue is:open')}`,
    staleIssues: `${baseUrl}/issues?q=${encodeURIComponent(`is:issue is:open updated:<${dateBefore(thresholds.staleIssueDays)}`)}`,
    failedRuns: `${baseUrl}/actions`,
  };
  return openWebUrl(pages[metric] ?? baseUrl);
}

export function openWebUrl(url: string): Promise<void> {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', reject);
    child.on('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
