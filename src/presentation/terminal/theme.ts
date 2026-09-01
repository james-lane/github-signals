import type { ThemeName } from '../../domain/models.js';

interface ThemePalette {
  accent: string;
  success: string;
  warning: string;
  error: string;
  muted: string;
  selectedRow: string;
  selectedCell: string;
}

const ANSI_PREFIX = '\x1b[';

const PALETTES: Readonly<Record<ThemeName, ThemePalette>> = {
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

export const THEME_LABELS: Readonly<Record<ThemeName, string>> = {
  default: 'Default',
  tva: 'TVA',
  cyberpunk: 'Cyberpunk',
  matrix: 'Matrix',
  dracula: 'Dracula',
  nord: 'Nord',
  'solarized-dark': 'Solarized Dark',
  synthwave: 'Synthwave',
  blueprint: 'Blueprint',
};

export class TerminalTheme {
  private palette: ThemePalette;

  public constructor(theme: ThemeName = 'default') {
    this.palette = PALETTES[theme];
  }

  public set(theme: ThemeName): void {
    this.palette = PALETTES[theme];
  }

  public accent(text: string): string { return this.color(this.palette.accent, text); }
  public navigationAccent(text: string): string { return this.color('38;5;208', text); }
  public success(text: string): string { return this.color(this.palette.success, text); }
  public warning(text: string): string { return this.color(this.palette.warning, text); }
  public error(text: string): string { return this.color(this.palette.error, text); }
  public muted(text: string): string { return this.color(this.palette.muted, text); }
  public selectedRow(text: string): string { return this.color(this.palette.selectedRow, text); }
  public selectedCell(text: string): string { return this.color(this.palette.selectedCell, text); }
  public bold(text: string): string { return this.color('1', text); }

  private color(code: string, text: string): string {
    return `${ANSI_PREFIX}${code}m${text}${ANSI_PREFIX}0m`;
  }
}
