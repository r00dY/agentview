#!/usr/bin/env node
import path from 'node:path';
import { REPO_ROOT, PACKAGES, run, getRootVersion, getDistTagFromVersion } from './utils.mjs';

export async function publishPackages() {
  const version = await getRootVersion();

  const tag = getDistTagFromVersion(version);
  console.log(`Publishing v${version} with dist-tag "${tag}"...\n`);

  for (const rel of PACKAGES) {
    console.log(`Publishing ${rel}...`);
    // Use pnpm publish to:
    // 1. Respect publishConfig in package.json
    // 2. Automatically replace workspace:* dependencies with actual versions
    run(`pnpm publish --no-git-checks --tag ${tag}`, { cwd: path.join(REPO_ROOT, rel) });
  }

  console.log(`\nAll packages published successfully (v${version}).`);
  return version;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  publishPackages();
}
