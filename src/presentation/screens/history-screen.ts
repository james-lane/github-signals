import type { DashboardState } from '../../application/dashboard-state.js';
import { calculateCiMetrics, type CiMetrics } from '../../domain/dashboard-selectors.js';
import type { HistorySnapshot } from '../../domain/models.js';
import { formatDuration, tableCell } from '../terminal/format.js';
import type { TerminalCanvas } from '../terminal/canvas.js';

type HistoryMetric = 'commits' | 'pull_requests' | 'merged' | 'reviews' | 'stale_prs' | 'waiting_reviews' | 'stale_issues' | 'ci_failures';
type CiMetric = 'successRate' | 'failed' | 'p50' | 'p95' | 'queue';

export function renderHistoryScreen(canvas: TerminalCanvas, state: DashboardState): void {
  const snapshots = state.history;
  if (!snapshots.length) {
    canvas.line(canvas.theme.muted('No history is available for the current scope.'));
    return;
  }
  const selectedIndex = state.historySelection;
  const selected = snapshots[selectedIndex];
  const previous = snapshots[selectedIndex - 1];
  const { theme } = canvas;

  canvas.line(theme.bold(`History · ${snapshots.length} matching snapshots`));
  canvas.line(theme.muted(`Rolling ${state.config.lookbackDays}-day signals · oldest ${new Date(snapshots[0].captured_at).toLocaleDateString()} · newest ${new Date(snapshots.at(-1)!.captured_at).toLocaleString()}`));
  canvas.line(`${state.contentFocused ? theme.accent('●') : theme.muted('○')} ${theme.bold(new Date(selected.captured_at).toLocaleString())}  ${theme.muted(`snapshot ${selectedIndex + 1} of ${snapshots.length}`)}`);
  canvas.line();
  canvas.line(theme.bold('Team activity'));
  renderHistoryMetric(canvas, snapshots, selected, previous, 'Commits', 'commits');
  renderHistoryMetric(canvas, snapshots, selected, previous, 'Pull requests', 'pull_requests');
  renderHistoryMetric(canvas, snapshots, selected, previous, 'Merged', 'merged');
  renderHistoryMetric(canvas, snapshots, selected, previous, 'Reviews', 'reviews');
  canvas.line();
  canvas.line(theme.bold('Repository attention'));
  renderHistoryMetric(canvas, snapshots, selected, previous, 'Stale PRs', 'stale_prs', true);
  renderHistoryMetric(canvas, snapshots, selected, previous, 'Waiting reviews', 'waiting_reviews', true);
  renderHistoryMetric(canvas, snapshots, selected, previous, 'Stale issues', 'stale_issues', true);
  renderHistoryMetric(canvas, snapshots, selected, previous, 'CI failures', 'ci_failures', true);
  canvas.line();

  if (state.config.ciEnabled) renderCiHistory(canvas, state, snapshots, selectedIndex);
  renderRecentSnapshots(canvas, state, snapshots, selected, selectedIndex);
}

function renderHistoryMetric(
  canvas: TerminalCanvas,
  snapshots: readonly HistorySnapshot[],
  selected: HistorySnapshot,
  previous: HistorySnapshot | undefined,
  label: string,
  key: HistoryMetric,
  lowerIsBetter = false,
): void {
  const values = snapshots.map(snapshot => snapshot[key]);
  const current = selected[key];
  canvas.line(`${tableCell(label, 18)} ${tableCell(canvas.sparkline(values), 30)}  ${String(current).padStart(4)} ${canvas.trend(current, previous?.[key], lowerIsBetter)}`);
}

function renderCiHistory(
  canvas: TerminalCanvas,
  state: DashboardState,
  snapshots: readonly HistorySnapshot[],
  selectedIndex: number,
): void {
  const { theme } = canvas;
  const timeline = snapshots.map(snapshot =>
    calculateCiMetrics(state.ciRuns, state.config.lookbackDays, snapshot.captured_at));
  const selected = timeline[selectedIndex];
  const previous = timeline[selectedIndex - 1];
  const formatter: Record<CiMetric, (value: number) => string> = {
    successRate: value => `${value}%`,
    failed: String,
    p50: formatDuration,
    p95: formatDuration,
    queue: formatDuration,
  };
  const rows: Array<{ label: string; key: CiMetric; lowerIsBetter?: boolean }> = [
    { label: 'Success rate', key: 'successRate' },
    { label: 'Failed runs', key: 'failed', lowerIsBetter: true },
    { label: 'p50 duration', key: 'p50', lowerIsBetter: true },
    { label: 'p95 duration', key: 'p95', lowerIsBetter: true },
    { label: 'Median queue', key: 'queue', lowerIsBetter: true },
  ];

  canvas.line(theme.bold(`CI performance · ${state.config.lookbackDays}-day window`));
  rows.forEach(row => renderCiMetric(canvas, timeline, selected, previous, row.label, row.key, formatter[row.key], row.lowerIsBetter));
  canvas.line(theme.muted(`${selected.runs} stored runs across ${selected.workflows} workflows at this snapshot`));
  canvas.line();
}

function renderCiMetric(
  canvas: TerminalCanvas,
  timeline: readonly CiMetrics[],
  selected: CiMetrics,
  previous: CiMetrics | undefined,
  label: string,
  key: CiMetric,
  formatter: (value: number) => string,
  lowerIsBetter = false,
): void {
  const values = timeline.map(item => item[key] ?? 0);
  const current = selected[key];
  const value = current == null ? '—' : formatter(current);
  const trend = current == null ? canvas.theme.muted('→') : canvas.trend(current, previous?.[key], lowerIsBetter);
  canvas.line(`${tableCell(label, 18)} ${tableCell(canvas.sparkline(values), 30)}  ${String(value).padStart(7)} ${trend}`);
}

function renderRecentSnapshots(
  canvas: TerminalCanvas,
  state: DashboardState,
  snapshots: readonly HistorySnapshot[],
  selected: HistorySnapshot,
  selectedIndex: number,
): void {
  const { theme } = canvas;
  canvas.line(theme.bold('Recent snapshots'));
  canvas.line(theme.muted(`${tableCell('Captured', 22)} ${tableCell('Commits', 9)} ${tableCell('PRs', 6)} ${tableCell('Reviews', 9)} ${tableCell('Attention', 10)}`));
  const windowStart = Math.max(0, Math.min(selectedIndex - 3, snapshots.length - 8));
  snapshots.slice(windowStart, windowStart + 8).reverse().forEach(snapshot => {
    const attention = snapshot.stale_prs + snapshot.waiting_reviews + snapshot.stale_issues + snapshot.ci_failures;
    const isSelected = snapshot === selected && state.contentFocused;
    const row = `${tableCell(`${isSelected ? '› ' : '  '}${new Date(snapshot.captured_at).toLocaleString()}`, 22)} ${tableCell(snapshot.commits, 9)} ${tableCell(snapshot.pull_requests, 6)} ${tableCell(snapshot.reviews, 9)} ${tableCell(attention, 10)}`;
    canvas.line(isSelected ? theme.bold(theme.selectedRow(row)) : row);
  });
}
