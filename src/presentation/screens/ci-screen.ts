import type { DashboardState } from '../../application/dashboard-state.js';
import { groupCiWorkflows } from '../../domain/dashboard-selectors.js';
import type { CiRun } from '../../domain/models.js';
import { formatDuration, tableCell } from '../terminal/format.js';
import type { TerminalCanvas } from '../terminal/canvas.js';

export function renderCiScreen(canvas: TerminalCanvas, state: DashboardState): void {
  if (state.ciView?.type === 'workflow') {
    renderWorkflowRuns(canvas, state);
    return;
  }
  if (state.ciView?.type === 'run') {
    renderRunJobs(canvas, state);
    return;
  }
  renderWorkflowOverview(canvas, state);
}

function renderWorkflowOverview(canvas: TerminalCanvas, state: DashboardState): void {
  const groups = groupCiWorkflows(state.ciRuns);
  const { theme } = canvas;
  canvas.line(theme.bold('CI workflows'));
  const visibleRows = Math.max(5, canvas.height - 12);
  const start = Math.max(0, Math.min(state.ciSelection - Math.floor(visibleRows / 2), groups.length - visibleRows));
  const end = Math.min(groups.length, start + visibleRows);
  const range = groups.length ? `${start + 1}–${end} of ${groups.length}` : '0';
  canvas.line(theme.muted(`GitHub Actions · ${state.ciRuns.length} stored runs · workflows ${range} · ${state.config.historyRetentionDays}-day retention`));
  if (state.ciErrors.length) canvas.line(theme.warning(`${state.ciErrors.length} repositories could not return Actions data during the last refresh.`));
  canvas.line();
  if (!groups.length) {
    canvas.line(theme.muted('No Actions history yet. Press r to refresh GitHub signals.'));
    return;
  }

  const fixedWidth = 52;
  const nameWidth = Math.max(24, canvas.width - fixedWidth);
  canvas.line(theme.muted(`${tableCell('Workflow', nameWidth)} ${tableCell('Runs', 6)} ${tableCell('Success', 8)} ${tableCell('p50', 7)} ${tableCell('p95', 7)} ${tableCell('Queue', 7)} Last`));
  groups.slice(start, end).forEach((group, visibleIndex) => {
    const index = start + visibleIndex;
    const selected = state.contentFocused && index === state.ciSelection;
    const latest = group.latest;
    const latestState = latest?.status !== 'completed'
      ? theme.warning('running')
      : latest.conclusion === 'success'
        ? theme.success('passed')
        : theme.error(latest.conclusion ?? 'unknown');
    const label = `${selected ? '›' : ' '} ${group.repository} · ${group.workflow}`;
    const row = `${tableCell(label, nameWidth)} ${tableCell(group.completed, 6)} ${tableCell(group.successRate == null ? '—' : `${Math.round(group.successRate * 100)}%`, 8)} ${tableCell(formatDuration(group.p50), 7)} ${tableCell(formatDuration(group.p95), 7)} ${tableCell(formatDuration(group.queue), 7)} ${latestState}`;
    canvas.line(selected ? theme.selectedRow(row) : row);
  });
}

function renderWorkflowRuns(canvas: TerminalCanvas, state: DashboardState): void {
  if (state.ciView?.type !== 'workflow') return;
  const { group } = state.ciView;
  const runs = group.runs;
  const selected = runs[state.ciView.selection];
  const { theme } = canvas;
  canvas.line(theme.bold(`${group.workflow} · ${group.repository}`));
  canvas.line(theme.muted(`${group.completed} completed · ${group.successRate == null ? '—' : `${Math.round(group.successRate * 100)}% success`} · p50 ${formatDuration(group.p50)} · p95 ${formatDuration(group.p95)}`));
  canvas.line();
  if (!selected) {
    canvas.line(theme.muted('No runs are available for this workflow.'));
    return;
  }

  const visibleRows = Math.min(10, Math.max(6, runs.length));
  const start = Math.max(0, Math.min(state.ciView.selection - Math.floor(visibleRows / 2), runs.length - visibleRows));
  canvas.line(theme.muted(`${tableCell('Run', 38)} ${tableCell('Branch', 20)} ${tableCell('Result', 12)} ${tableCell('Duration', 10)} Queue`));
  runs.slice(start, start + visibleRows).forEach(run => renderRunRow(canvas, run, run === selected));
  for (let index = Math.min(visibleRows, runs.length); index < visibleRows; index++) canvas.line();
  canvas.line();
  canvas.line(`${theme.bold(selected.title ?? 'Workflow run')}  ${runResult(canvas, selected)}`);
  canvas.line(`${selected.headBranch ?? '—'} · ${selected.headSha?.slice(0, 7) ?? '—'} · ${selected.actor ? `@${selected.actor}` : 'unknown actor'} · ${selected.createdAt ? new Date(selected.createdAt).toLocaleString() : 'unknown time'}`);
  canvas.line(`Duration ${theme.accent(formatDuration(selected.durationMs))} · Queue ${theme.accent(formatDuration(selected.queueMs))} · Attempt ${selected.attempt ?? 1} · Event ${selected.event ?? '—'}`);
}

function renderRunRow(canvas: TerminalCanvas, run: CiRun, active: boolean): void {
  const result = run.status !== 'completed' ? 'running' : run.conclusion ?? 'unknown';
  const row = `${tableCell(`${active ? '›' : ' '} #${run.id ?? '—'} ${run.title ?? 'Workflow run'}`, 38)} ${tableCell(run.headBranch ?? '—', 20)} ${tableCell(result, 12)} ${tableCell(formatDuration(run.durationMs), 10)} ${formatDuration(run.queueMs)}`;
  canvas.line(active ? canvas.theme.selectedRow(row) : row);
}

function renderRunJobs(canvas: TerminalCanvas, state: DashboardState): void {
  if (state.ciView?.type !== 'run') return;
  const { run, jobs } = state.ciView;
  const selected = jobs[state.ciView.selection];
  const { theme } = canvas;
  canvas.line(theme.bold(`${run.workflow ?? 'Workflow'} · ${run.repository}`));
  canvas.line(`${run.title ?? 'Workflow run'} · ${runResult(canvas, run)} · ${formatDuration(run.durationMs)}`);
  canvas.line();
  if (!selected) {
    canvas.line(theme.muted('No jobs returned for this workflow run.'));
    return;
  }

  const visibleRows = Math.max(4, Math.min(12, canvas.height - 18));
  const start = Math.max(0, Math.min(state.ciView.selection - Math.floor(visibleRows / 2), jobs.length - visibleRows));
  const end = Math.min(jobs.length, start + visibleRows);
  canvas.line(theme.muted(`${tableCell(`Job · ${start + 1}–${end} of ${jobs.length}`, 42)} ${tableCell('Result', 14)} ${tableCell('Duration', 10)} Runner`));
  jobs.slice(start, end).forEach((job, visibleIndex) => {
    const active = start + visibleIndex === state.ciView!.selection;
    const row = `${tableCell(`${active ? '›' : ' '} ${job.name}`, 42)} ${tableCell(job.conclusion ?? job.status ?? '—', 14)} ${tableCell(formatDuration(job.durationMs), 10)} ${job.runnerName ?? '—'}`;
    canvas.line(active ? theme.selectedRow(row) : row);
  });
  canvas.line();
  const stepRows = Math.max(3, canvas.height - visibleRows - 16);
  const visibleSteps = selected.steps.slice(0, stepRows);
  const stepRange = selected.steps.length > visibleSteps.length ? ` · showing ${visibleSteps.length} of ${selected.steps.length}` : '';
  canvas.line(theme.bold(`Steps · ${selected.name}${stepRange}`));
  visibleSteps.forEach(step => {
    const result = step.conclusion === 'success'
      ? theme.success('passed')
      : step.conclusion
        ? theme.error(step.conclusion)
        : theme.muted(step.status ?? '—');
    canvas.line(`${tableCell(step.name, 52)} ${tableCell(formatDuration(step.durationMs), 10)} ${result}`);
  });
}

function runResult(canvas: TerminalCanvas, run: CiRun): string {
  if (run.status !== 'completed') return canvas.theme.warning('running');
  if (run.conclusion === 'success') return canvas.theme.success('passed');
  return canvas.theme.error(run.conclusion ?? 'unknown');
}
