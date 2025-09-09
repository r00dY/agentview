#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = process.cwd();
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
  for (const rel of PACKAGES) {
    const pkgPath = path.join(REPO_ROOT, rel, 'package.json');
    try {
      const pkg = await readJSON(pkgPath);
      pkg.version = version;
      await writeJSON(pkgPath, pkg);
    } catch {}
  }
}

async function buildPackages() {
  for (const rel of PACKAGES) {
    run('npm run build', { cwd: path.join(REPO_ROOT, rel) });
  }
}

async function gitCommitAndTag(version) {
  const filesToAdd = ['package.json', ...PACKAGES.map(p => path.join(p, 'package.json'))];
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

  await buildPackages();

  bumpRootVersion(bumpType, preid);
  const version = await getRootVersion();

  await setPackagesVersion(version);

  await gitCommitAndTag(version);

  await publishPackages(version);

  console.log(`\nPublished v${version}`);
})();
