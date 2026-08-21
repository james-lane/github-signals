#!/usr/bin/env node
// @ts-nocheck -- Incremental migration boundary for the stateful terminal UI.
import { authStatus, fetchOpenPullRequests, fetchSignals, fetchWorkflowPath, fetchWorkflowRunJobs, isRenovateAuthor, login, openEngineer, openGitHubUrl, openPullRequest, openRepositoryMetric } from './github.js';
import { CACHE_FILE, CONFIG_FILE, engineerId, loadCache, loadConfig, repositoryName, saveCache, saveConfig, serializeConfig, visibleRepositories } from './config.js';
import { loadCiRuns, loadEngineerFocusHistory, loadHistory, recordCiRuns, recordSnapshot } from './history.js';
import { sanitizeTerminal } from './terminal.js';
import { APP_VERSION } from './version.js';
import { copyToClipboard } from './clipboard.js';
import { aggregateEngineerFocus, focusScore } from './focus.js';
import { fetchGitHubStatus, GITHUB_STATUS_PAGE_URL } from './github-status.js';
import { ciContextWebUrl } from './web-navigation.js';
const A = '\x1b[';
const SETTINGS_COUNT = 11;
const color = (n, s) => `${A}${n}m${s}${A}0m`;
const themes = {
    default: { accent: '36', success: '32', warning: '33', error: '31', muted: '2', selectedRow: '48;5;236', selectedCell: '30;46' },
    tva: { accent: '38;5;208', success: '38;5;179', warning: '38;5;214', error: '38;5;167', muted: '38;5;137', selectedRow: '38;5;223;48;5;94', selectedCell: '30;48;5;208' },
    cyberpunk: { accent: '38;5;51', success: '38;5;82', warning: '38;5;226', error: '38;5;198', muted: '38;5;99', selectedRow: '38;5;51;48;5;54', selectedCell: '30;48;5;198' },
    matrix: { accent: '38;5;46', success: '38;5;82', warning: '38;5;154', error: '38;5;196', muted: '38;5;28', selectedRow: '38;5;120;48;5;22', selectedCell: '30;48;5;46' },
    dracula: { accent: '38;5;141', success: '38;5;84', warning: '38;5;228', error: '38;5;203', muted: '38;5;103', selectedRow: '38;5;189;48;5;61', selectedCell: '30;48;5;212' },
    nord: { accent: '38;5;110', success: '38;5;108', warning: '38;5;179', error: '38;5;167', muted: '38;5;103', selectedRow: '38;5;153;48;5;60', selectedCell: '30;48;5;110' },
    'solarized-dark': { accent: '38;5;37', success: '38;5;64', warning: '38;5;136', error: '38;5;160', muted: '38;5;66', selectedRow: '38;5;109;48;5;23', selectedCell: '30;48;5;136' },
    synthwave: { accent: '38;5;45', success: '38;5;87', warning: '38;5;220', error: '38;5;201', muted: '38;5;98', selectedRow: '38;5;213;48;5;53', selectedCell: '30;48;5;45' },
    blueprint: { accent: '38;5;75', success: '38;5;121', warning: '38;5;214', error: '38;5;203', muted: '38;5;67', selectedRow: '38;5;195;48;5;25', selectedCell: '30;48;5;75' },
};
const themeNames = {
    default: 'Default', tva: 'TVA', cyberpunk: 'Cyberpunk', matrix: 'Matrix', dracula: 'Dracula', nord: 'Nord',
    'solarized-dark': 'Solarized Dark', synthwave: 'Synthwave', blueprint: 'Blueprint',
};
let palette = themes.default;
const setTheme = name => { palette = themes[name] || themes.default; };
const cyan = s => color(palette.accent, s);
const orange = s => color('38;5;208', s);
const green = s => color(palette.success, s);
const yellow = s => color(palette.warning, s);
const red = s => color(palette.error, s);
const dim = s => color(palette.muted, s);
const selectedRow = s => color(palette.selectedRow, s);
const selectedCell = s => color(palette.selectedCell, s);
const bold = s => color(1, s);
const strip = s => String(s).replace(/\x1b\[[0-9;]*m/g, '');
const fit = (s, width) => strip(s).length <= width ? s : `${strip(s).slice(0, Math.max(0, width - 1))}…`;
const cell = (value, width) => fit(String(value), width).padEnd(width);
const engineerLabel = engineer => engineer.name && engineer.name !== engineerId(engineer) ? `${engineer.name} (@${engineerId(engineer)})` : `@${engineerId(engineer)}`;
const elapsed = value => {
    const milliseconds = Math.max(0, Date.now() - new Date(value).getTime());
    const hours = Math.floor(milliseconds / 3600000);
    if (hours < 1)
        return '<1h';
    if (hours < 48)
        return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 14)
        return `${days}d ${hours % 24}h`;
    return `${Math.floor(days / 7)}w ${days % 7}d`;
};
const duration = milliseconds => {
    if (milliseconds == null)
        return '—';
    const seconds = Math.round(milliseconds / 1000);
    if (seconds < 60)
        return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`;
    return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`;
};
const percentile = (values, percentileValue) => {
    const sorted = values.filter(value => value != null).sort((a, b) => a - b);
    if (!sorted.length)
        return null;
    return sorted[Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1)];
};
const sparkline = values => {
    const bars = '▁▂▃▄▅▆▇█';
    if (!values.length)
        return dim('no history');
    const min = Math.min(...values), max = Math.max(...values);
    return values.map(value => bars[max === min ? 3 : Math.round((value - min) / (max - min) * 7)]).join('');
};
const trend = (current, previous, lowerIsBetter = false) => {
    if (previous == null || current === previous)
        return dim('→');
    const improved = lowerIsBetter ? current < previous : current > previous;
    return improved ? green(current > previous ? '↑' : '↓') : red(current > previous ? '↑' : '↓');
};
class App {
    constructor(config, cache, auth, history = [], ciRuns = [], focusHistory = []) {
        this.config = config;
        this.data = cache;
        this.auth = auth;
        this.history = history;
        this.focusHistory = focusHistory;
        this.tab = 0;
        this.message = '';
        this.busy = false;
        this.prompting = false;
        this.refreshController = null;
        this.refreshProgress = null;
        this.lastRefreshStartedAt = 0;
        this.selection = { 1: 0, 2: 0 };
        this.repositoryMetric = 0;
        this.historySelection = Math.max(0, history.length - 1);
        this.contentFocused = false;
        this.settingsSelection = 0;
        this.themeEditing = false;
        this.promptState = null;
        this.prView = null;
        this.ciRuns = ciRuns;
        this.ciErrors = (cache?.ciRuns || []).filter(run => run.error);
        this.ciSelection = 0;
        this.ciView = null;
        this.showRenovatePullRequests = true;
        this.githubStatus = null;
        this.statusTimer = null;
        this.stopped = false;
        setTheme(config.theme);
        this.tabs = this.buildTabs();
    }
    buildTabs() {
        return ['Overview', 'Engineers', 'Repositories', ...(this.config.ciEnabled && this.config.repositories.length ? ['CI'] : []), ...(this.history.length ? ['History'] : []), 'Settings'];
    }
    currentView() { return this.tabs[this.tab]; }
    syncTabs() {
        const current = this.currentView();
        this.tabs = this.buildTabs();
        this.tab = Math.max(0, this.tabs.indexOf(current));
    }
    line(text = '') { process.stdout.write(`${fit(sanitizeTerminal(text), process.stdout.columns || 100)}${A}K\n`); }
    statusBadge() {
        if (!this.config.githubStatusEnabled)
            return '';
        if (!this.githubStatus)
            return dim('GitHub status ◌ checking');
        const { indicator, description } = this.githubStatus;
        if (indicator === 'unavailable')
            return dim('GitHub status ○ unavailable');
        const marker = indicator === 'none' ? green('●') : indicator === 'minor' || indicator === 'maintenance' ? yellow('●') : red('●');
        return `${dim('GitHub status')} ${marker} ${indicator === 'none' ? green(description) : indicator === 'minor' || indicator === 'maintenance' ? yellow(description) : red(description)}`;
    }
    footer(text) {
        const width = process.stdout.columns || 100;
        // Avoid the terminal's final column: writing into it can trigger auto-wrap
        // and cause the last version character to be replaced during redraw.
        const usableWidth = Math.max(1, width - 2);
        const version = dim(`v${APP_VERSION}`);
        const left = fit(text, Math.max(1, usableWidth - strip(version).length - 1));
        this.line(`${left}${' '.repeat(Math.max(1, usableWidth - strip(left).length - strip(version).length))}${version}`);
    }
    refreshFooter() {
        const progress = this.refreshProgress || { message: 'Refreshing…', current: 0, total: 1 };
        const ratio = Math.max(0, Math.min(1, progress.total ? progress.current / progress.total : 0));
        const barWidth = Math.max(10, Math.min(28, Math.floor((process.stdout.columns || 100) / 7)));
        const filled = Math.round(ratio * barWidth);
        const bar = `${cyan('█'.repeat(filled))}${dim('░'.repeat(barWidth - filled))}`;
        return `${dim('[')}${bar}${dim(']')} ${cyan(`${String(Math.round(ratio * 100)).padStart(3)}%`)}  ${progress.message}  ${dim('c cancel')}`;
    }
    errorLines(label, error) {
        const width = Math.max(40, process.stdout.columns || 100);
        const prefix = `${label} ${red('error')} `;
        const indent = ' '.repeat(strip(prefix).length);
        const words = String(error).replace(/\s+/g, ' ').trim().split(' ');
        let line = prefix;
        for (const word of words) {
            if (strip(line).length + word.length + 1 > width) {
                this.line(line);
                line = `${indent}${word}`;
            }
            else
                line += `${strip(line).endsWith(' ') ? '' : ' '}${word}`;
        }
        if (strip(line).trim())
            this.line(line);
    }
    badge(n, bad = false) { return n ? (bad ? red(String(n)) : cyan(String(n))) : dim('0'); }
    ciMetricsAt(capturedAt = new Date().toISOString()) {
        const end = new Date(capturedAt).getTime();
        const start = end - this.config.lookbackDays * 86400000;
        const runs = this.ciRuns.filter(run => {
            const created = new Date(run.createdAt).getTime();
            return !run.error && created >= start && created <= end;
        });
        const failedConclusions = new Set(['failure', 'timed_out', 'action_required', 'startup_failure']);
        const decided = runs.filter(run => run.conclusion === 'success' || failedConclusions.has(run.conclusion));
        const successful = decided.filter(run => run.conclusion === 'success').length;
        const failed = decided.length - successful;
        const completed = runs.filter(run => run.status === 'completed');
        const workflows = new Set(runs.map(run => `${run.repository}:${run.workflowId || run.workflow}`));
        const failingWorkflows = new Set(runs.filter(run => failedConclusions.has(run.conclusion)).map(run => `${run.repository}:${run.workflowId || run.workflow}`));
        return {
            runs: runs.length,
            workflows: workflows.size,
            failingWorkflows: failingWorkflows.size,
            failed,
            running: runs.filter(run => run.status !== 'completed').length,
            successRate: decided.length ? Math.round(successful / decided.length * 100) : null,
            p50: percentile(completed.map(run => run.durationMs), 0.5),
            p95: percentile(completed.map(run => run.durationMs), 0.95),
            queue: percentile(completed.map(run => run.queueMs), 0.5),
        };
    }
    render() {
        this.syncTabs();
        if (!this.prompting && process.stdin.isTTY && !process.stdin.isRaw)
            process.stdin.setRawMode(true);
        const width = Math.max(60, process.stdout.columns || 100);
        process.stdout.write(`\x1b]0;GitHub Signals — ${this.currentView()}\x07${A}?25l${A}H${A}2J`);
        const headerLeft = `${bold(cyan('◈ GitHub Signals'))}  ${this.auth.loggedIn ? green('● gh authenticated') : yellow('○ login required')}  ${dim(this.config.hostname)}`;
        const headerRight = this.statusBadge();
        // Keep clear of the terminal's auto-wrap column so the final status
        // character survives redraws in macOS Terminal and similar emulators.
        if (headerRight) {
            const headerWidth = width - 2;
            const visibleHeaderRight = fit(headerRight, Math.max(1, headerWidth - strip(headerLeft).length - 2));
            const headerGap = Math.max(2, headerWidth - strip(headerLeft).length - strip(visibleHeaderRight).length);
            this.line(`${headerLeft}${' '.repeat(headerGap)}${visibleHeaderRight}`);
        }
        else
            this.line(headerLeft);
        this.line(dim('─'.repeat(width)));
        this.line(this.tabs.map((t, i) => {
            if (i !== this.tab)
                return dim(`  ${t}  `);
            const selected = bold(`[ ${t} ]`);
            return this.contentFocused ? orange(selected) : selected;
        }).join(' '));
        this.line();
        if (this.currentView() === 'Overview')
            this.overview();
        if (this.currentView() === 'Engineers')
            this.engineers();
        if (this.currentView() === 'Repositories')
            this.prView ? this.pullRequestsView() : this.repositories();
        if (this.currentView() === 'CI')
            this.ciView ? this.ciDetailView() : this.ciOverview();
        if (this.currentView() === 'History')
            this.historyView();
        if (this.currentView() === 'Settings')
            this.settings();
        this.line();
        this.line(dim('─'.repeat(width)));
        const renovateToggle = (this.prView || this.currentView() === 'Repositories') ? `  v Renovate ${this.showRenovatePullRequests ? 'shown' : 'hidden'}` : '';
        const navigation = this.prView ? '↑/↓ pull request  Enter open  w web  Esc repositories'
            : this.currentView() === 'CI' && this.ciView?.type === 'run' ? '↑/↓ job  Enter open  w web  Esc runs'
                : this.currentView() === 'CI' && this.ciView?.type === 'workflow' ? '↑/↓ run  Enter jobs  w web  Esc workflows'
                    : this.contentFocused
                        ? (this.currentView() === 'Repositories' ? '↑/↓ repo  ←/→ metric  Enter open  Esc nav'
                            : this.currentView() === 'CI' ? '↑/↓ workflow  Enter runs  w web  Esc nav'
                                : this.currentView() === 'History' ? '↑/↓ snapshot  Esc nav'
                                    : this.currentView() === 'Settings' ? (this.themeEditing ? '←/→ preview theme  Enter apply  Esc setting' : '↑/↓ setting  Enter edit  y copy setup  Esc nav')
                                        : '↑/↓ engineer  Enter open  Esc nav')
                        : '←/→ views  Enter select';
        this.footer(this.refreshController ? this.refreshFooter() : (this.message || dim(`${navigation}${renovateToggle}  r refresh  s status  a add  d delete  p priority  l login  q quit`)));
        // macOS Terminal may retain saved lines even in the alternate screen. Clear
        // only the active alternate buffer's scrollback after each full redraw.
        process.stdout.write(`${A}3J`);
    }
    overview() {
        this.line(bold('Dashboard'));
        if (!this.config.engineers.length && !this.config.repositories.length) {
            this.line(yellow('No signals configured yet. Press a to add an engineer or repository.'));
            this.line(dim(`Configuration is saved in ${CONFIG_FILE}.`));
            return;
        }
        if (!this.data) {
            this.line(dim('Press r to fetch GitHub data.'));
            return;
        }
        const e = this.data.engineers || [];
        const visibleNames = new Set(visibleRepositories(this.config).map(repositoryName));
        const repos = (this.data.repositories || []).filter(repo => visibleNames.has(repo.name));
        const totals = e.reduce((a, x) => ({ commits: a.commits + (x.commits || 0), prs: a.prs + (x.pullRequests || 0), merged: a.merged + (x.merged || 0), reviews: a.reviews + (x.reviews || 0) }), { commits: 0, prs: 0, merged: 0, reviews: 0 });
        const repoTotals = repos.reduce((a, x) => ({ open: a.open + (x.openPrs || 0), stale: a.stale + (x.stalePrs || 0), waiting: a.waiting + (x.waitingReviews || 0), issues: a.issues + (x.staleIssues || 0), ci: a.ci + (x.failedRuns || 0) }), { open: 0, stale: 0, waiting: 0, issues: 0, ci: 0 });
        const ci = this.ciMetricsAt(this.data.fetchedAt || new Date().toISOString());
        const width = process.stdout.columns || 100;
        const gap = 2;
        const panelWidth = width >= 96 ? Math.floor((width - gap) / 2) : width;
        const panel = (title, rows) => {
            const inner = Math.max(20, panelWidth - 2);
            return [
                dim(`┌${'─'.repeat(inner)}┐`),
                `${dim('│')} ${bold(title)}${' '.repeat(Math.max(0, inner - strip(title).length - 1))}${dim('│')}`,
                ...rows.map(row => `${dim('│')} ${fit(row, inner - 1)}${' '.repeat(Math.max(0, inner - 1 - strip(fit(row, inner - 1)).length))}${dim('│')}`),
                dim(`└${'─'.repeat(inner)}┘`),
            ];
        };
        const activityPanel = panel(`Team activity · ${this.config.lookbackDays} days`, [
            `${cyan(String(totals.commits).padStart(3))} commits ${trend(totals.commits, this.history.at(-2)?.commits)}   ${cyan(String(totals.prs).padStart(3))} pull requests ${trend(totals.prs, this.history.at(-2)?.pull_requests)}`,
            `${green(String(totals.merged).padStart(3))} merged     ${cyan(String(totals.reviews).padStart(3))} reviews`,
            `${cyan(sparkline(this.history.map(item => item.commits)))} ${dim(`commits · ${this.history.length} snapshots`)}`,
        ]);
        const healthPanel = panel(`Repository health · ${repos.length} in scope`, [
            `${repoTotals.stale ? red(String(repoTotals.stale).padStart(3)) : green('  0')} stale PRs   ${repoTotals.waiting ? yellow(String(repoTotals.waiting).padStart(3)) : green('  0')} waiting`,
            `${repoTotals.issues ? red(String(repoTotals.issues).padStart(3)) : green('  0')} stale issues ${repoTotals.ci ? red(String(repoTotals.ci).padStart(3)) : green('  0')} CI failures`,
            `${red(sparkline(this.history.map(item => item.stale_prs + item.waiting_reviews + item.stale_issues + item.ci_failures)))} ${dim(`attention · ${this.history.length} snapshots`)}`,
        ]);
        const drawPanels = (left, right) => {
            if (width < 96) {
                left.forEach(line => this.line(line));
                this.line();
                right.forEach(line => this.line(line));
            }
            else
                left.forEach((line, index) => this.line(`${line}${' '.repeat(gap)}${right[index]}`));
        };
        drawPanels(activityPanel, healthPanel);
        this.line();
        if (this.config.ciEnabled) {
            const ciHistory = this.history.map(snapshot => this.ciMetricsAt(snapshot.captured_at));
            const ciPanel = panel(`CI performance · ${this.config.lookbackDays} days`, [
                `${ci.successRate == null ? dim('  —') : ci.successRate >= 90 ? green(`${String(ci.successRate).padStart(3)}%`) : red(`${String(ci.successRate).padStart(3)}%`)} success   ${cyan(String(ci.runs).padStart(3))} runs across ${cyan(String(ci.workflows))} workflows`,
                `p50 ${cyan(duration(ci.p50))}   p95 ${cyan(duration(ci.p95))}   queue ${cyan(duration(ci.queue))}`,
                `${cyan(sparkline(ciHistory.map(item => item.successRate ?? 0)))} ${dim(`success rate · ${this.history.length} snapshots`)}`,
            ]);
            const ciAttentionPanel = panel('CI attention', [
                `${ci.failed ? red(String(ci.failed).padStart(3)) : green('  0')} failed runs   ${ci.running ? yellow(String(ci.running).padStart(3)) : green('  0')} running`,
                `${ci.failingWorkflows ? red(String(ci.failingWorkflows).padStart(3)) : green('  0')} workflows with failures`,
                ci.runs ? dim('Enter the CI view for workflow, run, job and step detail') : dim('No stored Actions runs yet · press r to refresh'),
            ]);
            drawPanels(ciPanel, ciAttentionPanel);
            this.line();
        }
        const engineerById = new Map(this.config.engineers.map(engineer => [engineerId(engineer), engineer]));
        const topEngineers = [...e].filter(x => !x.error).sort((a, b) => (b.commits + b.pullRequests + b.reviews) - (a.commits + a.pullRequests + a.reviews)).slice(0, 4);
        const hotspots = [...repos].filter(x => !x.error).map(repo => ({ ...repo, attention: (repo.stalePrs || 0) + (repo.waitingReviews || 0) + (repo.staleIssues || 0) + (repo.failedRuns || 0) })).sort((a, b) => b.attention - a.attention).slice(0, 4);
        const peoplePanel = panel('Most active', topEngineers.length ? topEngineers.map((person, index) => {
            const engineer = engineerById.get(person.login);
            return `${index + 1}. ${engineer?.name || `@${person.login}`}  ${dim(`${person.commits} commits · ${person.pullRequests} PRs · ${person.reviews} reviews`)}`;
        }) : [dim('No activity in this period')]);
        const hotspotPanel = panel('Needs attention', hotspots.length ? hotspots.map((repo, index) => {
            const shortName = repo.name.split('/').pop();
            return `${index + 1}. ${shortName}  ${repo.attention ? red(`${repo.attention} signals`) : green('healthy')}`;
        }) : [green('No repository attention signals')]);
        drawPanels(peoplePanel, hotspotPanel);
        this.line();
        const freshness = Date.now() - new Date(this.data.fetchedAt).getTime() < 3600000 ? green('● current') : yellow('● cached');
        this.line(`${freshness}  ${dim(`Refreshed ${new Date(this.data.fetchedAt).toLocaleString()} · ${this.config.showContributingRepositories ? 'owned + contributing' : 'owned only'}${this.data.rateLimit ? ` · API ${this.data.rateLimit.remaining} remaining` : ''}`)}`);
    }
    engineers() {
        this.line(bold(`Engineer activity and system focus · last ${this.config.lookbackDays} days`));
        const labels = this.config.engineers.map(engineerLabel);
        const engineerWidth = Math.max(25, Math.min(Math.max(8, ...labels.map(label => label.length + 2)), (process.stdout.columns || 100) - 39));
        this.selection[1] = Math.min(this.selection[1], Math.max(0, this.config.engineers.length - 1));
        const engineerRows = Math.max(3, Math.min(8, (process.stdout.rows || 40) - 20, this.config.engineers.length));
        const engineerStart = Math.max(0, Math.min(this.selection[1] - Math.floor(engineerRows / 2), this.config.engineers.length - engineerRows));
        const engineerEnd = Math.min(this.config.engineers.length, engineerStart + engineerRows);
        this.line(dim(`${cell(`Engineer · ${this.config.engineers.length ? `${engineerStart + 1}–${engineerEnd} of ${this.config.engineers.length}` : '0'}`, engineerWidth)}  ${cell('Commits', 8)}  ${cell('PRs', 5)}  ${cell('Merged', 7)}  Reviews`));
        this.config.engineers.slice(engineerStart, engineerEnd).forEach((engineer, visibleIndex) => {
            const index = engineerStart + visibleIndex;
            const id = engineerId(engineer);
            const selected = this.contentFocused && index === this.selection[1];
            const label = `${selected ? '›' : ' '} ${engineerLabel(engineer)}`;
            const x = this.data?.engineers?.find(v => v.login === id);
            if (x?.error)
                this.errorLines(cell(label, engineerWidth), x.error);
            else {
                const row = `${cell(label, engineerWidth)}  ${cell(x?.commits ?? '—', 8)}  ${cell(x?.pullRequests ?? '—', 5)}  ${cell(x?.merged ?? '—', 7)}  ${x?.reviews ?? '—'}`;
                this.line(selected ? bold(cyan(row)) : row);
            }
        });
        if (!this.config.engineers.length)
            this.line(dim('No engineers configured. Press a to add one.'));
        if (this.contentFocused) {
            const selectedEngineer = this.config.engineers[this.selection[1]];
            const selectedSignal = selectedEngineer && this.data?.engineers?.find(value => value.login === engineerId(selectedEngineer));
            if (selectedSignal && !selectedSignal.error)
                this.engineerFocus(selectedEngineer.name || `@${selectedSignal.login}`, selectedSignal, engineerRows, [selectedSignal.login]);
        }
        else if (this.config.engineers.length && this.data?.engineers) {
            const configuredLogins = new Set(this.config.engineers.map(engineer => engineerId(engineer).toLowerCase()));
            const teamSignals = this.data.engineers.filter(signal => configuredLogins.has(signal.login?.toLowerCase()));
            this.engineerFocus('All engineers', aggregateEngineerFocus(teamSignals), engineerRows, [...configuredLogins], true);
        }
    }
    engineerFocus(label, signal, engineerRows, historyLogins, team = false) {
        this.line();
        const scored = (signal.repositories || []).map(repository => ({ ...repository, score: focusScore(repository) }))
            .filter(repository => repository.score > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
        this.line(bold(`System focus · ${label}`));
        if (!scored.length) {
            this.line(dim('No repository-level focus data cached yet. Press r to refresh.'));
            return;
        }
        const total = scored.reduce((sum, repository) => sum + repository.score, 0);
        const priorities = new Map(this.config.repositories.map(repository => [repositoryName(repository), repository.priority]));
        const owned = scored.filter(repository => priorities.get(repository.name) === 'owned').reduce((sum, repository) => sum + repository.score, 0);
        const primaryShare = Math.round(scored[0].score / total * 100);
        const ownedShare = Math.round(owned / total * 100);
        const concentration = primaryShare >= 75 ? 'high focus' : primaryShare >= 50 ? 'moderate focus' : scored.length >= 6 && primaryShare < 30 ? 'broadly distributed' : 'shared focus';
        const historyBySnapshot = new Map();
        const includedLogins = new Set(historyLogins.map(login => login.toLowerCase()));
        this.focusHistory.filter(row => includedLogins.has(row.login.toLowerCase())).forEach(row => {
            if (!historyBySnapshot.has(row.captured_at))
                historyBySnapshot.set(row.captured_at, new Map());
            const repositories = historyBySnapshot.get(row.captured_at);
            repositories.set(row.repository, (repositories.get(row.repository) || 0) + focusScore({ commits: row.commits, pullRequests: row.pull_requests, merged: row.merged, reviews: row.reviews }));
        });
        const concentrationTrend = [...historyBySnapshot.values()].map(repositories => {
            const scores = [...repositories.values()];
            return scores.length ? Math.round(Math.max(...scores) / scores.reduce((sum, score) => sum + score, 0) * 100) : 0;
        });
        this.line(`${cyan(String(scored.length))} active systems · ${cyan(`${ownedShare}%`)} owned · primary ${cyan(`${primaryShare}%`)} · ${yellow(concentration)}${concentrationTrend.length ? ` · ${cyan(sparkline(concentrationTrend))} ${dim('primary share')}` : ''}`);
        const terminalWidth = process.stdout.columns || 100;
        const daysWidth = team ? 8 : 5;
        const nameWidth = Math.max(20, terminalWidth - 53 - daysWidth);
        this.line(dim(`${cell('Repository', nameWidth)} ${cell('Focus', 19)} ${cell(team ? 'Eng days' : 'Days', daysWidth)} ${cell('Commits', 7)} ${cell('PRs', 4)} ${cell('Merged', 7)} Reviews`));
        const repositoryRows = Math.max(2, Math.min(6, (process.stdout.rows || 40) - engineerRows - 17));
        scored.slice(0, repositoryRows).forEach(repository => {
            const share = Math.round(repository.score / total * 100);
            const bar = `${'█'.repeat(Math.round(share / 10))}${'░'.repeat(10 - Math.round(share / 10))}`;
            const shortName = repository.name.split('/').pop();
            this.line(`${cell(shortName, nameWidth)} ${cell(`${bar} ${share}%`, 19)} ${cell(repository.activeDays || '—', daysWidth)} ${cell(repository.commits, 7)} ${cell(repository.pullRequests, 4)} ${cell(repository.merged, 7)} ${repository.reviews}`);
        });
        if (scored.length > repositoryRows)
            this.line(dim(`${scored.length - repositoryRows} more systems not shown`));
        this.line(dim('Focus weights: commit 1 · PR 3 · merge 2 · review 2. This represents work distribution, not hours.'));
    }
    historyView() {
        const snapshots = this.history;
        this.historySelection = Math.min(this.historySelection, Math.max(0, snapshots.length - 1));
        const selectedIndex = this.historySelection;
        const selected = snapshots[selectedIndex];
        const previousSnapshot = snapshots[selectedIndex - 1];
        this.line(bold(`History · ${snapshots.length} matching snapshots`));
        this.line(dim(`Rolling ${this.config.lookbackDays}-day signals · oldest ${new Date(snapshots[0].captured_at).toLocaleDateString()} · newest ${new Date(snapshots.at(-1).captured_at).toLocaleString()}`));
        this.line(`${this.contentFocused ? cyan('●') : dim('○')} ${bold(new Date(selected.captured_at).toLocaleString())}  ${dim(`snapshot ${selectedIndex + 1} of ${snapshots.length}`)}`);
        this.line();
        const metric = (label, key, lowerIsBetter = false) => {
            const values = snapshots.map(item => item[key]);
            const current = selected[key];
            const previous = previousSnapshot?.[key];
            const timeline = sparkline(values);
            this.line(`${cell(label, 18)} ${cyan(timeline.padEnd(30))}  ${String(current).padStart(4)} ${trend(current, previous, lowerIsBetter)}`);
        };
        this.line(bold('Team activity'));
        metric('Commits', 'commits');
        metric('Pull requests', 'pull_requests');
        metric('Merged', 'merged');
        metric('Reviews', 'reviews');
        this.line();
        this.line(bold('Repository attention'));
        metric('Stale PRs', 'stale_prs', true);
        metric('Waiting reviews', 'waiting_reviews', true);
        metric('Stale issues', 'stale_issues', true);
        metric('CI failures', 'ci_failures', true);
        this.line();
        if (this.config.ciEnabled) {
            const ciTimeline = snapshots.map(snapshot => this.ciMetricsAt(snapshot.captured_at));
            const selectedCi = ciTimeline[selectedIndex];
            const previousCi = ciTimeline[selectedIndex - 1];
            const ciMetric = (label, key, formatter, lowerIsBetter = false) => {
                const values = ciTimeline.map(item => item[key] ?? 0);
                const current = selectedCi[key];
                const previous = previousCi?.[key];
                const value = current == null ? '—' : formatter(current);
                this.line(`${cell(label, 18)} ${cyan(sparkline(values).padEnd(30))}  ${String(value).padStart(7)} ${current == null ? dim('→') : trend(current, previous, lowerIsBetter)}`);
            };
            this.line(bold(`CI performance · ${this.config.lookbackDays}-day window`));
            ciMetric('Success rate', 'successRate', value => `${value}%`);
            ciMetric('Failed runs', 'failed', String, true);
            ciMetric('p50 duration', 'p50', duration, true);
            ciMetric('p95 duration', 'p95', duration, true);
            ciMetric('Median queue', 'queue', duration, true);
            this.line(dim(`${selectedCi.runs} stored runs across ${selectedCi.workflows} workflows at this snapshot`));
            this.line();
        }
        this.line(bold('Recent snapshots'));
        this.line(dim(`${cell('Captured', 22)} ${cell('Commits', 9)} ${cell('PRs', 6)} ${cell('Reviews', 9)} ${cell('Attention', 10)}`));
        const windowStart = Math.max(0, Math.min(selectedIndex - 3, snapshots.length - 8));
        snapshots.slice(windowStart, windowStart + 8).reverse().forEach(item => {
            const attention = item.stale_prs + item.waiting_reviews + item.stale_issues + item.ci_failures;
            const isSelected = item === selected && this.contentFocused;
            const row = `${cell(`${isSelected ? '› ' : '  '}${new Date(item.captured_at).toLocaleString()}`, 22)} ${cell(item.commits, 9)} ${cell(item.pull_requests, 6)} ${cell(item.reviews, 9)} ${cell(attention, 10)}`;
            this.line(isSelected ? bold(selectedRow(row)) : row);
        });
    }
    ciWorkflowGroups() {
        const groups = new Map();
        for (const run of this.ciRuns.filter(run => !run.error)) {
            const key = `${run.repository}:${run.workflowId || run.workflow}`;
            if (!groups.has(key))
                groups.set(key, { key, repository: run.repository, workflow: run.workflow, runs: [] });
            groups.get(key).runs.push(run);
        }
        return [...groups.values()].map(group => {
            group.runs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            const completed = group.runs.filter(run => run.conclusion);
            const durations = completed.map(run => run.durationMs).filter(value => value != null);
            const queues = completed.map(run => run.queueMs).filter(value => value != null);
            const successes = completed.filter(run => run.conclusion === 'success').length;
            const failures = completed.filter(run => ['failure', 'timed_out', 'action_required'].includes(run.conclusion)).length;
            return {
                ...group,
                completed: completed.length,
                successRate: completed.length ? successes / completed.length : null,
                failures,
                p50: percentile(durations, 0.5),
                p95: percentile(durations, 0.95),
                queue: percentile(queues, 0.5),
                latest: group.runs[0],
            };
        }).sort((a, b) => b.failures - a.failures || (b.latest?.createdAt || '').localeCompare(a.latest?.createdAt || ''));
    }
    ciOverview() {
        const groups = this.ciWorkflowGroups();
        this.ciSelection = Math.min(this.ciSelection, Math.max(0, groups.length - 1));
        this.line(bold('CI workflows'));
        const visibleRows = Math.max(5, (process.stdout.rows || 40) - 12);
        const start = Math.max(0, Math.min(this.ciSelection - Math.floor(visibleRows / 2), groups.length - visibleRows));
        const end = Math.min(groups.length, start + visibleRows);
        this.line(dim(`GitHub Actions · ${this.ciRuns.length} stored runs · workflows ${groups.length ? `${start + 1}–${end} of ${groups.length}` : '0'} · ${this.config.historyRetentionDays}-day retention`));
        if (this.ciErrors.length)
            this.line(yellow(`${this.ciErrors.length} repositories could not return Actions data during the last refresh.`));
        this.line();
        if (!groups.length) {
            this.line(dim('No Actions history yet. Press r to refresh GitHub signals.'));
            return;
        }
        const terminalWidth = process.stdout.columns || 100;
        const fixedWidth = 10 + 8 + 8 + 8 + 8 + 10;
        const nameWidth = Math.max(24, terminalWidth - fixedWidth);
        this.line(dim(`${cell('Workflow', nameWidth)} ${cell('Runs', 6)} ${cell('Success', 8)} ${cell('p50', 7)} ${cell('p95', 7)} ${cell('Queue', 7)} Last`));
        groups.slice(start, end).forEach((group, visibleIndex) => {
            const index = start + visibleIndex;
            const selected = this.contentFocused && index === this.ciSelection;
            const state = group.latest?.status !== 'completed' ? yellow('running') : group.latest?.conclusion === 'success' ? green('passed') : red(group.latest?.conclusion || 'unknown');
            const label = `${selected ? '›' : ' '} ${group.repository} · ${group.workflow}`;
            const row = `${cell(label, nameWidth)} ${cell(group.completed, 6)} ${cell(group.successRate == null ? '—' : `${Math.round(group.successRate * 100)}%`, 8)} ${cell(duration(group.p50), 7)} ${cell(duration(group.p95), 7)} ${cell(duration(group.queue), 7)} ${state}`;
            this.line(selected ? selectedRow(row) : row);
        });
    }
    ciDetailView() {
        if (this.ciView.type === 'workflow')
            return this.ciWorkflowRunsView();
        if (this.ciView.type === 'run')
            return this.ciRunJobsView();
    }
    ciWorkflowRunsView() {
        const { group } = this.ciView;
        const runs = group.runs;
        this.ciView.selection = Math.min(this.ciView.selection, Math.max(0, runs.length - 1));
        const selection = this.ciView.selection;
        const selected = runs[selection];
        this.line(bold(`${group.workflow} · ${group.repository}`));
        this.line(dim(`${group.completed} completed · ${group.successRate == null ? '—' : `${Math.round(group.successRate * 100)}% success`} · p50 ${duration(group.p50)} · p95 ${duration(group.p95)}`));
        this.line();
        const visibleRows = Math.min(10, Math.max(6, runs.length));
        const start = Math.max(0, Math.min(selection - Math.floor(visibleRows / 2), runs.length - visibleRows));
        this.line(dim(`${cell('Run', 38)} ${cell('Branch', 20)} ${cell('Result', 12)} ${cell('Duration', 10)} Queue`));
        runs.slice(start, start + visibleRows).forEach(run => {
            const active = run === selected;
            const result = run.status !== 'completed' ? 'running' : run.conclusion || 'unknown';
            const row = `${cell(`${active ? '›' : ' '} #${run.id} ${run.title}`, 38)} ${cell(run.headBranch || '—', 20)} ${cell(result, 12)} ${cell(duration(run.durationMs), 10)} ${duration(run.queueMs)}`;
            this.line(active ? selectedRow(row) : row);
        });
        for (let index = Math.min(visibleRows, runs.length); index < visibleRows; index++)
            this.line();
        this.line();
        this.line(`${bold(selected.title)}  ${selected.conclusion === 'success' ? green('passed') : selected.status !== 'completed' ? yellow('running') : red(selected.conclusion || 'unknown')}`);
        this.line(`${selected.headBranch || '—'} · ${selected.headSha?.slice(0, 7) || '—'} · ${selected.actor ? `@${selected.actor}` : 'unknown actor'} · ${new Date(selected.createdAt).toLocaleString()}`);
        this.line(`Duration ${cyan(duration(selected.durationMs))} · Queue ${cyan(duration(selected.queueMs))} · Attempt ${selected.attempt} · Event ${selected.event || '—'}`);
    }
    ciRunJobsView() {
        const { run, jobs } = this.ciView;
        this.ciView.selection = Math.min(this.ciView.selection, Math.max(0, jobs.length - 1));
        const selected = jobs[this.ciView.selection];
        this.line(bold(`${run.workflow} · ${run.repository}`));
        this.line(`${run.title} · ${run.conclusion === 'success' ? green('passed') : run.status !== 'completed' ? yellow('running') : red(run.conclusion || 'unknown')} · ${duration(run.durationMs)}`);
        this.line();
        if (!jobs.length) {
            this.line(dim('No jobs returned for this workflow run.'));
            return;
        }
        const visibleRows = Math.max(4, Math.min(12, (process.stdout.rows || 40) - 18));
        const start = Math.max(0, Math.min(this.ciView.selection - Math.floor(visibleRows / 2), jobs.length - visibleRows));
        const end = Math.min(jobs.length, start + visibleRows);
        this.line(dim(`${cell(`Job · ${start + 1}–${end} of ${jobs.length}`, 42)} ${cell('Result', 14)} ${cell('Duration', 10)} Runner`));
        jobs.slice(start, end).forEach((job, visibleIndex) => {
            const index = start + visibleIndex;
            const active = index === this.ciView.selection;
            const row = `${cell(`${active ? '›' : ' '} ${job.name}`, 42)} ${cell(job.conclusion || job.status || '—', 14)} ${cell(duration(job.durationMs), 10)} ${job.runnerName || '—'}`;
            this.line(active ? selectedRow(row) : row);
        });
        this.line();
        const stepRows = Math.max(3, (process.stdout.rows || 40) - visibleRows - 16);
        const visibleSteps = selected.steps.slice(0, stepRows);
        const stepRange = selected.steps.length > visibleSteps.length ? ` · showing ${visibleSteps.length} of ${selected.steps.length}` : '';
        this.line(bold(`Steps · ${selected.name}${stepRange}`));
        visibleSteps.forEach(step => {
            const result = step.conclusion === 'success' ? green('passed') : step.conclusion ? red(step.conclusion) : dim(step.status || '—');
            this.line(`${cell(step.name, 52)} ${cell(duration(step.durationMs), 10)} ${result}`);
        });
    }
    repositories() {
        this.line(`${bold('Repository health')}  ${this.showRenovatePullRequests ? dim('Renovate included') : yellow('Renovate hidden')}`);
        const terminalWidth = process.stdout.columns || 100;
        const metrics = [
            ['Open PRs', 8, 'openPrs'],
            ['Stale PRs', 9, 'stalePrs'],
            ['Waiting', 7, 'waitingReviews'],
            ['Issues', 6, 'openIssues'],
            ['Stale', 5, 'staleIssues'],
            ['CI bad', 6, 'failedRuns'],
        ];
        const metricsWidth = metrics.reduce((sum, [, width]) => sum + width + 2, 0);
        const sortedRepositories = this.sortedRepositories();
        this.selection[2] = Math.min(this.selection[2], Math.max(0, sortedRepositories.length - 1));
        const longestName = Math.max(10, ...sortedRepositories.map(repo => repositoryName(repo).length + 4));
        const nameWidth = Math.max(18, Math.min(longestName, terminalWidth - metricsWidth));
        const row = (name, values, isSelected = false) => {
            const cells = [cell(name, nameWidth), ...metrics.map(([, width, key]) => cell(values[key], width))];
            if (!isSelected)
                return cells.join('  ');
            return cells.map((value, index) => index === this.repositoryMetric ? bold(selectedCell(value)) : selectedRow(value)).join(selectedRow('  '));
        };
        const headers = ['Repository', ...metrics.map(([header]) => header)];
        const headerCells = [cell(headers[0], nameWidth), ...metrics.map(([header, width]) => cell(header, width))];
        if (this.contentFocused)
            headerCells[this.repositoryMetric] = bold(cyan(headerCells[this.repositoryMetric]));
        this.line(dim(headerCells.join('  ')));
        sortedRepositories.forEach((repository, index) => {
            const name = repositoryName(repository);
            const selected = this.contentFocused && index === this.selection[2];
            const displayName = `${selected ? '›' : ' '} ${repository.priority === 'owned' ? '★' : '·'} ${name}`;
            const x = this.data?.repositories?.find(v => v.name === name);
            if (x?.error)
                this.errorLines(cell(displayName, nameWidth), x.error);
            else {
                this.line(row(displayName, {
                    openPrs: this.showRenovatePullRequests ? (x?.openPrs ?? '—') : (x?.openPrsWithoutRenovate ?? '—'),
                    stalePrs: this.showRenovatePullRequests ? (x?.stalePrs ?? '—') : (x?.stalePrsWithoutRenovate ?? '—'),
                    waitingReviews: this.showRenovatePullRequests ? (x?.waitingReviews ?? '—') : (x?.waitingReviewsWithoutRenovate ?? '—'),
                    openIssues: x?.openIssues ?? '—',
                    staleIssues: x?.staleIssues ?? '—',
                    failedRuns: x?.failedRuns ?? '—',
                }, selected));
            }
        });
        if (!this.config.repositories.length)
            this.line(dim('No repositories configured. Press a to add owner/repo.'));
        else if (!sortedRepositories.length)
            this.line(dim('No owned repositories. Enable contributing repositories in Settings to show them.'));
        const hidden = this.config.repositories.length - sortedRepositories.length;
        if (hidden)
            this.line(dim(`${hidden} contributing repositories hidden · enable them in Settings`));
    }
    pullRequestsView() {
        const { repository, totalCount, rateLimit } = this.prView;
        const pullRequests = this.prView.pullRequests.filter(pr => this.showRenovatePullRequests || !isRenovateAuthor(pr.author?.login));
        this.prView.selection = Math.min(this.prView.selection, Math.max(0, pullRequests.length - 1));
        const selection = this.prView.selection;
        this.line(bold(`Open pull requests · ${repository}`));
        if (!pullRequests.length) {
            this.line(green(this.showRenovatePullRequests ? 'No open pull requests.' : 'No non-Renovate pull requests.'));
            return;
        }
        const pr = pullRequests[selection];
        const terminalWidth = process.stdout.columns || 100;
        const listWidth = Math.max(28, terminalWidth - 4);
        const visibleRows = Math.min(8, Math.max(6, pullRequests.length));
        const listStart = Math.max(0, Math.min(selection - Math.floor(visibleRows / 2), pullRequests.length - visibleRows));
        const visiblePullRequests = pullRequests.slice(listStart, listStart + visibleRows);
        const hiddenRenovate = this.prView.pullRequests.length - pullRequests.length;
        this.line(dim(`${totalCount} open · showing ${pullRequests.length}${hiddenRenovate ? ` · ${hiddenRenovate} Renovate hidden` : ''}${totalCount > this.prView.pullRequests.length ? ' · most recently updated' : ''}${rateLimit ? ` · API ${rateLimit.remaining} remaining` : ''}`));
        this.line();
        const range = `${listStart + 1}–${Math.min(listStart + visibleRows, pullRequests.length)} of ${pullRequests.length}`;
        this.line(dim(`┌─ Pull requests · ${range} ${'─'.repeat(Math.max(0, listWidth - range.length - 19))}┐`));
        visiblePullRequests.forEach(item => {
            const active = item === pr;
            const flags = `${item.isDraft ? 'draft · ' : ''}${item.reviewDecision ? item.reviewDecision.toLowerCase().replaceAll('_', ' ') : 'review pending'}`;
            const prefix = `${active ? '›' : ' '} #${item.number} `;
            const flagWidth = Math.min(24, flags.length);
            const titleWidth = Math.max(8, listWidth - prefix.length - flagWidth - 2);
            const row = `${prefix}${cell(item.title, titleWidth)}  ${fit(flags, flagWidth).padEnd(flagWidth)}`;
            const content = active ? selectedRow(cell(row, listWidth)) : cell(row, listWidth);
            this.line(`${dim('│')} ${content} ${dim('│')}`);
        });
        for (let index = visiblePullRequests.length; index < visibleRows; index++)
            this.line(`${dim('│')} ${' '.repeat(listWidth)} ${dim('│')}`);
        this.line(dim(`└${'─'.repeat(listWidth + 2)}┘`));
        this.line();
        this.line(bold(`#${pr.number} ${pr.title}`));
        this.line(`${cyan(`@${pr.author?.login || 'unknown'}`)} opened ${new Date(pr.createdAt).toLocaleString()} · updated ${new Date(pr.updatedAt).toLocaleString()}`);
        this.line(`${pr.isDraft ? yellow('Draft') : green('Ready')} · ${pr.mergeable?.toLowerCase() || 'merge status unknown'} · ${pr.reviewDecision?.toLowerCase().replaceAll('_', ' ') || 'no review decision'}`);
        this.line();
        this.line(bold('Key metrics'));
        const metrics = [
            ['Age', elapsed(pr.createdAt)],
            ['In review', pr.isDraft ? 'not yet' : elapsed(pr.createdAt)],
            ['Commits', pr.commitCount],
            ['Change', `+${pr.additions} / -${pr.deletions}`],
            ['Files', pr.changedFiles],
            ['Reviews', pr.reviews.length],
            ['Comments', pr.commentCount],
        ];
        const metricCells = metrics.map(([label, value]) => `${dim(label)} ${cyan(String(value))}`);
        let metricRow = '';
        metricCells.forEach(metricCell => {
            const next = `${metricRow ? `${dim('  │  ')}` : ''}${metricCell}`;
            if (metricRow && strip(metricRow + next).length > terminalWidth - 2) {
                this.line(metricRow);
                metricRow = metricCell;
            }
            else
                metricRow += next;
        });
        if (metricRow)
            this.line(metricRow);
        const ciRuns = this.config.ciEnabled ? this.ciRuns.filter(run => run.repository === repository && run.headSha === pr.headRefOid) : [];
        if (this.config.ciEnabled && ciRuns.length) {
            const passed = ciRuns.filter(run => run.conclusion === 'success').length;
            const failed = ciRuns.filter(run => ['failure', 'timed_out', 'action_required'].includes(run.conclusion)).length;
            const running = ciRuns.filter(run => run.status !== 'completed').length;
            const totalDuration = ciRuns.reduce((sum, run) => sum + (run.durationMs || 0), 0);
            this.line(`CI: ${green(`${passed} passed`)} · ${failed ? red(`${failed} failed`) : dim('0 failed')} · ${running ? yellow(`${running} running`) : dim('0 running')} · ${cyan(duration(totalDuration))} total`);
        }
        else if (this.config.ciEnabled)
            this.line(dim('CI: no stored workflow runs matched this PR commit'));
        if (pr.labels.length)
            this.line(`Labels: ${pr.labels.map(label => cyan(label)).join(', ')}`);
        if (pr.assignees.length)
            this.line(`Assignees: ${pr.assignees.map(login => `@${login}`).join(', ')}`);
        if (pr.requestedReviewers.length)
            this.line(`Review requested: ${pr.requestedReviewers.map(login => `@${login}`).join(', ')}`);
        if (pr.reviews.length)
            this.line(`Latest reviews: ${pr.reviews.map(review => `${review.author?.login ? `@${review.author.login}` : 'unknown'} ${review.state.toLowerCase()}`).join(' · ')}`);
        this.line();
        this.line(bold(`Commits · ${pr.commitCount}`));
        pr.commits.slice(-8).forEach(commit => {
            const authors = [...new Set(commit.authors.nodes.map(author => author.user?.login ? `@${author.user.login}` : author.name).filter(Boolean))].join(', ');
            this.line(`${dim(commit.oid.slice(0, 7))} ${fit(commit.messageHeadline, Math.max(20, terminalWidth - authors.length - 14))}  ${cyan(authors || 'unknown')}`);
        });
        if (pr.commitCount > pr.commits.length)
            this.line(dim(`${pr.commitCount - pr.commits.length} earlier commits not loaded`));
    }
    sortedRepositories() {
        return [...visibleRepositories(this.config)].sort((a, b) => {
            if (a.priority !== b.priority)
                return a.priority === 'owned' ? -1 : 1;
            return repositoryName(a).localeCompare(repositoryName(b));
        });
    }
    selectableItems() {
        if (this.currentView() === 'Engineers')
            return this.config.engineers;
        if (this.currentView() === 'Repositories')
            return this.sortedRepositories();
        return [];
    }
    moveSelection(delta) {
        const items = this.selectableItems();
        if (!items.length)
            return;
        this.selection[this.tab] = (this.selection[this.tab] + delta + items.length) % items.length;
    }
    moveCiSelection(delta) {
        if (!this.ciView) {
            const groups = this.ciWorkflowGroups();
            if (groups.length)
                this.ciSelection = Math.max(0, Math.min(groups.length - 1, this.ciSelection + delta));
        }
        else {
            const items = this.ciView.type === 'workflow' ? this.ciView.group.runs : this.ciView.jobs;
            if (items.length)
                this.ciView.selection = Math.max(0, Math.min(items.length - 1, this.ciView.selection + delta));
        }
    }
    async openCiSelected() {
        if (!this.ciView) {
            const group = this.ciWorkflowGroups()[this.ciSelection];
            if (group)
                this.ciView = { type: 'workflow', group, selection: 0 };
            return this.render();
        }
        if (this.ciView.type === 'workflow') {
            const group = this.ciView.group;
            const run = group.runs[this.ciView.selection];
            if (!run)
                return;
            this.message = cyan(`Loading jobs for ${run.workflow}…`);
            this.render();
            const jobs = await fetchWorkflowRunJobs(run.repository, run.id, this.config.hostname);
            this.ciView = { type: 'run', group, run, jobs, selection: 0 };
            this.message = '';
            return this.render();
        }
        const job = this.ciView.jobs[this.ciView.selection];
        await openGitHubUrl(job?.url || this.ciView.run.url);
        this.message = green(`Opened ${job?.name || this.ciView.run.workflow}.`);
        this.render();
    }
    async openCurrentOnWeb() {
        if (this.prView) {
            const visiblePullRequests = this.prView.pullRequests.filter(pr => this.showRenovatePullRequests || !isRenovateAuthor(pr.author?.login));
            const pullRequest = visiblePullRequests[this.prView.selection];
            if (!pullRequest)
                return;
            await openGitHubUrl(pullRequest.url);
            this.message = green(`Opened ${this.prView.repository}#${pullRequest.number}.`);
            return this.render();
        }
        if (this.currentView() !== 'CI')
            return;
        const group = this.ciView?.group || this.ciWorkflowGroups()[this.ciSelection];
        if (!group)
            return;
        if (!this.ciView && !group.latest?.workflowPath && group.latest?.workflowId) {
            this.message = cyan(`Resolving ${group.workflow} workflow file…`);
            this.render();
            const workflowPath = await fetchWorkflowPath(group.repository, group.latest.workflowId, this.config.hostname);
            if (workflowPath)
                group.runs.filter(item => item.workflowId === group.latest.workflowId).forEach(item => { item.workflowPath = workflowPath; });
        }
        const run = this.ciView?.type === 'workflow' ? group.runs[this.ciView.selection] : this.ciView?.type === 'run' ? this.ciView.run : undefined;
        const job = this.ciView?.type === 'run' ? this.ciView.jobs[this.ciView.selection] : undefined;
        await openGitHubUrl(ciContextWebUrl(this.config.hostname, group, run, job));
        this.message = green(`Opened ${job?.name || run?.title || group.workflow}.`);
        this.render();
    }
    async openSelected() {
        const items = this.selectableItems();
        if (!items.length)
            return;
        const selected = items[Math.min(this.selection[this.tab], items.length - 1)];
        if (this.currentView() === 'Engineers') {
            await openEngineer(engineerId(selected), this.config.hostname);
            this.message = green(`Opened @${engineerId(selected)}.`);
        }
        else if (this.currentView() === 'Repositories') {
            const metric = ['repository', 'openPrs', 'stalePrs', 'waitingReviews', 'openIssues', 'staleIssues', 'failedRuns'][this.repositoryMetric];
            if (metric === 'openPrs') {
                this.message = cyan(`Loading open pull requests for ${repositoryName(selected)}…`);
                this.render();
                const result = await fetchOpenPullRequests(repositoryName(selected), this.config.hostname);
                this.prView = { repository: repositoryName(selected), ...result, selection: 0 };
                this.message = '';
                return this.render();
            }
            await openRepositoryMetric(repositoryName(selected), this.config.hostname, metric, this.config.thresholds);
            this.message = green(`Opened ${repositoryName(selected)} · ${metric}.`);
        }
        this.render();
    }
    settings() {
        const t = this.config.thresholds;
        const rows = [
            ['GitHub hostname', cyan(this.config.hostname)],
            ['Theme', cyan(themeNames[this.config.theme] || 'Default')],
            ['Activity lookback', `${cyan(this.config.lookbackDays)} days`],
            ['Contributing repos', this.config.showContributingRepositories ? green('shown') : dim('hidden (owned only)')],
            ['CI visibility', this.config.ciEnabled ? green('enabled') : dim('disabled')],
            ['GitHub status', this.config.githubStatusEnabled ? green('enabled') : dim('disabled')],
            ['Stale pull request', `${cyan(t.stalePrDays)} days without an update`],
            ['Review wait', `${cyan(t.reviewWaitHours)} hours`],
            ['Stale issue', `${cyan(t.staleIssueDays)} days without an update`],
            ['Recent CI failures', `last ${cyan(t.workflowFailureCount)} failed runs`],
            ['History retention', `${cyan(this.config.historyRetentionDays)} days`],
        ];
        this.line(bold('Configuration'));
        rows.forEach(([label, value], index) => {
            const active = this.contentFocused && index === this.settingsSelection;
            const marker = active ? '› ' : '  ';
            const rendered = `${marker}${cell(label, 20)}  ${value}${active && index === 1 && this.themeEditing ? dim('  ◀ live preview ▶') : ''}`;
            this.line(active ? selectedRow(rendered) : rendered);
        });
        this.line();
        this.line(dim(`Enter Settings to make adjustments. Data stays local in ${CONFIG_FILE} and ${CACHE_FILE}.`));
        this.line(dim('Press y to copy the complete portable setup. Cache and history are excluded.'));
    }
    async copySettings() {
        await copyToClipboard(serializeConfig(this.config));
        this.message = green('Setup copied to clipboard · cache and history excluded.');
        this.render();
    }
    async editSelectedSetting() {
        const t = this.config.thresholds;
        if (this.settingsSelection === 1) {
            this.themeEditing = !this.themeEditing;
            if (!this.themeEditing) {
                await saveConfig(this.config);
                this.message = green('Theme saved.');
            }
            return this.render();
        }
        if (this.settingsSelection === 3) {
            this.config.showContributingRepositories = !this.config.showContributingRepositories;
            await saveConfig(this.config);
            this.message = green(`Contributing repositories ${this.config.showContributingRepositories ? 'shown' : 'hidden'}.`);
            return this.render();
        }
        if (this.settingsSelection === 4) {
            this.config.ciEnabled = !this.config.ciEnabled;
            await saveConfig(this.config);
            this.ciRuns = this.config.ciEnabled ? loadCiRuns(this.config) : [];
            this.ciErrors = [];
            this.ciView = null;
            this.message = green(`CI visibility ${this.config.ciEnabled ? 'enabled' : 'disabled'}.`);
            return this.render();
        }
        if (this.settingsSelection === 5) {
            this.config.githubStatusEnabled = !this.config.githubStatusEnabled;
            await saveConfig(this.config);
            if (this.config.githubStatusEnabled)
                this.startGitHubStatusPolling();
            else {
                if (this.statusTimer)
                    clearInterval(this.statusTimer);
                this.statusTimer = null;
                this.githubStatus = null;
            }
            this.message = green(`GitHub status ${this.config.githubStatusEnabled ? 'enabled' : 'disabled'}.`);
            return this.render();
        }
        const fields = [
            ['GitHub hostname', this.config.hostname, value => { this.config.hostname = value; }],
            null,
            ['Activity lookback (days)', this.config.lookbackDays, value => { this.config.lookbackDays = Number(value) || 14; }],
            null,
            null,
            null,
            ['Stale PR threshold (days)', t.stalePrDays, value => { t.stalePrDays = Number(value) || 3; }],
            ['Review wait threshold (hours)', t.reviewWaitHours, value => { t.reviewWaitHours = Number(value) || 24; }],
            ['Stale issue threshold (days)', t.staleIssueDays, value => { t.staleIssueDays = Number(value) || 14; }],
            ['Recent CI failure count', t.workflowFailureCount, value => { t.workflowFailureCount = Number(value) || 1; }],
            ['History retention (days)', this.config.historyRetentionDays, value => { this.config.historyRetentionDays = Number(value) || 90; }],
        ];
        const [question, current, apply] = fields[this.settingsSelection];
        apply(await this.prompt(question, String(current)));
        await saveConfig(this.config);
        if (this.settingsSelection === 0)
            this.auth = await authStatus(this.config.hostname);
        this.message = green('Setting saved.');
        this.render();
    }
    async cycleTheme(delta) {
        const names = Object.keys(themes);
        const current = Math.max(0, names.indexOf(this.config.theme));
        this.config.theme = names[(current + delta + names.length) % names.length];
        setTheme(this.config.theme);
        await saveConfig(this.config);
        this.message = `${themeNames[this.config.theme]} · live preview`;
        this.render();
    }
    async prompt(question, initial = '') {
        this.prompting = true;
        process.stdout.write(`${A}?25h\n${question}${initial ? ` [${initial}]` : ''}: `);
        const answer = await new Promise(resolve => { this.promptState = { buffer: '', initial, resolve }; });
        this.prompting = false;
        return answer.trim() || initial;
    }
    promptInput(chunk) {
        const state = this.promptState;
        if (!state)
            return;
        for (const char of chunk.toString()) {
            if (char === '\r' || char === '\n') {
                this.promptState = null;
                process.stdout.write('\n');
                state.resolve(state.buffer);
                return;
            }
            if (char === '\u0003')
                return this.quit();
            if (char === '\u001b') {
                this.promptState = null;
                process.stdout.write(`${dim('(cancelled)')}\n`);
                state.resolve(state.initial);
                return;
            }
            if (char === '\u007f' || char === '\b') {
                if (state.buffer) {
                    state.buffer = state.buffer.slice(0, -1);
                    process.stdout.write('\b \b');
                }
            }
            else if (char >= ' ' && char !== '\u007f') {
                state.buffer += char;
                process.stdout.write(char);
            }
        }
    }
    async add() {
        const type = await this.prompt('Add (e)ngineer or (r)epository', this.currentView() === 'Repositories' ? 'r' : 'e');
        if (type.toLowerCase().startsWith('r')) {
            const name = await this.prompt('Repository (owner/name)');
            const priorityInput = await this.prompt('Priority: (o)wned or (c)ontributing', 'c');
            const priority = priorityInput.toLowerCase().startsWith('o') ? 'owned' : 'contributing';
            if (/^[^/\s]+\/[^/\s]+$/.test(name) && !this.config.repositories.some(repo => repositoryName(repo) === name))
                this.config.repositories.push({ name, priority });
            else if (name)
                this.message = red('Use owner/repository format, or remove the duplicate.');
        }
        else {
            const id = (await this.prompt('GitHub login (without @)')).replace(/^@/, '');
            const name = await this.prompt('Actual name', id);
            if (/^[\w-]+$/.test(id) && !this.config.engineers.some(engineer => engineerId(engineer) === id))
                this.config.engineers.push({ id, name });
            else if (id)
                this.message = red('That login is invalid or already configured.');
        }
        await saveConfig(this.config);
        this.render();
    }
    async remove() {
        const repositoryMode = this.currentView() === 'Repositories';
        const source = repositoryMode ? this.config.repositories : this.config.engineers;
        const choices = repositoryMode ? source.map(repositoryName) : source.map(engineerId);
        if (!choices.length) {
            this.message = yellow('Nothing to remove on this screen.');
            return this.render();
        }
        const name = await this.prompt(`Remove (${choices.join(', ')})`);
        const index = choices.indexOf(name.replace(/^@/, ''));
        if (index >= 0) {
            source.splice(index, 1);
            await saveConfig(this.config);
        }
        else
            this.message = yellow('No exact match found.');
        this.render();
    }
    async prioritize() {
        if (this.currentView() !== 'Repositories' || !this.config.repositories.length) {
            this.message = yellow('Open Repositories to change a priority.');
            return this.render();
        }
        const choices = this.config.repositories.map(repositoryName);
        const name = await this.prompt(`Toggle owned/contributing (${choices.join(', ')})`);
        const repository = this.config.repositories.find(repo => repositoryName(repo) === name);
        if (!repository)
            this.message = yellow('No exact repository match found.');
        else {
            repository.priority = repository.priority === 'owned' ? 'contributing' : 'owned';
            await saveConfig(this.config);
            this.message = green(`${name} is now ${repository.priority}.`);
        }
        this.render();
    }
    async edit() {
        if (this.currentView() !== 'Settings')
            return;
        this.config.hostname = await this.prompt('GitHub hostname', this.config.hostname);
        const theme = await this.prompt('Theme (default/tva/cyberpunk/matrix/dracula/nord/solarized-dark/synthwave/blueprint)', this.config.theme);
        const normalizedTheme = theme.toLowerCase().trim().replace(/\s+/g, '-');
        this.config.theme = themes[normalizedTheme] ? normalizedTheme : 'default';
        setTheme(this.config.theme);
        this.config.lookbackDays = Number(await this.prompt('Activity lookback (days)', String(this.config.lookbackDays))) || 14;
        const showContributing = await this.prompt('Show contributing repositories? (y/n)', this.config.showContributingRepositories ? 'y' : 'n');
        this.config.showContributingRepositories = showContributing.toLowerCase().startsWith('y');
        const ciEnabled = await this.prompt('Enable CI visibility? (y/n)', this.config.ciEnabled ? 'y' : 'n');
        this.config.ciEnabled = ciEnabled.toLowerCase().startsWith('y');
        this.config.thresholds.stalePrDays = Number(await this.prompt('Stale PR threshold (days)', String(this.config.thresholds.stalePrDays))) || 3;
        this.config.thresholds.reviewWaitHours = Number(await this.prompt('Review wait threshold (hours)', String(this.config.thresholds.reviewWaitHours))) || 24;
        this.config.thresholds.staleIssueDays = Number(await this.prompt('Stale issue threshold (days)', String(this.config.thresholds.staleIssueDays))) || 14;
        await saveConfig(this.config);
        this.auth = await authStatus(this.config.hostname);
        this.message = green('Settings saved.');
        this.render();
    }
    async refresh() {
        if (!this.auth.loggedIn) {
            this.message = yellow('Log in first with l.');
            return this.render();
        }
        const cooldownMs = 60_000;
        const remainingMs = cooldownMs - (Date.now() - this.lastRefreshStartedAt);
        if (remainingMs > 0) {
            this.message = yellow(`Please wait ${Math.ceil(remainingMs / 1000)}s before refreshing again.`);
            return this.render();
        }
        this.lastRefreshStartedAt = Date.now();
        const controller = new AbortController();
        this.refreshController = controller;
        this.refreshProgress = { message: 'Starting refresh…', current: 0, total: 1 };
        try {
            const nextData = await fetchSignals(this.config, (message, progress) => {
                this.refreshProgress = { message, current: progress?.current || 0, total: progress?.total || 1 };
                this.render();
            }, { signal: controller.signal });
            this.data = nextData;
            this.ciView = null;
            this.ciErrors = (this.data.ciRuns || []).filter(run => run.error);
            await saveCache(this.data);
            if (this.config.ciEnabled)
                await recordCiRuns(this.config, this.data.ciRuns || []);
            this.ciRuns = this.config.ciEnabled ? loadCiRuns(this.config) : [];
            const recorded = await recordSnapshot(this.config, this.data);
            this.history = loadHistory(this.config);
            this.focusHistory = loadEngineerFocusHistory(this.config);
            this.message = green(recorded ? 'Signals refreshed · snapshot saved.' : 'Signals refreshed · recent snapshot retained.');
        }
        catch (error) {
            this.message = controller.signal.aborted ? yellow('Refresh cancelled. Previous signals retained.') : red(error.message);
        }
        finally {
            this.refreshController = null;
            this.refreshProgress = null;
        }
        this.render();
    }
    async doLogin() {
        this.prompting = true;
        process.stdout.write(`${A}?25h${A}2J${A}H`);
        process.stdin.setRawMode(false);
        try {
            await login(this.config.hostname);
            this.auth = await authStatus(this.config.hostname);
            this.message = green('Authenticated. Press r to refresh.');
        }
        catch (error) {
            this.message = red(error.message);
        }
        finally {
            process.stdin.setRawMode(true);
            process.stdin.resume();
            this.prompting = false;
        }
        this.render();
    }
    async runAction(action) {
        if (this.busy)
            return;
        this.busy = true;
        try {
            await action();
        }
        catch (error) {
            this.message = red(error.message);
            this.render();
        }
        finally {
            this.busy = false;
        }
    }
    async key(chunk) {
        if (this.promptState)
            return this.promptInput(chunk);
        const key = chunk.toString();
        if (key === '\u0003')
            return this.quit();
        if (key === 'c' && this.refreshController) {
            this.refreshController.abort();
            this.message = yellow('Cancelling refresh…');
            if (this.refreshProgress)
                this.refreshProgress.message = 'Cancelling refresh…';
            return this.render();
        }
        if (key === 'q')
            return this.quit();
        if (this.busy && !this.refreshController)
            return;
        if (key === 's')
            return this.runAction(async () => {
                await openGitHubUrl(GITHUB_STATUS_PAGE_URL);
                this.message = green('Opened GitHub Status.');
                this.render();
            });
        if (key === 'w' && (this.prView || this.currentView() === 'CI'))
            return this.runAction(() => this.openCurrentOnWeb());
        if (key === 'y' && this.currentView() === 'Settings' && !this.themeEditing) {
            return this.runAction(() => this.copySettings());
        }
        if (key === '\u001b' && this.prView) {
            this.prView = null;
            this.message = '';
            return this.render();
        }
        if (key === '\u001b' && this.ciView) {
            if (this.ciView.type === 'run')
                this.ciView = { type: 'workflow', group: this.ciView.group, selection: this.ciView.group.runs.indexOf(this.ciView.run) };
            else
                this.ciView = null;
            this.message = '';
            return this.render();
        }
        if (key === '\u001b' && this.contentFocused) {
            if (this.currentView() === 'Settings' && this.themeEditing) {
                this.themeEditing = false;
                this.message = green('Theme saved.');
                return this.render();
            }
            this.contentFocused = false;
            this.message = '';
            return this.render();
        }
        if (key === '\t' && !this.contentFocused)
            this.tab = (this.tab + 1) % this.tabs.length;
        if (key === '\u001b[C') {
            if (this.prView) { /* PR drill-down uses vertical list navigation. */ }
            else if (this.contentFocused && this.currentView() === 'Repositories')
                this.repositoryMetric = Math.min(6, this.repositoryMetric + 1);
            else if (this.contentFocused && this.currentView() === 'Settings' && this.themeEditing)
                return this.runAction(() => this.cycleTheme(1));
            else if (!this.contentFocused)
                this.tab = (this.tab + 1) % this.tabs.length;
        }
        if (key === '\u001b[D') {
            if (this.prView) { /* PR drill-down uses vertical list navigation. */ }
            else if (this.contentFocused && this.currentView() === 'Repositories')
                this.repositoryMetric = Math.max(0, this.repositoryMetric - 1);
            else if (this.contentFocused && this.currentView() === 'Settings' && this.themeEditing)
                return this.runAction(() => this.cycleTheme(-1));
            else if (!this.contentFocused)
                this.tab = (this.tab + this.tabs.length - 1) % this.tabs.length;
        }
        if (key === '\u001b[A' && this.contentFocused && !this.themeEditing) {
            if (this.prView)
                this.prView.selection = Math.max(0, this.prView.selection - 1);
            else if (this.currentView() === 'CI')
                this.moveCiSelection(-1);
            else if (this.currentView() === 'Settings')
                this.settingsSelection = (this.settingsSelection + SETTINGS_COUNT - 1) % SETTINGS_COUNT;
            else if (this.currentView() === 'History')
                this.historySelection = Math.min(this.history.length - 1, this.historySelection + 1);
            else
                this.moveSelection(-1);
        }
        if (key === '\u001b[B' && this.contentFocused && !this.themeEditing) {
            if (this.prView) {
                const visibleCount = this.prView.pullRequests.filter(pr => this.showRenovatePullRequests || !isRenovateAuthor(pr.author?.login)).length;
                this.prView.selection = Math.min(visibleCount - 1, this.prView.selection + 1);
            }
            else if (this.currentView() === 'CI')
                this.moveCiSelection(1);
            else if (this.currentView() === 'Settings')
                this.settingsSelection = (this.settingsSelection + 1) % SETTINGS_COUNT;
            else if (this.currentView() === 'History')
                this.historySelection = Math.max(0, this.historySelection - 1);
            else
                this.moveSelection(1);
        }
        this.message = '';
        if (key === 'v' && (this.prView || this.currentView() === 'Repositories')) {
            this.showRenovatePullRequests = !this.showRenovatePullRequests;
            if (this.prView)
                this.prView.selection = 0;
            return this.render();
        }
        if (this.prView && key !== '\r' && key !== '\n')
            return this.render();
        if (key === 'a')
            return this.runAction(() => this.add());
        if (key === 'd')
            return this.runAction(() => this.remove());
        if (key === 'p')
            return this.runAction(() => this.prioritize());
        if (key === 'r')
            return this.runAction(() => this.refresh());
        if (key === 'l')
            return this.runAction(() => this.doLogin());
        if (key === '\r' || key === '\n') {
            if (this.prView && this.prView.pullRequests.length)
                return this.runAction(async () => {
                    const visiblePullRequests = this.prView.pullRequests.filter(pr => this.showRenovatePullRequests || !isRenovateAuthor(pr.author?.login));
                    const pr = visiblePullRequests[this.prView.selection];
                    if (!pr)
                        return;
                    await openPullRequest(pr.url);
                    this.message = green(`Opened ${this.prView.repository}#${pr.number}.`);
                    this.render();
                });
            if (!this.contentFocused && ((this.currentView() === 'Engineers' || this.currentView() === 'Repositories') ? this.selectableItems().length : (this.currentView() === 'CI' ? this.ciWorkflowGroups().length : (this.currentView() === 'Settings' || (this.currentView() === 'History' && this.history.length))))) {
                this.contentFocused = true;
                return this.render();
            }
            if (this.contentFocused && this.currentView() === 'CI')
                return this.runAction(() => this.openCiSelected());
            if (this.contentFocused && this.currentView() === 'Settings')
                return this.runAction(() => this.editSelectedSetting());
            if (this.contentFocused)
                return this.runAction(() => this.openSelected());
        }
        this.render();
    }
    start() {
        if (!process.stdin.isTTY || !process.stdout.isTTY)
            throw new Error('GitHub Signals needs an interactive terminal.');
        // Use the alternate screen so redraws do not pollute the shell's scrollback.
        process.stdout.write(`${A}?1049h${A}H${A}2J${A}3J`);
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', key => this.key(key));
        process.stdout.on('resize', () => { if (!this.prompting)
            this.render(); });
        process.on('SIGTERM', () => this.quit());
        this.render();
        if (this.config.githubStatusEnabled)
            this.startGitHubStatusPolling();
    }
    startGitHubStatusPolling() {
        if (this.statusTimer)
            clearInterval(this.statusTimer);
        this.updateGitHubStatus();
        this.statusTimer = setInterval(() => this.updateGitHubStatus(), 60000);
        this.statusTimer.unref();
    }
    async updateGitHubStatus() {
        try {
            this.githubStatus = await fetchGitHubStatus();
        }
        catch {
            this.githubStatus = { indicator: 'unavailable', description: 'Unavailable', checkedAt: new Date().toISOString() };
        }
        if (!this.stopped && !this.prompting)
            this.render();
    }
    quit() {
        this.stopped = true;
        if (this.statusTimer)
            clearInterval(this.statusTimer);
        this.refreshController?.abort();
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write(`${A}?25h${A}?1049l`);
        process.exit(0);
    }
}
try {
    const config = await loadConfig();
    const [cache, auth] = await Promise.all([loadCache(), authStatus(config.hostname)]);
    const history = loadHistory(config);
    const focusHistory = loadEngineerFocusHistory(config);
    const ciRuns = config.ciEnabled ? loadCiRuns(config) : [];
    new App(config, cache, auth, history, ciRuns, focusHistory).start();
}
catch (error) {
    process.stdout.write(`${A}?25h`);
    console.error(`github-signals: ${error.message}`);
    process.exitCode = 1;
}
//# sourceMappingURL=cli.js.map