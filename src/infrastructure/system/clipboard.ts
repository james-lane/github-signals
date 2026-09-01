import { spawn } from 'node:child_process';

const clipboardCommand = () => {
  if (process.platform === 'darwin') return ['pbcopy', []] as const;
  if (process.platform === 'win32') return ['clip.exe', []] as const;
  if (process.env.WAYLAND_DISPLAY) return ['wl-copy', []] as const;
  if (process.env.DISPLAY) return ['xclip', ['-selection', 'clipboard']] as const;
  return null;
};

export function copyToClipboard(value: string) {
  const command = clipboardCommand();
  if (!command) return Promise.reject(new Error('No supported system clipboard was detected.'));

  return new Promise<void>((resolve, reject) => {
    const child = spawn(command[0], command[1], { stdio: ['pipe', 'ignore', 'pipe'] });
    let errorOutput = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { errorOutput += chunk; });
    child.on('error', error => reject(new Error(`Could not copy configuration: ${error.message}`)));
    child.on('close', code => code === 0
      ? resolve()
      : reject(new Error(`Could not copy configuration${errorOutput.trim() ? `: ${errorOutput.trim()}` : '.'}`)));
    child.stdin.end(value);
  });
}
