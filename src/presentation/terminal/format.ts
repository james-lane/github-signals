export const ANSI_ESCAPE = '\x1b[';
export const MILLISECONDS_PER_DAY = 86_400_000;

export function stripAnsi(text: unknown): string {
  return String(text).replace(/\x1b\[[0-9;]*m/g, '');
}

export function fitText(text: string, width: number): string {
  return stripAnsi(text).length <= width
    ? text
    : `${stripAnsi(text).slice(0, Math.max(0, width - 1))}…`;
}

export function tableCell(value: unknown, width: number): string {
  return fitText(String(value), width).padEnd(width);
}

export function elapsedTime(value: string): string {
  const milliseconds = Math.max(0, Date.now() - new Date(value).getTime());
  const hours = Math.floor(milliseconds / 3_600_000);
  if (hours < 1) return '<1h';
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ${hours % 24}h`;
  return `${Math.floor(days / 7)}w ${days % 7}d`;
}

export function formatDuration(milliseconds?: number | null): string {
  if (milliseconds == null) return '—';
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`;
}

export function sparkline(values: readonly number[]): string | null {
  if (!values.length) return null;
  const bars = '▁▂▃▄▅▆▇█';
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return values.map(value => bars[maximum === minimum
    ? 3
    : Math.round((value - minimum) / (maximum - minimum) * 7)]).join('');
}
