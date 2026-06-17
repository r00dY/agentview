#!/usr/bin/env node
import path from 'node:path';
import { REPO_ROOT, PACKAGES, run, getRootVersion, readJSON } from './utils.mjs';

export async function unpublishPackages() {
  const version = await getRootVersion();
  const registry = process.env.VERDACCIO_REGISTRY;

  // Unpublishing is destructive, so it only runs against an explicitly
  // provided local registry (verdaccio) — never the ambient npm config.
  if (!registry) {
    console.error('Error: VERDACCIO_REGISTRY is not set.');
    console.error('Set it to your local registry, e.g.: export VERDACCIO_REGISTRY=http://localhost:4873');
    process.exit(1);
  }

  // Double-guard: even if set, refuse anything that isn't a local registry so
  // a stray value can never yank a real published release.
  if (!/localhost|127\.0\.0\.1/.test(registry)) {
    console.error(`Refusing to unpublish: VERDACCIO_REGISTRY is "${registry}".`);
    console.error('This only runs against a local registry (e.g. verdaccio).');
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
