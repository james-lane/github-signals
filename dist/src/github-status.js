export const GITHUB_STATUS_URL = 'https://www.githubstatus.com/api/v2/status.json';
const indicators = new Set(['none', 'minor', 'major', 'critical', 'maintenance']);
export function parseGitHubStatus(payload) {
    const status = payload && typeof payload === 'object' ? payload.status : null;
    const indicator = status && typeof status === 'object' ? status.indicator : null;
    const description = status && typeof status === 'object' ? status.description : null;
    if (typeof indicator !== 'string' || !indicators.has(indicator) || typeof description !== 'string' || !description.trim()) {
        throw new Error('GitHub Status returned an unexpected response.');
    }
    return { indicator, description: description.trim().slice(0, 80), checkedAt: new Date().toISOString() };
}
export async function fetchGitHubStatus() {
    const response = await fetch(GITHUB_STATUS_URL, {
        headers: { accept: 'application/json', 'user-agent': 'github-signals' },
        signal: AbortSignal.timeout(5000),
    });
    if (!response.ok)
        throw new Error(`GitHub Status returned HTTP ${response.status}.`);
    return parseGitHubStatus(await response.json());
}
//# sourceMappingURL=github-status.js.map