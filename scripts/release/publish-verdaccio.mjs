#!/usr/bin/env node
import { publishPackages } from './publish.mjs';

// Force publishing to the local verdaccio registry, regardless of npm config.
// The registry URL must be provided explicitly via VERDACCIO_REGISTRY.
const registry = process.env.VERDACCIO_REGISTRY;
if (!registry) {
  console.error('Error: VERDACCIO_REGISTRY is not set.');
  console.error('Set it to your local registry, e.g.: export VERDACCIO_REGISTRY=http://localhost:4873');
  process.exit(1);
}

publishPackages({ registry });
