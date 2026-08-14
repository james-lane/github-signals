#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const zeroSha = /^0+$/;
const pushes = readFileSync(0, 'utf8').trim().split('\n').filter(Boolean).map(line => {
  const [localRef, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
  return { localRef, localSha, remoteRef, remoteSha };
});

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function jsonAt(revision, filename) {
  try { return JSON.parse(git(['show', `${revision}:${filename}`])); }
  catch { return null; }
}

function bumpPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/.exec(version);
  if (!match) throw new Error(`Cannot automatically bump non-semver version ${version}.`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

for (const push of pushes) {
  if (!push.localSha || zeroSha.test(push.localSha) || !push.remoteSha || zeroSha.test(push.remoteSha)) continue;
  const remotePackage = jsonAt(push.remoteSha, 'package.json');
  const localPackage = jsonAt(push.localSha, 'package.json');
  const localLock = jsonAt(push.localSha, 'package-lock.json');
  if (localPackage && localLock && (localLock.version !== localPackage.version || localLock.packages?.['']?.version !== localPackage.version)) {
    process.stderr.write('pre-push: package.json and package-lock.json versions do not match.\n');
    process.exit(1);
  }
  if (!remotePackage || !localPackage || localPackage.version !== remotePackage.version) continue;
  const changed = git(['diff', '--name-only', push.remoteSha, push.localSha]).split('\n').filter(Boolean);
  if (!changed.some(filename => !['package.json', 'package-lock.json'].includes(filename))) continue;
  const packageFilesDirty = git(['status', '--porcelain', '--', 'package.json', 'package-lock.json']);
  if (packageFilesDirty) {
    process.stderr.write('pre-push: package files already have uncommitted changes; bump the version manually and commit them.\n');
    process.exit(1);
  }
  const nextVersion = bumpPatch(localPackage.version);
  for (const filename of ['package.json', 'package-lock.json']) {
    const json = JSON.parse(readFileSync(filename, 'utf8'));
    json.version = nextVersion;
    if (filename === 'package-lock.json' && json.packages?.['']) json.packages[''].version = nextVersion;
    writeFileSync(filename, `${JSON.stringify(json, null, 2)}\n`);
  }
  process.stderr.write(`pre-push: bumped ${localPackage.version} → ${nextVersion}. Commit package.json and package-lock.json, then push again.\n`);
  process.exit(1);
}
