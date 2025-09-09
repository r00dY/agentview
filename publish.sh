#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./publish.sh [patch|minor|major|prerelease] [preid]
# Defaults to: patch
# Examples:
#   ./publish.sh                    # patch
#   ./publish.sh minor              # minor
#   ./publish.sh major              # major
#   ./publish.sh prerelease beta    # prerelease with preid=beta -> x.y.z-beta.N

# Config: list of package directories to bump and publish
PACKAGES=(
  "packages/create-agentview"
)

BUMP_TYPE="${1:-patch}"
PREID="${2:-}"

if [[ "$BUMP_TYPE" != "patch" && "$BUMP_TYPE" != "minor" && "$BUMP_TYPE" != "major" && "$BUMP_TYPE" != "prerelease" ]]; then
  echo "Unknown bump type: $BUMP_TYPE" >&2
  echo "Valid types: patch | minor | major | prerelease" >&2
  exit 1
fi

# Ensure we are at repo root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "node is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }

# Helper to read JSON field with node (avoid requiring jq)
read_json_field() {
  local file="$1"
  local field="$2"
  node -e "console.log(JSON.parse(require('fs').readFileSync('$file','utf8')).$field)"
}

# Bump versions for all packages (no git tagging yet)
for pkg in "${PACKAGES[@]}"; do
  if [[ ! -f "$pkg/package.json" ]]; then
    echo "Skipping $pkg (no package.json)"
    continue
  fi
  pushd "$pkg" >/dev/null
  if [[ "$BUMP_TYPE" == "prerelease" ]]; then
    if [[ -z "$PREID" ]]; then
      echo "Prerelease requires a preid (e.g. beta, rc)." >&2
      exit 1
    fi
    npm version prerelease --preid "$PREID" --no-git-tag-version
  else
    npm version "$BUMP_TYPE" --no-git-tag-version
  fi
  popd >/dev/null
done

# Infer the unified version from the first package
ROOT_VERSION=$(read_json_field "${PACKAGES[0]}/package.json" version)
if [[ -z "$ROOT_VERSION" ]]; then
  echo "Failed to read version" >&2
  exit 1
fi

# Commit and tag
# Stage changed package.json files
for pkg in "${PACKAGES[@]}"; do
  if [[ -f "$pkg/package.json" ]]; then
    git add "$pkg/package.json"
  fi
done

git commit -m "chore(release): v$ROOT_VERSION"

git tag "v$ROOT_VERSION"

echo "Tagged v$ROOT_VERSION"

# Determine npm dist-tag
if [[ "$ROOT_VERSION" == *-* ]]; then
  # Extract preid from semver like 1.2.3-beta.4 -> beta
  NPM_TAG="$(echo "$ROOT_VERSION" | sed -E 's/^[0-9]+\.[0-9]+\.[0-9]+-([a-zA-Z0-9]+).*$/\1/')"
else
  NPM_TAG="latest"
fi

# Publish packages
for pkg in "${PACKAGES[@]}"; do
  if [[ ! -f "$pkg/package.json" ]]; then
    continue
  fi
  echo "Publishing $pkg with dist-tag=$NPM_TAG"
  pushd "$pkg" >/dev/null
  npm publish --tag "$NPM_TAG"
  popd >/dev/null
done

echo "Published version $ROOT_VERSION with tag $NPM_TAG"
