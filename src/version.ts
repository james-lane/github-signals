import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

function readVersion() {
  for (const filename of [path.join(moduleDirectory, '../../package.json'), path.join(moduleDirectory, '../package.json')]) {
    try {
      const parsed = JSON.parse(readFileSync(filename, 'utf8'));
      if (typeof parsed.version === 'string') return parsed.version;
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
  }
  return '0.0.0';
}

export const APP_VERSION = readVersion();
