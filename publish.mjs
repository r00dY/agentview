#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = process.cwd();

// Packages whose versions should be kept in sync with the root version
const ALL_PACKAGES = [
  'apps/studio',
  'apps/api',
  'packages/create-agentview',
];

// Packages to build and publish (npm)
const PACKAGES = [
  'packages/create-agentview',
];

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function isRepoClean() {
  try {
    const out = execSync('git status --porcelain', { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
      .toString()
      .trim();
    return out.length === 0;
  } catch {
    return false;
  }
}

async function readJSON(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function writeJSON(filePath, data) {
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function getDistTagFromVersion(version) {
  if (!version.includes('-')) return 'latest';
  const m = version.match(/^[0-9]+\.[0-9]+\.[0-9]+-([A-Za-z0-9]+)/);
  return m ? m[1] : 'latest';
}

function isPrerelease(version) {
  return version.includes('-');
}

async function ensureRootPackageJson() {
  const rootPkgPath = path.join(REPO_ROOT, 'package.json');
  let rootPkg;
  try {
    rootPkg = await readJSON(rootPkgPath);
  } catch {
    rootPkg = { name: 'agentview-monorepo', private: true, version: '0.0.0', scripts: { publish: 'node ./publish.mjs' } };
    await writeJSON(rootPkgPath, rootPkg);
  }
  if (!rootPkg.scripts) rootPkg.scripts = {};
  if (!rootPkg.scripts.publish) rootPkg.scripts.publish = 'node ./publish.mjs';
  await writeJSON(rootPkgPath, rootPkg);
  return rootPkgPath;
}

function bumpRootVersion(bumpType, preid) {
  const base = 'npm version';
  const args = [bumpType, '--no-git-tag-version'];
  if (bumpType === 'prerelease') {
    if (!preid) throw new Error('Prerelease requires a preid (e.g. beta, rc)');
    args.splice(1, 0, `--preid=${preid}`);
  }
  run(`${base} ${args.join(' ')}`, { cwd: REPO_ROOT });
}

async function getRootVersion() {
  const pkg = await readJSON(path.join(REPO_ROOT, 'package.json'));
  return pkg.version;
}

async function setPackagesVersion(version) {
  for (const rel of ALL_PACKAGES) {
    const pkgPath = path.join(REPO_ROOT, rel, 'package.json');
    try {
      const pkg = await readJSON(pkgPath);
      pkg.version = version;
      await writeJSON(pkgPath, pkg);
    } catch {}
  }
}

function buildCreateAgentviewTemplate({ version, apiImageRepo }) {
  const cwd = path.join(REPO_ROOT, 'packages/create-agentview');
  run('npm run build', {
    cwd,
    env: { ...process.env, AGENTVIEW_VERSION: version, AGENTVIEW_API_IMAGE: apiImageRepo },
  });
}

function getApiDockerImageRepo() {
//   const repo = process.env.AGENTVIEW_API_IMAGE;
//   if (!repo) {
//     console.error('\nAGENTVIEW_API_IMAGE is not set. Please set it to your Docker image repo, e.g.:');
//     console.error('  export AGENTVIEW_API_IMAGE="your-dockerhub-username/agentview-api"\n');
//     process.exit(1);
//   }
//   return repo;
    return 'rudzienki/agentview-api';
}

function buildAndPushApiDockerImage(apiImageRepo, version) {
  const apiDir = path.join(REPO_ROOT, 'apps/api');
  const fullTag = `${apiImageRepo}:${version}`;

  console.log(`\nBuilding API Docker image: ${fullTag}`);
  run(`docker build -t ${fullTag} ${apiDir}`);

  if (!isPrerelease(version)) {
    const latestTag = `${apiImageRepo}:latest`;
    run(`docker tag ${fullTag} ${latestTag}`);
  }

  console.log(`\nPushing API Docker image: ${fullTag}`);
  run(`docker push ${fullTag}`);

  if (!isPrerelease(version)) {
    const latestTag = `${apiImageRepo}:latest`;
    run(`docker push ${latestTag}`);
  }
}

async function gitCommitAndTag(version) {
  const filesToAdd = ['package.json', ...ALL_PACKAGES.map(p => path.join(p, 'package.json'))];
  for (const f of filesToAdd) {
    try { run(`git add ${f}`, { cwd: REPO_ROOT }); } catch {}
  }
  run(`git commit -m "chore(release): v${version}"`, { cwd: REPO_ROOT });
  run(`git tag v${version}`, { cwd: REPO_ROOT });
}

async function publishPackages(version) {
  const tag = getDistTagFromVersion(version);
  for (const rel of PACKAGES) {
    run(`npm publish --tag ${tag}`, { cwd: path.join(REPO_ROOT, rel) });
  }
}

(async () => {
  if (!isRepoClean()) {
    console.error('Refusing to publish: repository has uncommitted changes. Commit or stash first.');
    process.exit(1);
  }

  const bumpType = process.argv[2] || 'patch';
  const preid = process.argv[3] || '';
  const valid = new Set(['patch', 'minor', 'major', 'prerelease']);
  if (!valid.has(bumpType)) {
    console.error('Usage: node publish.mjs [patch|minor|major|prerelease] [preid]');
    process.exit(1);
  }

  await ensureRootPackageJson();

  // 1) Bump versions first so builds can embed the correct version
  bumpRootVersion(bumpType, preid);
  const version = await getRootVersion();

  // 2) Sync package versions
  await setPackagesVersion(version);

  // 3) Build and push API Docker image
  const apiImageRepo = getApiDockerImageRepo();
  buildAndPushApiDockerImage(apiImageRepo, version);

  // 4) Build create-agentview template (writes docker-compose.yml pointing at the image above)
  buildCreateAgentviewTemplate({ version, apiImageRepo });

  // 5) Commit and tag
  await gitCommitAndTag(version);

  // 6) Publish npm packages
  await publishPackages(version);

  console.log(`\nPublished v${version}`);
})();
