#!/usr/bin/env node
// @ts-nocheck -- Incremental migration boundary for the stateful terminal UI.
import { authStatus, fetchSignals, login, openEngineer, openRepositoryMetric } from './github.js';
import { CACHE_FILE, CONFIG_FILE, engineerId, loadCache, loadConfig, repositoryName, saveCache, saveConfig, visibleRepositories } from './config.js';
import { HISTORY_FILE, loadHistory, recordSnapshot } from './history.js';
import { sanitizeTerminal } from './terminal.js';

const A = '\x1b[';
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
const sparkline = values => {
  const bars = '▁▂▃▄▅▆▇█';
  if (!values.length) return dim('no history');
  const min = Math.min(...values), max = Math.max(...values);
  return values.map(value => bars[max === min ? 3 : Math.round((value - min) / (max - min) * 7)]).join('');
};
const trend = (current, previous, lowerIsBetter = false) => {
  if (previous == null || current === previous) return dim('→');
  const improved = lowerIsBetter ? current < previous : current > previous;
  return improved ? green(current > previous ? '↑' : '↓') : red(current > previous ? '↑' : '↓');
};

class App {
  constructor(config, cache, auth, history = []) {
    this.config = config;
    this.data = cache;
    this.auth = auth;
    this.history = history;
    this.tab = 0;
    this.message = '';
    this.busy = false;
    this.prompting = false;
    this.refreshController = null;
    this.lastRefreshStartedAt = 0;
    this.selection = { 1: 0, 2: 0 };
    this.repositoryMetric = 0;
    this.contentFocused = false;
    this.settingsSelection = 0;
    this.themeEditing = false;
    this.promptState = null;
    setTheme(config.theme);
    this.tabs = this.history.length ? ['Overview', 'Engineers', 'Repositories', 'History', 'Settings'] : ['Overview', 'Engineers', 'Repositories', 'Settings'];
  }

  currentView() { return this.tabs[this.tab]; }

  syncTabs() {
    const current = this.currentView();
    this.tabs = this.history.length ? ['Overview', 'Engineers', 'Repositories', 'History', 'Settings'] : ['Overview', 'Engineers', 'Repositories', 'Settings'];
    this.tab = Math.max(0, this.tabs.indexOf(current));
  }

  line(text = '') { process.stdout.write(`${fit(sanitizeTerminal(text), process.stdout.columns || 100)}${A}K\n`); }
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
      } else line += `${strip(line).endsWith(' ') ? '' : ' '}${word}`;
    }
    if (strip(line).trim()) this.line(line);
  }
  badge(n, bad = false) { return n ? (bad ? red(String(n)) : cyan(String(n))) : dim('0'); }

  render() {
    this.syncTabs();
    if (!this.prompting && process.stdin.isTTY && !process.stdin.isRaw) process.stdin.setRawMode(true);
    const width = Math.max(60, process.stdout.columns || 100);
    process.stdout.write(`${A}?25l${A}H${A}2J`);
    this.line(`${bold(cyan('◈ GitHub Signals'))}  ${this.auth.loggedIn ? green('● gh authenticated') : yellow('○ login required')}  ${dim(this.config.hostname)}`);
    this.line(dim('─'.repeat(width)));
    this.line(this.tabs.map((t, i) => i === this.tab ? bold(`[ ${t} ]`) : dim(`  ${t}  `)).join(' '));
    this.line();
    if (this.currentView() === 'Overview') this.overview();
    if (this.currentView() === 'Engineers') this.engineers();
    if (this.currentView() === 'Repositories') this.repositories();
    if (this.currentView() === 'History') this.historyView();
    if (this.currentView() === 'Settings') this.settings();
    this.line();
    this.line(dim('─'.repeat(width)));
    const navigation = this.contentFocused
      ? (this.currentView() === 'Repositories' ? '↑/↓ repo  ←/→ metric  Enter open  Esc nav'
        : this.currentView() === 'Settings' ? (this.themeEditing ? '←/→ preview theme  Enter apply  Esc setting' : '↑/↓ setting  Enter edit  Esc nav')
          : '↑/↓ engineer  Enter open  Esc nav')
      : '←/→ views  Enter select';
    this.line(this.message || dim(`${navigation}  r refresh  a add  d delete  p priority  l login  q quit`));
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
    if (!this.data) { this.line(dim('Press r to fetch GitHub data.')); return; }
    const e = this.data.engineers || [];
    const visibleNames = new Set(visibleRepositories(this.config).map(repositoryName));
    const repos = (this.data.repositories || []).filter(repo => visibleNames.has(repo.name));
    const totals = e.reduce((a, x) => ({ commits: a.commits + (x.commits || 0), prs: a.prs + (x.pullRequests || 0), merged: a.merged + (x.merged || 0), reviews: a.reviews + (x.reviews || 0) }), { commits: 0, prs: 0, merged: 0, reviews: 0 });
    const repoTotals = repos.reduce((a, x) => ({ open: a.open + (x.openPrs || 0), stale: a.stale + (x.stalePrs || 0), waiting: a.waiting + (x.waitingReviews || 0), issues: a.issues + (x.staleIssues || 0), ci: a.ci + (x.failedRuns || 0) }), { open: 0, stale: 0, waiting: 0, issues: 0, ci: 0 });
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
      if (width < 96) { left.forEach(line => this.line(line)); this.line(); right.forEach(line => this.line(line)); }
      else left.forEach((line, index) => this.line(`${line}${' '.repeat(gap)}${right[index]}`));
    };
    drawPanels(activityPanel, healthPanel);
    this.line();
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
    this.line(bold(`Engineer activity · last ${this.config.lookbackDays} days`));
    const labels = this.config.engineers.map(engineerLabel);
    const engineerWidth = Math.max(25, Math.min(Math.max(8, ...labels.map(label => label.length + 2)), (process.stdout.columns || 100) - 39));
    this.selection[1] = Math.min(this.selection[1], Math.max(0, this.config.engineers.length - 1));
    this.line(dim(`${cell('Engineer', engineerWidth)}  ${cell('Commits', 8)}  ${cell('PRs', 5)}  ${cell('Merged', 7)}  Reviews`));
    this.config.engineers.forEach((engineer, index) => {
      const id = engineerId(engineer);
      const selected = this.contentFocused && index === this.selection[1];
      const label = `${selected ? '›' : ' '} ${engineerLabel(engineer)}`;
      const x = this.data?.engineers?.find(v => v.login === id);
      if (x?.error) this.errorLines(cell(label, engineerWidth), x.error);
      else {
        const row = `${cell(label, engineerWidth)}  ${cell(x?.commits ?? '—', 8)}  ${cell(x?.pullRequests ?? '—', 5)}  ${cell(x?.merged ?? '—', 7)}  ${x?.reviews ?? '—'}`;
        this.line(selected ? bold(cyan(row)) : row);
      }
    });
    if (!this.config.engineers.length) this.line(dim('No engineers configured. Press a to add one.'));
  }

  historyView() {
    const snapshots = this.history;
    this.line(bold(`History · ${snapshots.length} matching snapshots`));
    this.line(dim(`Rolling ${this.config.lookbackDays}-day signals · oldest ${new Date(snapshots[0].captured_at).toLocaleDateString()} · newest ${new Date(snapshots.at(-1).captured_at).toLocaleString()}`));
    this.line();
    const metric = (label, key, lowerIsBetter = false) => {
      const values = snapshots.map(item => item[key]);
      const current = values.at(-1);
      const previous = values.at(-2);
      this.line(`${cell(label, 18)} ${cyan(sparkline(values).padEnd(30))}  ${String(current).padStart(4)} ${trend(current, previous, lowerIsBetter)}`);
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
    this.line(bold('Recent snapshots'));
    this.line(dim(`${cell('Captured', 22)} ${cell('Commits', 9)} ${cell('PRs', 6)} ${cell('Reviews', 9)} ${cell('Attention', 10)}`));
    snapshots.slice(-8).reverse().forEach(item => {
      const attention = item.stale_prs + item.waiting_reviews + item.stale_issues + item.ci_failures;
      this.line(`${cell(new Date(item.captured_at).toLocaleString(), 22)} ${cell(item.commits, 9)} ${cell(item.pull_requests, 6)} ${cell(item.reviews, 9)} ${attention ? red(cell(attention, 10)) : green(cell(0, 10))}`);
    });
  }

  repositories() {
    this.line(bold('Repository health'));
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
      if (!isSelected) return cells.join('  ');
      return cells.map((value, index) => index === this.repositoryMetric ? bold(selectedCell(value)) : selectedRow(value)).join(selectedRow('  '));
    };
    const headers = ['Repository', ...metrics.map(([header]) => header)];
    const headerCells = [cell(headers[0], nameWidth), ...metrics.map(([header, width]) => cell(header, width))];
    if (this.contentFocused) headerCells[this.repositoryMetric] = bold(cyan(headerCells[this.repositoryMetric]));
    this.line(dim(headerCells.join('  ')));
    sortedRepositories.forEach((repository, index) => {
      const name = repositoryName(repository);
      const selected = this.contentFocused && index === this.selection[2];
      const displayName = `${selected ? '›' : ' '} ${repository.priority === 'owned' ? '★' : '·'} ${name}`;
      const x = this.data?.repositories?.find(v => v.name === name);
      if (x?.error) this.errorLines(cell(displayName, nameWidth), x.error);
      else {
        this.line(row(displayName, {
          openPrs: x?.openPrs ?? '—',
          stalePrs: x?.stalePrs ?? '—',
          waitingReviews: x?.waitingReviews ?? '—',
          openIssues: x?.openIssues ?? '—',
          staleIssues: x?.staleIssues ?? '—',
          failedRuns: x?.failedRuns ?? '—',
        }, selected));
      }
    });
    if (!this.config.repositories.length) this.line(dim('No repositories configured. Press a to add owner/repo.'));
    else if (!sortedRepositories.length) this.line(dim('No owned repositories. Enable contributing repositories in Settings to show them.'));
    const hidden = this.config.repositories.length - sortedRepositories.length;
    if (hidden) this.line(dim(`${hidden} contributing repositories hidden · enable them in Settings`));
  }

  sortedRepositories() {
    return [...visibleRepositories(this.config)].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority === 'owned' ? -1 : 1;
      return repositoryName(a).localeCompare(repositoryName(b));
    });
  }

  selectableItems() {
    if (this.currentView() === 'Engineers') return this.config.engineers;
    if (this.currentView() === 'Repositories') return this.sortedRepositories();
    return [];
  }

  moveSelection(delta) {
    const items = this.selectableItems();
    if (!items.length) return;
    this.selection[this.tab] = (this.selection[this.tab] + delta + items.length) % items.length;
  }

  async openSelected() {
    const items = this.selectableItems();
    if (!items.length) return;
    const selected = items[Math.min(this.selection[this.tab], items.length - 1)];
    if (this.currentView() === 'Engineers') {
      await openEngineer(engineerId(selected), this.config.hostname);
      this.message = green(`Opened @${engineerId(selected)}.`);
    } else if (this.currentView() === 'Repositories') {
      const metric = ['repository', 'openPrs', 'stalePrs', 'waitingReviews', 'openIssues', 'staleIssues', 'failedRuns'][this.repositoryMetric];
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
  }

  async editSelectedSetting() {
    const t = this.config.thresholds;
    if (this.settingsSelection === 1) {
      this.themeEditing = !this.themeEditing;
      if (!this.themeEditing) { await saveConfig(this.config); this.message = green('Theme saved.'); }
      return this.render();
    }
    if (this.settingsSelection === 3) {
      this.config.showContributingRepositories = !this.config.showContributingRepositories;
      await saveConfig(this.config);
      this.message = green(`Contributing repositories ${this.config.showContributingRepositories ? 'shown' : 'hidden'}.`);
      return this.render();
    }
    const fields = [
      ['GitHub hostname', this.config.hostname, value => { this.config.hostname = value; }],
      null,
      ['Activity lookback (days)', this.config.lookbackDays, value => { this.config.lookbackDays = Number(value) || 14; }],
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
    if (this.settingsSelection === 0) this.auth = await authStatus(this.config.hostname);
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
    if (!state) return;
    for (const char of chunk.toString()) {
      if (char === '\r' || char === '\n') {
        this.promptState = null;
        process.stdout.write('\n');
        state.resolve(state.buffer);
        return;
      }
      if (char === '\u0003') return this.quit();
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
      } else if (char >= ' ' && char !== '\u007f') {
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
      if (/^[^/\s]+\/[^/\s]+$/.test(name) && !this.config.repositories.some(repo => repositoryName(repo) === name)) this.config.repositories.push({ name, priority });
      else if (name) this.message = red('Use owner/repository format, or remove the duplicate.');
    } else {
      const id = (await this.prompt('GitHub login (without @)')).replace(/^@/, '');
      const name = await this.prompt('Actual name', id);
      if (/^[\w-]+$/.test(id) && !this.config.engineers.some(engineer => engineerId(engineer) === id)) this.config.engineers.push({ id, name });
      else if (id) this.message = red('That login is invalid or already configured.');
    }
    await saveConfig(this.config); this.render();
  }

  async remove() {
    const repositoryMode = this.currentView() === 'Repositories';
    const source = repositoryMode ? this.config.repositories : this.config.engineers;
    const choices = repositoryMode ? source.map(repositoryName) : source.map(engineerId);
    if (!choices.length) { this.message = yellow('Nothing to remove on this screen.'); return this.render(); }
    const name = await this.prompt(`Remove (${choices.join(', ')})`);
    const index = choices.indexOf(name.replace(/^@/, ''));
    if (index >= 0) { source.splice(index, 1); await saveConfig(this.config); }
    else this.message = yellow('No exact match found.');
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
    if (!repository) this.message = yellow('No exact repository match found.');
    else {
      repository.priority = repository.priority === 'owned' ? 'contributing' : 'owned';
      await saveConfig(this.config);
      this.message = green(`${name} is now ${repository.priority}.`);
    }
    this.render();
  }

  async edit() {
    if (this.currentView() !== 'Settings') return;
    this.config.hostname = await this.prompt('GitHub hostname', this.config.hostname);
    const theme = await this.prompt('Theme (default/tva/cyberpunk/matrix/dracula/nord/solarized-dark/synthwave/blueprint)', this.config.theme);
    const normalizedTheme = theme.toLowerCase().trim().replace(/\s+/g, '-');
    this.config.theme = themes[normalizedTheme] ? normalizedTheme : 'default';
    setTheme(this.config.theme);
    this.config.lookbackDays = Number(await this.prompt('Activity lookback (days)', String(this.config.lookbackDays))) || 14;
    const showContributing = await this.prompt('Show contributing repositories? (y/n)', this.config.showContributingRepositories ? 'y' : 'n');
    this.config.showContributingRepositories = showContributing.toLowerCase().startsWith('y');
    this.config.thresholds.stalePrDays = Number(await this.prompt('Stale PR threshold (days)', String(this.config.thresholds.stalePrDays))) || 3;
    this.config.thresholds.reviewWaitHours = Number(await this.prompt('Review wait threshold (hours)', String(this.config.thresholds.reviewWaitHours))) || 24;
    this.config.thresholds.staleIssueDays = Number(await this.prompt('Stale issue threshold (days)', String(this.config.thresholds.staleIssueDays))) || 14;
    await saveConfig(this.config);
    this.auth = await authStatus(this.config.hostname); this.message = green('Settings saved.'); this.render();
  }

  async refresh() {
    if (!this.auth.loggedIn) { this.message = yellow('Log in first with l.'); return this.render(); }
    const cooldownMs = 60_000;
    const remainingMs = cooldownMs - (Date.now() - this.lastRefreshStartedAt);
    if (remainingMs > 0) {
      this.message = yellow(`Please wait ${Math.ceil(remainingMs / 1000)}s before refreshing again.`);
      return this.render();
    }
    this.lastRefreshStartedAt = Date.now();
    const controller = new AbortController();
    this.refreshController = controller;
    try {
      const nextData = await fetchSignals(this.config, message => { this.message = `${cyan(message)} ${dim('Esc cancel')}`; this.render(); }, { signal: controller.signal });
      this.data = nextData;
      await saveCache(this.data);
      const recorded = await recordSnapshot(this.config, this.data);
      this.history = loadHistory(this.config);
      this.message = green(recorded ? 'Signals refreshed · snapshot saved.' : 'Signals refreshed · recent snapshot retained.');
    } catch (error) { this.message = controller.signal.aborted ? yellow('Refresh cancelled. Previous signals retained.') : red(error.message); }
    finally { this.refreshController = null; }
    this.render();
  }

  async doLogin() {
    this.prompting = true;
    process.stdout.write(`${A}?25h${A}2J${A}H`); process.stdin.setRawMode(false);
    try { await login(this.config.hostname); this.auth = await authStatus(this.config.hostname); this.message = green('Authenticated. Press r to refresh.'); }
    catch (error) { this.message = red(error.message); }
    finally {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      this.prompting = false;
    }
    this.render();
  }

  async runAction(action) {
    if (this.busy) return;
    this.busy = true;
    try {
      await action();
    } catch (error) {
      this.message = red(error.message);
      this.render();
    } finally {
      this.busy = false;
    }
  }

  async key(chunk) {
    if (this.promptState) return this.promptInput(chunk);
    const key = chunk.toString();
    if (key === '\u0003') return this.quit();
    if (key === '\u001b' && this.refreshController) {
      this.refreshController.abort();
      this.message = yellow('Cancelling refresh…');
      return this.render();
    }
    if (this.busy) return;
    if (key === 'q') return this.quit();
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
    if (key === '\t' && !this.contentFocused) this.tab = (this.tab + 1) % this.tabs.length;
    if (key === '\u001b[C') {
      if (this.contentFocused && this.currentView() === 'Repositories') this.repositoryMetric = Math.min(6, this.repositoryMetric + 1);
      else if (this.contentFocused && this.currentView() === 'Settings' && this.themeEditing) return this.runAction(() => this.cycleTheme(1));
      else if (!this.contentFocused) this.tab = (this.tab + 1) % this.tabs.length;
    }
    if (key === '\u001b[D') {
      if (this.contentFocused && this.currentView() === 'Repositories') this.repositoryMetric = Math.max(0, this.repositoryMetric - 1);
      else if (this.contentFocused && this.currentView() === 'Settings' && this.themeEditing) return this.runAction(() => this.cycleTheme(-1));
      else if (!this.contentFocused) this.tab = (this.tab + this.tabs.length - 1) % this.tabs.length;
    }
    if (key === '\u001b[A' && this.contentFocused && !this.themeEditing) {
      if (this.currentView() === 'Settings') this.settingsSelection = (this.settingsSelection + 8) % 9;
      else this.moveSelection(-1);
    }
    if (key === '\u001b[B' && this.contentFocused && !this.themeEditing) {
      if (this.currentView() === 'Settings') this.settingsSelection = (this.settingsSelection + 1) % 9;
      else this.moveSelection(1);
    }
    this.message = '';
    if (key === 'a') return this.runAction(() => this.add());
    if (key === 'd') return this.runAction(() => this.remove());
    if (key === 'p') return this.runAction(() => this.prioritize());
    if (key === 'r') return this.runAction(() => this.refresh());
    if (key === 'l') return this.runAction(() => this.doLogin());
    if (key === '\r' || key === '\n') {
      if (!this.contentFocused && ((this.currentView() === 'Engineers' || this.currentView() === 'Repositories') ? this.selectableItems().length : this.currentView() === 'Settings')) {
        this.contentFocused = true;
        return this.render();
      }
      if (this.contentFocused && this.currentView() === 'Settings') return this.runAction(() => this.editSelectedSetting());
      if (this.contentFocused) return this.runAction(() => this.openSelected());
    }
    this.render();
  }

  start() {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('GitHub Signals needs an interactive terminal.');
    // Use the alternate screen so redraws do not pollute the shell's scrollback.
    process.stdout.write(`${A}?1049h${A}H${A}2J${A}3J`);
    process.stdin.setRawMode(true); process.stdin.resume();
    process.stdin.on('data', key => this.key(key));
    process.stdout.on('resize', () => { if (!this.prompting) this.render(); });
    process.on('SIGTERM', () => this.quit());
    this.render();
  }
  quit() {
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
  new App(config, cache, auth, history).start();
} catch (error) {
  process.stdout.write(`${A}?25h`);
  console.error(`github-signals: ${error.message}`);
  process.exitCode = 1;
}
