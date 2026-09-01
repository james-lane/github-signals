#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const packageMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const packageVersion = typeof packageMetadata.version === 'string' ? packageMetadata.version : '';
const releaseTag = process.env.GITHUB_REF_NAME ?? process.argv[2] ?? '';
const expectedTag = `v${packageVersion}`;

if (releaseTag !== expectedTag) {
  process.stderr.write(`Release tag ${releaseTag || '(missing)'} does not match package version ${expectedTag}.\n`);
  process.exitCode = 1;
}
