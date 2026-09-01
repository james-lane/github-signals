import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_SEARCH_LIMIT = 6;

function readVersion(): string {
  let directory = moduleDirectory;
  for (let depth = 0; depth < PACKAGE_SEARCH_LIMIT; depth += 1) {
    const filename = path.join(directory, 'package.json');
    try {
      const parsed: unknown = JSON.parse(readFileSync(filename, 'utf8'));
      if (hasVersion(parsed)) return parsed.version;
    } catch (error: unknown) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
    directory = path.dirname(directory);
  }
  return '0.0.0';
}

function hasVersion(value: unknown): value is { version: string } {
  return typeof value === 'object'
    && value !== null
    && 'version' in value
    && typeof value.version === 'string';
}

export const APP_VERSION = readVersion();
