import type { DashboardState } from '../../application/dashboard-state.js';
import { paginateCommits, type CommitPage } from '../../domain/dashboard-selectors.js';
import { tableCell } from '../terminal/format.js';
import type { TerminalCanvas } from '../terminal/canvas.js';

export const COMMIT_PAGE_SIZE = 20;

export function currentCommitPage(state: DashboardState): CommitPage {
  const commits = state.commitLedger.focusedCommits ?? state.commitLedger.commits;
  return paginateCommits(commits, state.commitLedger.page, COMMIT_PAGE_SIZE);
}

export function renderCommitsScreen(canvas: TerminalCanvas, state: DashboardState): void {
  const ledger = state.commitLedger;
  const { theme } = canvas;
  canvas.line(theme.bold(`Organization commit ledger · ${state.config.organizations.join(', ')}`));
  const { commits, pages, rows, page } = currentCommitPage(state);
  const scope = ledger.repositoryFilter
    ? `${commits.length} latest commits · ${ledger.repositoryFilter} · fetched on demand`
    : `${ledger.commits.length} commits · ${state.config.commitLedgerDays}-day window · ${ledger.repositories} active repositories`;
  canvas.line(theme.muted(`${scope} · page ${page + 1}/${pages} · default branches`));
  if (ledger.errors.length) canvas.line(theme.warning(`${ledger.errors.length} repositories could not be read`));

  const width = Math.max(80, canvas.width);
  const repositoryWidth = Math.max(18, Math.min(48, Math.floor(width * 0.25)));
  const branchWidth = 12;
  const authorWidth = 18;
  const dateWidth = 17;
  const shaWidth = 8;
  const messageWidth = Math.max(12, width - repositoryWidth - branchWidth - authorWidth - dateWidth - shaWidth - 8);
  canvas.line(theme.muted(`${tableCell('Date', dateWidth)} ${tableCell('Repository', repositoryWidth)} ${tableCell('Branch', branchWidth)} ${tableCell('Author', authorWidth)} ${tableCell('SHA', shaWidth)} ${tableCell('Change', messageWidth)}`));
  rows.forEach((commit, index) => {
    const selected = state.contentFocused && index === ledger.selection;
    const date = commit.committedAt
      ? new Date(commit.committedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
      : 'unknown';
    const row = `${selected ? '›' : ' '} ${tableCell(date, dateWidth)} ${tableCell(commit.repository, repositoryWidth)} ${tableCell(commit.branch, branchWidth)} ${tableCell(commit.author, authorWidth)} ${tableCell(commit.sha.slice(0, 7), shaWidth)} ${tableCell(commit.message, messageWidth)}`;
    canvas.line(selected ? theme.selectedRow(row) : row);
  });
  if (!rows.length) {
    const plural = state.config.commitLedgerDays === 1 ? '' : 's';
    canvas.line(theme.warning(`No cached commits. Press r to refresh the last ${state.config.commitLedgerDays} day${plural}.`));
  }
}
