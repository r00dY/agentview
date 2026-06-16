#!/usr/bin/env node
import path from 'node:path';
import { REPO_ROOT, PACKAGES, run, runQuiet, getRootVersion, readJSON } from './utils.mjs';

function getRegistry() {
  try {
    return runQuiet('npm config get registry', { cwd: REPO_ROOT });
  } catch {
    return '';
  }
}

export async function unpublishPackages() {
  const version = await getRootVersion();
  const registry = getRegistry();

  // Unpublishing is destructive. Only allow it against a local registry
  // (verdaccio) so a stray run can never yank a real published release.
  if (!/localhost|127\.0\.0\.1/.test(registry)) {
    console.error(`Refusing to unpublish: registry is "${registry}".`);
    console.error('This only runs against a local registry (e.g. verdaccio).');
    console.error('Point npm at it first, e.g.: export npm_config_registry=http://localhost:4873');
    process.exit(1);
  }

  console.log(`Unpublishing v${version} from ${registry}...\n`);

  for (const rel of PACKAGES) {
    const pkg = await readJSON(path.join(REPO_ROOT, rel, 'package.json'));
    const spec = `${pkg.name}@${version}`;
    console.log(`Unpublishing ${spec}...`);
    try {
      run(`npm unpublish ${spec} --registry ${registry} --force`, { cwd: path.join(REPO_ROOT, rel) });
    } catch {
      console.log(`  (not published at this version — skipping)`);
    }
  }

  console.log(`\nDone. You can now republish v${version} to ${registry}.`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  unpublishPackages();
}
