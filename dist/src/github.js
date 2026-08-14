// @ts-nocheck -- GitHub CLI/GraphQL payloads are validated at runtime during migration.
import { spawn } from 'node:child_process';
import { engineerId, repositoryName, visibleRepositories } from './config.js';
export function runGh(args, { input, allowFailure = false, signal } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn('gh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const abort = () => child.kill('SIGTERM');
        if (signal?.aborted)
            abort();
        else
            signal?.addEventListener('abort', abort, { once: true });
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', error => {
            if (settled)
                return;
            settled = true;
            signal?.removeEventListener('abort', abort);
            reject(new Error(error.code === 'ENOENT' ? 'GitHub CLI (gh) is not installed.' : error.message));
        });
        child.on('close', code => {
            if (settled)
                return;
            settled = true;
            signal?.removeEventListener('abort', abort);
            if (signal?.aborted)
                return reject(new Error('Refresh cancelled.'));
            if (code === 0 || allowFailure)
                resolve({ code, stdout, stderr });
            else
                reject(new Error(compactGhError(stderr) || `gh exited with status ${code}`));
        });
        if (input)
            child.stdin.write(input);
        child.stdin.end();
    });
}
function compactGhError(stderr) {
    const message = stderr.trim().replace(/\s+/g, ' ');
    if (/Resource limits for this query exceeded/i.test(message)) {
        return 'gh: GitHub rejected this batch because its GraphQL resource limit was exceeded.';
    }
    const sentences = message.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
    return [...new Set(sentences.map(sentence => sentence.trim()))].join(' ');
}
const pacedWait = (milliseconds, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Refresh cancelled.'));
    }, { once: true });
});
export async function authStatus(hostname) {
    const result = await runGh(['auth', 'status', '--hostname', hostname], { allowFailure: true });
    return { loggedIn: result.code === 0, detail: (result.stderr || result.stdout).trim() };
}
export async function login(hostname) {
    // Inherit the terminal so gh can safely perform its normal device/browser flow.
    return new Promise((resolve, reject) => {
        const child = spawn('gh', ['auth', 'login', '--hostname', hostname, '--web', '--git-protocol', 'https'], { stdio: 'inherit' });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`gh auth login exited with status ${code}`)));
    });
}
export async function openRepository(fullName, hostname) {
    const repository = hostname === 'github.com' ? fullName : `${hostname}/${fullName}`;
    await runGh(['browse', '--repo', repository]);
}
function openUrl(url) {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { detached: true, stdio: 'ignore' });
        child.on('error', reject);
        child.on('spawn', () => { child.unref(); resolve(); });
    });
}
export function openEngineer(loginName, hostname) {
    return openUrl(`https://${hostname}/${encodeURIComponent(loginName)}`);
}
export function openRepositoryMetric(fullName, hostname, metric, thresholds) {
    const base = `https://${hostname}/${fullName}`;
    const before = days => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const reviewBefore = new Date(Date.now() - thresholds.reviewWaitHours * 3600000).toISOString();
    const pages = {
        repository: base,
        openPrs: `${base}/pulls?q=${encodeURIComponent('is:pr is:open')}`,
        stalePrs: `${base}/pulls?q=${encodeURIComponent(`is:pr is:open updated:<${before(thresholds.stalePrDays)}`)}`,
        waitingReviews: `${base}/pulls?q=${encodeURIComponent(`is:pr is:open review:required created:<${reviewBefore}`)}`,
        openIssues: `${base}/issues?q=${encodeURIComponent('is:issue is:open')}`,
        staleIssues: `${base}/issues?q=${encodeURIComponent(`is:issue is:open updated:<${before(thresholds.staleIssueDays)}`)}`,
        failedRuns: `${base}/actions`,
    };
    return openUrl(pages[metric] || base);
}
export function openPullRequest(url) {
    return openUrl(url);
}
export function openGitHubUrl(url) {
    return openUrl(url);
}
async function api(hostname, endpoint, fields = {}, signal) {
    const args = ['api', '--hostname', hostname, endpoint, '--method', 'GET'];
    for (const [key, value] of Object.entries(fields))
        args.push('-f', `${key}=${value}`);
    const { stdout } = await runGh(args, { signal });
    return JSON.parse(stdout);
}
const durationMs = (start, end) => start && end ? Math.max(0, new Date(end).getTime() - new Date(start).getTime()) : null;
export async function fetchActionsSignals(config, onProgress = () => { }, { signal } = {}) {
    const runs = [];
    const repositories = visibleRepositories(config).map(repositoryName);
    for (let index = 0; index < repositories.length; index++) {
        const repository = repositories[index];
        onProgress(`Checking Actions for ${repository} (${index + 1}/${repositories.length})…`);
        try {
            const result = await api(config.hostname, `/repos/${repository}/actions/runs`, { per_page: 20 }, signal);
            for (const run of result.workflow_runs || [])
                runs.push({
                    repository,
                    id: run.id,
                    attempt: run.run_attempt || 1,
                    workflowId: run.workflow_id,
                    workflow: run.name || run.display_title || 'Workflow',
                    title: run.display_title || run.name || 'Workflow run',
                    event: run.event,
                    status: run.status,
                    conclusion: run.conclusion,
                    createdAt: run.created_at,
                    startedAt: run.run_started_at,
                    updatedAt: run.updated_at,
                    durationMs: durationMs(run.run_started_at, run.updated_at),
                    queueMs: durationMs(run.created_at, run.run_started_at),
                    headSha: run.head_sha,
                    headBranch: run.head_branch,
                    actor: run.actor?.login,
                    url: run.html_url,
                    pullRequests: (run.pull_requests || []).map(pr => pr.number),
                });
        }
        catch (error) {
            if (signal?.aborted)
                throw error;
            runs.push({ repository, error: error.message });
        }
        if (index < repositories.length - 1)
            await pacedWait(100, signal);
    }
    return runs;
}
export async function fetchWorkflowRunJobs(repository, runId, hostname, signal) {
    const result = await api(hostname, `/repos/${repository}/actions/runs/${runId}/jobs`, { filter: 'latest', per_page: 100 }, signal);
    return (result.jobs || []).map(job => ({
        id: job.id,
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        durationMs: durationMs(job.started_at, job.completed_at),
        runnerName: job.runner_name,
        runnerGroup: job.runner_group_name,
        url: job.html_url,
        steps: (job.steps || []).map(step => ({
            name: step.name,
            number: step.number,
            status: step.status,
            conclusion: step.conclusion,
            startedAt: step.started_at,
            completedAt: step.completed_at,
            durationMs: durationMs(step.started_at, step.completed_at),
        })),
    }));
}
async function graphql(hostname, query, signal) {
    const { stdout } = await runGh(['api', '--hostname', hostname, 'graphql', '-f', `query=${query}`], { signal });
    return JSON.parse(stdout);
}
export async function fetchOpenPullRequests(fullName, hostname, signal) {
    const [owner, name] = fullName.split('/');
    const query = `query {
    repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
      pullRequests(first: 50, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) {
        totalCount
        nodes {
          number title body createdAt updatedAt isDraft url additions deletions changedFiles headRefOid
          mergeable reviewDecision
          author { login }
          labels(first: 10) { nodes { name } }
          assignees(first: 10) { nodes { login } }
          reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
          comments { totalCount }
          commits(first: 50) {
            totalCount
            nodes { commit { oid committedDate messageHeadline authors(first: 10) { nodes { name user { login } } } } }
          }
          latestReviews(first: 20) { nodes { state submittedAt author { login } } }
        }
      }
    }
    rateLimit { cost remaining resetAt }
  }`;
    const result = await graphql(hostname, query, signal);
    const connection = result.data?.repository?.pullRequests;
    if (!connection)
        throw new Error('Repository not found or not accessible.');
    return {
        totalCount: connection.totalCount,
        rateLimit: result.data.rateLimit,
        pullRequests: connection.nodes.map(pr => ({
            ...pr,
            commits: pr.commits.nodes.map(node => node.commit),
            commitCount: pr.commits.totalCount,
            reviews: pr.latestReviews.nodes,
            labels: pr.labels.nodes.map(label => label.name),
            assignees: pr.assignees.nodes.map(user => user.login),
            requestedReviewers: pr.reviewRequests.nodes.map(request => request.requestedReviewer?.login || request.requestedReviewer?.name).filter(Boolean),
            commentCount: pr.comments.totalCount,
        })),
    };
}
const ageDays = iso => (Date.now() - new Date(iso).getTime()) / 86400000;
export const isRenovateAuthor = login => /^renovate(?:\[bot\])?$/i.test(login || '');
const contributionCount = (groups, repositories) => {
    if (!repositories.length)
        return groups.reduce((sum, group) => sum + group.contributions.totalCount, 0);
    const allowed = new Set(repositories.map(repositoryName).map(name => name.toLowerCase()));
    return groups.reduce((sum, group) => allowed.has(group.repository.nameWithOwner.toLowerCase()) ? sum + group.contributions.totalCount : sum, 0);
};
async function engineerSignals(config, names, since, signal) {
    const engineers = [];
    let rateLimit = null;
    const from = `${since}T00:00:00Z`;
    const to = new Date().toISOString();
    for (let offset = 0; offset < names.length; offset += 20) {
        const chunk = names.slice(offset, offset + 20);
        const selections = chunk.map((loginName, index) => `u${index}: user(login: ${JSON.stringify(loginName)}) {
      contributionsCollection(from: ${JSON.stringify(from)}, to: ${JSON.stringify(to)}) {
        commitContributionsByRepository(maxRepositories: 100) { repository { nameWithOwner } contributions { totalCount } }
        pullRequestContributionsByRepository(maxRepositories: 100) { repository { nameWithOwner } contributions { totalCount } }
        pullRequestReviewContributionsByRepository(maxRepositories: 100) { repository { nameWithOwner } contributions { totalCount } }
      }
      pullRequests(first: 100, orderBy: { field: CREATED_AT, direction: DESC }) {
        nodes { createdAt mergedAt repository { nameWithOwner } }
      }
    }`).join('\n');
        try {
            const result = await graphql(config.hostname, `query { ${selections} rateLimit { cost remaining resetAt } }`, signal);
            rateLimit = result.data.rateLimit;
            chunk.forEach((loginName, index) => {
                const user = result.data[`u${index}`];
                if (!user)
                    return engineers.push({ login: loginName, error: 'GitHub user not found or not accessible.' });
                const c = user.contributionsCollection;
                const allowed = new Set(config.repositories.map(repositoryName).map(name => name.toLowerCase()));
                const recentPulls = user.pullRequests.nodes.filter(pr => pr.createdAt >= from && (!allowed.size || allowed.has(pr.repository.nameWithOwner.toLowerCase())));
                const repositoryActivity = new Map();
                const addContributions = (groups, key) => groups.forEach(group => {
                    const name = group.repository.nameWithOwner;
                    if (allowed.size && !allowed.has(name.toLowerCase()))
                        return;
                    if (!repositoryActivity.has(name))
                        repositoryActivity.set(name, { name, commits: 0, pullRequests: 0, merged: 0, reviews: 0, activeDays: 0 });
                    repositoryActivity.get(name)[key] += group.contributions.totalCount;
                });
                addContributions(c.commitContributionsByRepository, 'commits');
                addContributions(c.pullRequestContributionsByRepository, 'pullRequests');
                addContributions(c.pullRequestReviewContributionsByRepository, 'reviews');
                recentPulls.filter(pr => pr.mergedAt).forEach(pr => {
                    const name = pr.repository.nameWithOwner;
                    if (!repositoryActivity.has(name))
                        repositoryActivity.set(name, { name, commits: 0, pullRequests: 0, merged: 0, reviews: 0, activeDays: 0 });
                    repositoryActivity.get(name).merged += 1;
                });
                engineers.push({
                    login: loginName,
                    commits: contributionCount(c.commitContributionsByRepository, config.repositories),
                    pullRequests: contributionCount(c.pullRequestContributionsByRepository, config.repositories),
                    reviews: contributionCount(c.pullRequestReviewContributionsByRepository, config.repositories),
                    merged: recentPulls.filter(pr => pr.mergedAt).length,
                    repositories: [...repositoryActivity.values()],
                });
            });
        }
        catch (error) {
            if (signal?.aborted)
                throw error;
            chunk.forEach(login => engineers.push({ login, error: error.message }));
        }
    }
    return { engineers, rateLimit };
}
function repositorySignal(config, fullName, repo) {
    if (!repo)
        return { name: fullName, error: 'Repository not found or not accessible.' };
    const pulls = repo.pullRequests.nodes;
    const issues = repo.issues.nodes;
    const stalePrs = pulls.filter(pr => ageDays(pr.updatedAt) >= config.thresholds.stalePrDays).length;
    const waitingReviews = pulls.filter(pr => ageDays(pr.createdAt) * 24 >= config.thresholds.reviewWaitHours && pr.reviewDecision === 'REVIEW_REQUIRED').length;
    const staleIssues = issues.filter(issue => ageDays(issue.updatedAt) >= config.thresholds.staleIssueDays).length;
    const nonRenovatePulls = pulls.filter(pr => !isRenovateAuthor(pr.author?.login));
    const ciState = repo.defaultBranchRef?.target?.statusCheckRollup?.state || 'UNKNOWN';
    return {
        name: fullName,
        visibility: repo.visibility.toLowerCase(),
        defaultBranch: repo.defaultBranchRef?.name || '—',
        openPrs: repo.pullRequests.totalCount,
        stalePrs,
        waitingReviews,
        openPrsWithoutRenovate: nonRenovatePulls.length,
        stalePrsWithoutRenovate: nonRenovatePulls.filter(pr => ageDays(pr.updatedAt) >= config.thresholds.stalePrDays).length,
        waitingReviewsWithoutRenovate: nonRenovatePulls.filter(pr => ageDays(pr.createdAt) * 24 >= config.thresholds.reviewWaitHours && pr.reviewDecision === 'REVIEW_REQUIRED').length,
        openIssues: repo.issues.totalCount,
        staleIssues,
        failedRuns: ['FAILURE', 'ERROR'].includes(ciState) ? 1 : 0,
        archived: repo.isArchived,
    };
}
async function repositorySignals(config, names, since, signal) {
    const repositories = [];
    const activity = [];
    let rateLimit = null;
    // One GraphQL request replaces four REST requests per repository. Chunking keeps
    // query cost and response size reasonable for large configurations.
    const from = `${since}T00:00:00Z`;
    for (let offset = 0; offset < names.length; offset += 2) {
        if (offset)
            await pacedWait(250, signal);
        const chunk = names.slice(offset, offset + 2);
        const selections = chunk.map((fullName, index) => {
            const [owner, name] = fullName.split('/');
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
        const query = `query { ${selections} rateLimit { cost remaining resetAt } }`;
        try {
            const result = await graphql(config.hostname, query, signal);
            rateLimit = result.data.rateLimit;
            chunk.forEach((fullName, index) => {
                const repo = result.data[`r${index}`];
                repositories.push(repositorySignal(config, fullName, repo));
                if (repo)
                    activity.push({
                        name: fullName,
                        commits: repo.defaultBranchRef?.target?.history?.nodes || [],
                        pullRequests: repo.activityPullRequests.nodes.map(pr => ({ ...pr, reviews: pr.latestReviews })),
                    });
            });
        }
        catch (error) {
            if (signal?.aborted)
                throw error;
            chunk.forEach(name => repositories.push({ name, error: error.message }));
        }
    }
    return { repositories, activity, rateLimit };
}
export function engineerSignalsFromRepositories(engineers, activity, since) {
    const from = `${since}T00:00:00Z`;
    const byLogin = new Map(engineers.map(engineer => {
        const login = engineerId(engineer);
        return [login.toLowerCase(), { login, commits: 0, pullRequests: 0, reviews: 0, merged: 0, reviewedPulls: new Set(), repositoryActivity: new Map() }];
    }));
    const repositorySignal = (engineer, repository) => {
        if (!engineer.repositoryActivity.has(repository))
            engineer.repositoryActivity.set(repository, {
                name: repository, commits: 0, pullRequests: 0, merged: 0, reviews: 0, activeDates: new Set(),
            });
        return engineer.repositoryActivity.get(repository);
    };
    const markActive = (focus, date) => { if (date)
        focus.activeDates.add(date.slice(0, 10)); };
    for (const repo of activity) {
        for (const commit of repo.commits) {
            const credited = new Set();
            for (const author of commit.authors.nodes) {
                const signal = byLogin.get(author.user?.login?.toLowerCase());
                if (signal && !credited.has(signal.login)) {
                    signal.commits += 1;
                    const focus = repositorySignal(signal, repo.name);
                    focus.commits += 1;
                    markActive(focus, commit.committedDate);
                    credited.add(signal.login);
                }
            }
        }
        for (const pr of repo.pullRequests) {
            const author = byLogin.get(pr.author?.login?.toLowerCase());
            if (author && pr.createdAt >= from) {
                author.pullRequests += 1;
                const focus = repositorySignal(author, repo.name);
                focus.pullRequests += 1;
                markActive(focus, pr.createdAt);
            }
            if (author && pr.mergedAt >= from) {
                author.merged += 1;
                const focus = repositorySignal(author, repo.name);
                focus.merged += 1;
                markActive(focus, pr.mergedAt);
            }
            for (const review of pr.reviews.nodes) {
                const reviewer = byLogin.get(review.author?.login?.toLowerCase());
                const reviewKey = `${repo.name}:${pr.id}`;
                if (reviewer && review.submittedAt >= from && !reviewer.reviewedPulls.has(reviewKey)) {
                    reviewer.reviews += 1;
                    reviewer.reviewedPulls.add(reviewKey);
                    const focus = repositorySignal(reviewer, repo.name);
                    focus.reviews += 1;
                    markActive(focus, review.submittedAt);
                }
            }
        }
    }
    return [...byLogin.values()].map(({ reviewedPulls, repositoryActivity, ...signal }) => ({
        ...signal,
        repositories: [...repositoryActivity.values()].map(({ activeDates, ...focus }) => ({ ...focus, activeDays: activeDates.size })),
    }));
}
export async function fetchSignals(config, onProgress = () => { }, { signal } = {}) {
    const since = new Date(Date.now() - config.lookbackDays * 86400000).toISOString().slice(0, 10);
    const repositoriesInScope = visibleRepositories(config);
    let engineers = [];
    let rateLimit = null;
    let repositories = [];
    let activity = [];
    if (repositoriesInScope.length) {
        onProgress(`Checking health and team activity across ${repositoriesInScope.length} repositories…`);
        const repoResult = await repositorySignals(config, repositoriesInScope.map(repositoryName), since, signal);
        repositories = repoResult.repositories;
        activity = repoResult.activity;
        rateLimit = repoResult.rateLimit || rateLimit;
    }
    if (config.engineers.length) {
        if (repositoriesInScope.length)
            engineers = engineerSignalsFromRepositories(config.engineers, activity, since);
        else if (config.repositories.length)
            engineers = config.engineers.map(engineer => ({ login: engineerId(engineer), commits: 0, pullRequests: 0, reviews: 0, merged: 0 }));
        else {
            onProgress(`Fetching activity for ${config.engineers.length} engineers…`);
            ({ engineers, rateLimit } = await engineerSignals(config, config.engineers.map(engineerId), since, signal));
        }
    }
    const ciRuns = config.ciEnabled && repositoriesInScope.length ? await fetchActionsSignals(config, onProgress, { signal }) : [];
    return { fetchedAt: new Date().toISOString(), since, engineers, repositories, ciRuns, rateLimit };
}
// @ts-nocheck -- GitHub CLI/GraphQL payloads are validated at runtime during migration.
//# sourceMappingURL=github.js.map