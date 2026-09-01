#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const releaseDirectory = path.join(process.cwd(), 'release');
await mkdir(releaseDirectory, { recursive: true });

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const pack = spawn(npmCommand, ['pack', '--pack-destination', releaseDirectory], {
  stdio: 'inherit',
});

pack.on('error', error => {
  process.stderr.write(`Could not package the release: ${error.message}\n`);
  process.exitCode = 1;
});

pack.on('close', code => {
  if (code !== 0) process.exitCode = code ?? 1;
});
