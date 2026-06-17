#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';

export const REPO_ROOT = process.cwd();

// Packages to build and publish (npm)
// Order matters for publishing (dependencies first), but not for building
export const PACKAGES = [
  'packages/zod-from-json-schema',
  'packages/agentview',
  'packages/studio',
  'packages/create-agentview',
];

export function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

export function runQuiet(cmd, opts = {}) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    .toString()
    .trim();
}

export function isRepoClean() {
  try {
    const out = runQuiet('git status --porcelain', { cwd: REPO_ROOT });
    return out.length === 0;
  } catch {
    return false;
  }
}

export async function readJSON(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export async function writeJSON(filePath, data) {
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export function getDistTagFromVersion(version) {
  if (!version.includes('-')) return 'latest';
  const m = version.match(/^[0-9]+\.[0-9]+\.[0-9]+-([A-Za-z0-9]+)/);
  return m ? m[1] : 'latest';
}

export function isPrerelease(version) {
  return version.includes('-');
}

export async function getRootVersion() {
  const pkg = await readJSON(path.join(REPO_ROOT, 'package.json'));
  return pkg.version;
}

// Resolve the verdaccio (local) registry from the environment. Exits if it is
// unset or points anywhere other than a local registry, so publish/unpublish
// can never touch a real registry.
export function getVerdaccioRegistry() {
  const registry = process.env.VERDACCIO_REGISTRY;
  if (!registry) {
    console.error('Error: VERDACCIO_REGISTRY is not set.');
    console.error('Set it to your local registry, e.g.: export VERDACCIO_REGISTRY=http://localhost:4873');
    process.exit(1);
  }
  if (!/localhost|127\.0\.0\.1/.test(registry)) {
    console.error(`Refusing to continue: VERDACCIO_REGISTRY is "${registry}".`);
    console.error('This only runs against a local registry (e.g. verdaccio).');
    process.exit(1);
  }
  return registry;
}

// Whether a given package version already exists on the registry.
export function isVersionPublished(pkgName, version, registry) {
  try {
    const out = runQuiet(`npm view ${pkgName}@${version} version --registry ${registry}`, { cwd: REPO_ROOT });
    return out.length > 0;
  } catch {
    // npm view exits non-zero when the package/version is unknown.
    return false;
  }
}

export function parseArgs(args) {
  const result = {
    bumpType: null,
    preid: null,
    skipBuild: false,
    skipPublish: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--skip-build') {
      result.skipBuild = true;
    } else if (arg === '--skip-publish') {
      result.skipPublish = true;
    } else if (!arg.startsWith('--')) {
      if (!result.bumpType) {
        result.bumpType = arg;
      } else if (!result.preid) {
        result.preid = arg;
      }
    }
  }

  return result;
}
