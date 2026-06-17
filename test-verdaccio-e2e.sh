#!/usr/bin/env bash
#
# Local Verdaccio end-to-end test of the "real" consumer workflow.
#
# Simulates exactly what a user does after we publish a release, but against a
# local Verdaccio registry instead of npmjs:
#
#   build → publish to Verdaccio → `npm create agentview` in a scratch dir
#   (outside the monorepo) → verify scaffold version → `npm install` →
#   verify Next.js builds → verify the `agentview` CLI is installed & runnable.
#
# Prereqs:
#   - Verdaccio running locally on the registry from .env.local (VERDACCIO_REGISTRY).
#   - You are logged in to it (npm adduser) OR it allows anonymous publish.
#
# Usage:
#   ./test-verdaccio-e2e.sh
#
set -euo pipefail

# ----------------------------------------------------------------------------
# Setup
# ----------------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$REPO_ROOT")"

cyan()  { printf '\033[36m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
step()  { printf '\n\033[1;36m=== %s ===\033[0m\n' "$*"; }

# Pull dev config (registry + dev URLs) from the root .env.local. Sourcing with
# `set -a` exports them and expands the `$AGENTVIEW_*_PORT` interpolations,
# since the ports are defined earlier in the same file.
if [[ ! -f "$REPO_ROOT/.env.local" ]]; then
  red "Missing $REPO_ROOT/.env.local — cannot determine registry / dev URLs."
  exit 1
fi
set -a
# shellcheck disable=SC1091
source "$REPO_ROOT/.env.local"
set +a

: "${VERDACCIO_REGISTRY:?VERDACCIO_REGISTRY not set in .env.local}"

# Force every npm / npx / npm-create call below to use Verdaccio.
export npm_config_registry="$VERDACCIO_REGISTRY"

# Make the studio CLI + SDK talk to the *dev* backend instead of production.
export AGENTVIEW_API_URL="${AGENTVIEW_API_URL:?}"
export AGENTVIEW_WEBAPP_URL="${AGENTVIEW_WEBAPP_URL:?}"
export AGENTVIEW_EMAIL_ROOT_DOMAIN="${AGENTVIEW_EMAIL_ROOT_DOMAIN:?}"

VERSION="$(node -p "require('$REPO_ROOT/package.json').version")"
TEST_NAME="agentview-test-${VERSION}"
TEST_DIR="$PARENT_DIR/$TEST_NAME"

cyan "Repo root:        $REPO_ROOT"
cyan "Registry:         $VERDACCIO_REGISTRY"
cyan "Monorepo version: $VERSION"
cyan "Scratch project:  $TEST_DIR"
cyan "Dev API URL:      $AGENTVIEW_API_URL"
cyan "Dev WebApp URL:   $AGENTVIEW_WEBAPP_URL"
cyan "Dev Email domain: $AGENTVIEW_EMAIL_ROOT_DOMAIN"

# ----------------------------------------------------------------------------
# 1. Build + publish to Verdaccio
# ----------------------------------------------------------------------------
# `release:publish:verdaccio` auto-yanks the current version first, so it's safe
# to re-run. It does NOT build, and it does NOT regenerate create-agentview's
# template — so we build first to embed the correct `^${VERSION}` deps.
step "1. Build + publish to Verdaccio"
cd "$REPO_ROOT"
pnpm run release:build
pnpm run release:publish:verdaccio

# ----------------------------------------------------------------------------
# 2./3. Scaffold a fresh project one level above the monorepo
# ----------------------------------------------------------------------------
step "2./3. Scaffold via 'npm create agentview' (Verdaccio)"
# npx caches same-version tarballs; nuke it so we fetch the freshly published one.
rm -rf "$HOME/.npm/_npx"
rm -rf "$TEST_DIR"
cd "$PARENT_DIR"
# npm_config_registry (exported above) makes both the create-agentview fetch and
# the scaffold use Verdaccio. Pin the version so we exercise this exact release.
npm create "agentview@${VERSION}" "$TEST_NAME"

if [[ ! -d "$TEST_DIR" ]]; then
  red "Scaffold failed: $TEST_DIR was not created."
  exit 1
fi
green "Scaffolded $TEST_DIR"

# ----------------------------------------------------------------------------
# 4. Verify the scaffold pins the expected (monorepo) version
# ----------------------------------------------------------------------------
step "4. Verify scaffolded dependency versions"
for dep in agentview @agentview/studio; do
  declared="$(node -p "require('$TEST_DIR/package.json').dependencies['$dep'] || ''")"
  cyan "  $dep -> $declared"
  if [[ "$declared" != *"$VERSION"* ]]; then
    red "Expected '$dep' to reference version $VERSION, got '$declared'."
    exit 1
  fi
done
green "Scaffold pins version $VERSION ✓"

# ----------------------------------------------------------------------------
# 5./6. Install dependencies (Verdaccio)
# ----------------------------------------------------------------------------
step "5./6. npm install (Verdaccio)"
cd "$TEST_DIR"
# Belt-and-suspenders: also write a local .npmrc so the install is auditably
# pinned to Verdaccio regardless of ambient npm config.
printf 'registry=%s\n' "$VERDACCIO_REGISTRY" > .npmrc
npm install

# Verify the *installed* (resolved) agentview version is exactly this release.
installed="$(node -p "require('$TEST_DIR/node_modules/agentview/package.json').version")"
cyan "  installed agentview version: $installed"
if [[ "$installed" != "$VERSION" ]]; then
  red "Installed agentview is $installed, expected $VERSION."
  exit 1
fi
green "Installed agentview@$installed ✓"

# Provide dev env for the Next app (build-time NEXT_PUBLIC_* + runtime vars).
cat > .env.local <<EOF
OPENAI_API_KEY=${OPENAI_API_KEY:-}

NEXT_PUBLIC_AGENTVIEW_API_URL=${AGENTVIEW_API_URL}
NEXT_PUBLIC_AGENTVIEW_WEBAPP_URL=${AGENTVIEW_WEBAPP_URL}
NEXT_PUBLIC_AGENTVIEW_EMAIL_ROOT_DOMAIN=${AGENTVIEW_EMAIL_ROOT_DOMAIN}

AGENTVIEW_API_URL=${AGENTVIEW_API_URL}
AGENTVIEW_WEBAPP_URL=${AGENTVIEW_WEBAPP_URL}
AGENTVIEW_EMAIL_ROOT_DOMAIN=${AGENTVIEW_EMAIL_ROOT_DOMAIN}
EOF

# ----------------------------------------------------------------------------
# 7. Verify Next.js builds
# ----------------------------------------------------------------------------
step "7. Verify Next.js (npm run build)"
npm run build
green "Next.js build succeeded ✓"

# ----------------------------------------------------------------------------
# 8. Verify the agentview CLI is present & runnable
# ----------------------------------------------------------------------------
step "8. Verify 'npx agentview' CLI"
# --help short-circuits before the onboarding/browser flow, so this just proves
# the bin resolves and the (tsx-bootstrapped) CLI actually runs.
cli_out="$(npx --no-install agentview --help 2>&1)" || {
  red "npx agentview --help failed:"
  printf '%s\n' "$cli_out"
  exit 1
}
printf '%s\n' "$cli_out"
if ! grep -qi "agentview" <<< "$cli_out"; then
  red "CLI output did not look like the agentview CLI."
  exit 1
fi
green "agentview CLI is installed and runnable ✓"

# ----------------------------------------------------------------------------
step "DONE"
green "Verdaccio e2e passed for v$VERSION"
cyan "Scratch project left at: $TEST_DIR"
