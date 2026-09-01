import { sanitizeTerminal } from './sanitize.js';
import { ANSI_ESCAPE, fitText, sparkline, stripAnsi } from './format.js';
import { TerminalTheme } from './theme.js';

export class TerminalCanvas {
  public constructor(
    public readonly theme: TerminalTheme,
    private readonly version: string,
  ) {}

  public get width(): number { return process.stdout.columns || 100; }
  public get height(): number { return process.stdout.rows || 40; }

  public line(text = ''): void {
    process.stdout.write(`${fitText(sanitizeTerminal(text), this.width)}${ANSI_ESCAPE}K\n`);
  }

  public footer(text: string): void {
    const usableWidth = Math.max(1, this.width - 2);
    const version = this.theme.muted(`v${this.version}`);
    const left = fitText(text, Math.max(1, usableWidth - stripAnsi(version).length - 1));
    const gap = ' '.repeat(Math.max(1, usableWidth - stripAnsi(left).length - stripAnsi(version).length));
    this.line(`${left}${gap}${version}`);
  }

  public errorLines(label: string, error: string): void {
    const width = Math.max(40, this.width);
    const prefix = `${label} ${this.theme.error('error')} `;
    const indent = ' '.repeat(stripAnsi(prefix).length);
    const words = error.replace(/\s+/g, ' ').trim().split(' ');
    let currentLine = prefix;
    for (const word of words) {
      if (stripAnsi(currentLine).length + word.length + 1 > width) {
        this.line(currentLine);
        currentLine = `${indent}${word}`;
      } else {
        currentLine += `${stripAnsi(currentLine).endsWith(' ') ? '' : ' '}${word}`;
      }
    }
    if (stripAnsi(currentLine).trim()) this.line(currentLine);
  }

  public badge(count: number, isBad = false): string {
    if (!count) return this.theme.muted('0');
    return isBad ? this.theme.error(String(count)) : this.theme.accent(String(count));
  }

  public sparkline(values: readonly number[], color: (text: string) => string = this.theme.accent.bind(this.theme)): string {
    const chart = sparkline(values);
    return chart ? color(chart) : this.theme.muted('no history');
  }

  public trend(current: number, previous?: number | null, lowerIsBetter = false): string {
    if (previous == null || current === previous) return this.theme.muted('→');
    const improved = lowerIsBetter ? current < previous : current > previous;
    const arrow = current > previous ? '↑' : '↓';
    return improved ? this.theme.success(arrow) : this.theme.error(arrow);
  }

  public panel(title: string, rows: readonly string[], width: number): string[] {
    const innerWidth = Math.max(20, width - 2);
    return [
      this.theme.muted(`┌${'─'.repeat(innerWidth)}┐`),
      `${this.theme.muted('│')} ${this.theme.bold(title)}${' '.repeat(Math.max(0, innerWidth - stripAnsi(title).length - 1))}${this.theme.muted('│')}`,
      ...rows.map(row => {
        const fittedRow = fitText(row, innerWidth - 1);
        return `${this.theme.muted('│')} ${fittedRow}${' '.repeat(Math.max(0, innerWidth - 1 - stripAnsi(fittedRow).length))}${this.theme.muted('│')}`;
      }),
      this.theme.muted(`└${'─'.repeat(innerWidth)}┘`),
    ];
  }

  public drawPanels(left: readonly string[], right: readonly string[]): void {
    if (this.width < 96) {
      left.forEach(line => this.line(line));
      this.line();
      right.forEach(line => this.line(line));
      return;
    }
    left.forEach((line, index) => this.line(`${line}  ${right[index] ?? ''}`));
  }
}
