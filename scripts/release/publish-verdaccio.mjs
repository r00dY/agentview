#!/usr/bin/env node
import path from 'node:path';
import {
  REPO_ROOT,
  PACKAGES,
  run,
  getRootVersion,
  getVerdaccioRegistry,
  isVersionPublished,
  readJSON,
} from './utils.mjs';
import { publishPackages } from './publish.mjs';

function unpublishSpecs(specs, registry) {
  console.log(`\nUnpublishing from ${registry}...\n`);
  for (const spec of specs) {
    console.log(`Unpublishing ${spec}...`);
    run(`npm unpublish ${spec} --registry ${registry} --force`, { cwd: REPO_ROOT });
  }
}

async function publishToVerdaccio() {
  const registry = getVerdaccioRegistry();
  const version = await getRootVersion();

  // Find which packages already have this version on the registry and yank them
  // so we can republish the same version without bumping.
  const published = [];
  for (const rel of PACKAGES) {
    const pkg = await readJSON(path.join(REPO_ROOT, rel, 'package.json'));
    if (isVersionPublished(pkg.name, version, registry)) {
      published.push(`${pkg.name}@${version}`);
    }
  }

  if (published.length > 0) {
    unpublishSpecs(published, registry);
  }

  await publishPackages({ registry });
}

publishToVerdaccio();
