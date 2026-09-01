import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const SOURCE_ROOT = path.join(process.cwd(), 'src');
const MAXIMUM_SOURCE_LINES = 600;

test('keeps only the executable entry point at the source root', async () => {
  const entries = await readdir(SOURCE_ROOT, { withFileTypes: true });
  const rootFiles = entries
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .sort();
  assert.deepEqual(rootFiles, ['cli.ts']);
});

test('keeps source modules bounded and type checking enabled', async () => {
  const sourceFiles = await findTypeScriptFiles(SOURCE_ROOT);
  for (const filename of sourceFiles) {
    const source = await readFile(filename, 'utf8');
    const relativePath = path.relative(process.cwd(), filename);
    assert.equal(/@ts-(?:no)?check|@ts-ignore/.test(source), false, `${relativePath} disables type checking`);
    assert.equal(/\bany\b/.test(source), false, `${relativePath} uses any`);
    assert.ok(source.split('\n').length <= MAXIMUM_SOURCE_LINES, `${relativePath} exceeds ${MAXIMUM_SOURCE_LINES} lines`);
  }
});

test('keeps the domain layer independent of presentation and infrastructure', async () => {
  const domainFiles = await findTypeScriptFiles(path.join(SOURCE_ROOT, 'domain'));
  for (const filename of domainFiles) {
    const source = await readFile(filename, 'utf8');
    const relativePath = path.relative(process.cwd(), filename);
    assert.equal(/from ['"]\.\.\/(?:presentation|infrastructure|application)\//.test(source), false,
      `${relativePath} depends on an outer layer`);
    assert.equal(/from ['"]node:|\bprocess\./.test(source), false,
      `${relativePath} performs runtime or filesystem work`);
  }
});

async function findTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(entries.map(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? findTypeScriptFiles(filename) : Promise.resolve(filename.endsWith('.ts') ? [filename] : []);
  }));
  return nestedFiles.flat();
}
