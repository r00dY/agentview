import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The example project that becomes the scaffolded template.
const EXAMPLE = 'ai-sdk-demo';

function isExcluded(relativePath) {
  if (!relativePath || relativePath === '.') return false;

  const segs = relativePath.split(path.sep);
  const base = segs[segs.length - 1];

  if (segs.includes('node_modules')) return true;
  if (segs.includes('.react-router')) return true;
  if (segs.includes('.next')) return true;
  if (segs.includes('build') || segs.includes('dist') || segs.includes('coverage')) return true;
  // Never ship secrets: any .env / .env.* file — except the committed .env.example.
  if ((base === '.env' || base.startsWith('.env.')) && base !== '.env.example') return true;
  if (base === '.DS_Store') return true;
  if (base === 'package-lock.json') return true;
  if (base === 'tsconfig.tsbuildinfo') return true;
  if (base === 'next-env.d.ts') return true;
  return false;
}

function updateWorkspaceDependencies(packageJson, repoVersion) {
  const updatedPkg = { ...packageJson };
  const patchFields = ['dependencies', 'devDependencies'];
  const isWorkspaceDep = v => typeof v === 'string' && v.startsWith('workspace:');
  for (const field of patchFields) {
    if (updatedPkg[field]) {
      updatedPkg[field] = { ...updatedPkg[field] };
      for (const [depName, depVersion] of Object.entries(updatedPkg[field])) {
        if (isWorkspaceDep(depVersion)) {
          updatedPkg[field][depName] = `^${repoVersion}`;
        }
      }
    }
  }
  return updatedPkg;
}

const GITIGNORE = `# dependencies
node_modules

# next.js
.next
out

# production
build
dist

# misc
.DS_Store
*.tsbuildinfo
next-env.d.ts

# env files (keep secrets out of git)
.env
.env*.local
`;

async function buildTemplate() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const packageDir = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(packageDir, '..', '..');

  const exampleSrc = path.join(repoRoot, 'apps', 'examples', EXAMPLE);
  const distDir = path.join(packageDir, 'dist/');
  const templateDir = path.join(packageDir, 'dist/template');

  // clean
  await rm(distDir, { recursive: true, force: true });
  await mkdir(templateDir, { recursive: true });

  // copy files
  await cp(exampleSrc, templateDir, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(exampleSrc, src);
      return !isExcluded(rel);
    },
  });

  // get current version (used to pin workspace deps)
  const repoPkgJsonPath = path.join(repoRoot, 'package.json');
  const repoPkgRaw = await readFile(repoPkgJsonPath, 'utf8');
  const repoPkg = JSON.parse(repoPkgRaw);
  const version = repoPkg.version;

  // rewrite package.json into a standalone, installable project
  const pkgJsonPath = path.join(templateDir, 'package.json');
  const pkgRaw = await readFile(pkgJsonPath, 'utf8');
  const pkg = JSON.parse(pkgRaw);

  const updatedPkg = updateWorkspaceDependencies(pkg, version);
  updatedPkg.name = 'my-agentview-app';
  updatedPkg.version = '0.0.1';
  if (updatedPkg.private) delete updatedPkg.private;
  await writeFile(pkgJsonPath, JSON.stringify(updatedPkg, null, 2) + '\n', 'utf8');

  // The example ships its own .env.example (copied above). Provide a .gitignore:
  // npm strips files named `.gitignore` from published tarballs, so ship it as
  // `gitignore` and let the scaffolder (bin/index.js) rename it on copy.
  await writeFile(path.join(templateDir, 'gitignore'), GITIGNORE, 'utf8');

  console.log(`Template built from apps/examples/${EXAMPLE} (v${version}).`);
}

(async () => {
  await buildTemplate();
})();
