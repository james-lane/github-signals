import { spawn } from 'node:child_process';
import { errorMessage, isNodeError } from '../../shared/errors.js';

export interface GitHubCliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface GitHubCliOptions {
  input?: string;
  allowFailure?: boolean;
  signal?: AbortSignal;
}

export function runGitHubCli(args: readonly string[], options: GitHubCliOptions = {}): Promise<GitHubCliResult> {
  const { input, allowFailure = false, signal } = options;

  return new Promise((resolve, reject) => {
    const child = spawn('gh', [...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const abort = (): boolean => child.kill('SIGTERM');

    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });

    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      reject(new Error(isNodeError(error) && error.code === 'ENOENT' ? 'GitHub CLI (gh) is not installed.' : error.message));
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(new Error('Refresh cancelled.'));
      if (code === 0 || allowFailure) return resolve({ code, stdout, stderr });
      reject(new Error(compactGitHubCliError(stderr) || `gh exited with status ${code}`));
    });

    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

export async function githubRest<T>(
  hostname: string,
  endpoint: string,
  fields: Readonly<Record<string, string | number>> = {},
  signal?: AbortSignal,
): Promise<T> {
  const args = ['api', '--hostname', hostname, endpoint, '--method', 'GET'];
  for (const [key, value] of Object.entries(fields)) args.push('-f', `${key}=${value}`);
  const { stdout } = await runGitHubCli(args, { signal });
  return parseJson<T>(stdout);
}

export async function githubGraphql<T>(hostname: string, query: string, signal?: AbortSignal): Promise<T> {
  const { stdout } = await runGitHubCli(
    ['api', '--hostname', hostname, 'graphql', '-f', `query=${query}`],
    { signal },
  );
  return parseJson<T>(stdout);
}

export function waitForPacing(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Refresh cancelled.'));
    }, { once: true });
  });
}

function parseJson<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error: unknown) {
    throw new Error(`GitHub returned invalid JSON: ${errorMessage(error)}`);
  }
}

function compactGitHubCliError(stderr: string): string {
  const message = stderr.trim().replace(/\s+/g, ' ');
  if (/Resource limits for this query exceeded/i.test(message)) {
    return 'gh: GitHub rejected this batch because its GraphQL resource limit was exceeded.';
  }
  const sentences = message.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
  return [...new Set(sentences.map(sentence => sentence.trim()))].join(' ');
}
