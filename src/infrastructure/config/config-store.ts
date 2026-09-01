import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  defaults,
  serializeConfig,
  validateConfig,
} from '../../domain/configuration.js';
import type { AppConfig } from '../../domain/models.js';
import { errorMessage, isNodeError } from '../../shared/errors.js';
import { CACHE_FILE, CONFIG_FILE } from '../../shared/local-file-names.js';

export function configPath(cwd = process.cwd()): string {
  return path.join(cwd, CONFIG_FILE);
}

export async function loadConfig(cwd = process.cwd()): Promise<AppConfig> {
  try {
    return validateConfig(JSON.parse(await readFile(configPath(cwd), 'utf8')));
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') return structuredClone(defaults);
    throw new Error(`Could not read ${CONFIG_FILE}: ${errorMessage(error)}`);
  }
}

export async function saveConfig(
  config: AppConfig | Record<string, unknown>,
  cwd = process.cwd(),
): Promise<void> {
  const validated = validateConfig(config);
  Object.assign(config, validated);
  const filename = configPath(cwd);
  await writeFile(filename, serializeConfig(validated), { mode: 0o600 });
  await chmod(filename, 0o600);
}

export async function loadCache<T>(cwd = process.cwd()): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(cwd, CACHE_FILE), 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function saveCache(data: unknown, cwd = process.cwd()): Promise<void> {
  const filename = path.join(cwd, CACHE_FILE);
  await writeFile(filename, `${JSON.stringify(data)}\n`, { mode: 0o600 });
  await chmod(filename, 0o600);
}
