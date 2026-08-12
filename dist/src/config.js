// @ts-nocheck -- Runtime validation remains the source of truth for user-owned JSON.
import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const CONFIG_FILE = '.github-signals.json';
export const CACHE_FILE = '.github-signals-cache.json';
export const defaults = {
    hostname: 'github.com',
    lookbackDays: 14,
    theme: 'default',
    showContributingRepositories: false,
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
export const THEMES = ['default', 'tva', 'cyberpunk', 'matrix', 'dracula', 'nord', 'solarized-dark', 'synthwave', 'blueprint'];
const cleanText = value => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
const boundedInteger = (value, fallback, min, max) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= min && number <= max ? number : fallback;
};
const validHostname = value => {
    const hostname = cleanText(value).toLowerCase();
    return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname) ? hostname : defaults.hostname;
};
export function normalizeRepository(repository) {
    if (typeof repository === 'string')
        repository = { name: repository, priority: 'contributing' };
    const name = cleanText(repository?.name);
    return {
        name: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name) ? name : '',
        priority: repository?.priority === 'owned' ? 'owned' : 'contributing',
    };
}
export const repositoryName = repository => normalizeRepository(repository).name;
export const visibleRepositories = config => config.repositories.filter(repository => config.showContributingRepositories || repository.priority === 'owned');
export function normalizeEngineer(engineer) {
    if (typeof engineer === 'string')
        engineer = { id: engineer, name: engineer };
    const id = cleanText(engineer?.id);
    return {
        id: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(id) ? id : '',
        name: cleanText(engineer?.name || id).slice(0, 100),
    };
}
export const engineerId = engineer => normalizeEngineer(engineer).id;
export function configPath(cwd = process.cwd()) {
    return path.join(cwd, CONFIG_FILE);
}
export function validateConfig(parsed = {}) {
    return {
        ...defaults,
        ...parsed,
        hostname: validHostname(parsed.hostname),
        lookbackDays: boundedInteger(parsed.lookbackDays, defaults.lookbackDays, 1, 365),
        historyRetentionDays: boundedInteger(parsed.historyRetentionDays, defaults.historyRetentionDays, 1, 3650),
        showContributingRepositories: parsed.showContributingRepositories === true,
        theme: THEMES.includes(parsed.theme) ? parsed.theme : 'default',
        engineers: Array.isArray(parsed.engineers) ? parsed.engineers.map(normalizeEngineer).filter(engineer => engineer.id) : [],
        repositories: Array.isArray(parsed.repositories) ? parsed.repositories.map(normalizeRepository).filter(repo => repo.name) : [],
        thresholds: {
            stalePrDays: boundedInteger(parsed.thresholds?.stalePrDays, defaults.thresholds.stalePrDays, 1, 365),
            staleIssueDays: boundedInteger(parsed.thresholds?.staleIssueDays, defaults.thresholds.staleIssueDays, 1, 3650),
            reviewWaitHours: boundedInteger(parsed.thresholds?.reviewWaitHours, defaults.thresholds.reviewWaitHours, 1, 8760),
            workflowFailureCount: boundedInteger(parsed.thresholds?.workflowFailureCount, defaults.thresholds.workflowFailureCount, 1, 100),
        },
    };
}
export async function loadConfig(cwd = process.cwd()) {
    try {
        const parsed = JSON.parse(await readFile(configPath(cwd), 'utf8'));
        return validateConfig(parsed);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return structuredClone(defaults);
        throw new Error(`Could not read ${CONFIG_FILE}: ${error.message}`);
    }
}
export async function saveConfig(config, cwd = process.cwd()) {
    const validated = validateConfig(config);
    Object.assign(config, validated);
    const filename = configPath(cwd);
    await writeFile(filename, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 });
    await chmod(filename, 0o600);
}
export async function loadCache(cwd = process.cwd()) {
    try {
        return JSON.parse(await readFile(path.join(cwd, CACHE_FILE), 'utf8'));
    }
    catch {
        return null;
    }
}
export async function saveCache(data, cwd = process.cwd()) {
    const filename = path.join(cwd, CACHE_FILE);
    await writeFile(filename, `${JSON.stringify(data)}\n`, { mode: 0o600 });
    await chmod(filename, 0o600);
}
// @ts-nocheck -- Runtime validation remains the source of truth for user-owned JSON.
//# sourceMappingURL=config.js.map