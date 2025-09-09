import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// import { execSync } from 'node:child_process';

function isExcluded(relativePath) {
  if (!relativePath || relativePath === '.') return false;

  const segs = relativePath.split(path.sep);
  if (segs.includes('node_modules')) return true;
  if (segs.includes('.react-router')) return true;
  if (segs[0] === 'build' || segs.includes('build')) return true;
  if (segs.includes('dist') || segs.includes('coverage')) return true;
  if (segs[segs.length - 1] === '.DS_Store') return true;
  if (segs[segs.length - 1] === 'package-lock.json') return true;
  return false;
}

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function buildTemplate() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const packageDir = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(packageDir, '..', '..');

  const studioSrc = path.join(repoRoot, 'apps', 'studio');
  const templateDest = path.join(packageDir, 'dist/template');

  if (await pathExists(templateDest)) {
    await rm(templateDest, { recursive: true, force: true });
  }
  await mkdir(templateDest, { recursive: true });

  await cp(studioSrc, templateDest, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(studioSrc, src);
      return !isExcluded(rel);
    },
  });

  const pkgJsonPath = path.join(templateDest, 'package.json');
  const pkgRaw = await readFile(pkgJsonPath, 'utf8');
  const pkg = JSON.parse(pkgRaw);
  pkg.name = 'my-agentview-app';
  pkg.version = '0.0.1';
  if (pkg.private) delete pkg.private;
  await writeFile(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  // Generate docker-compose.yml by reading apps/api/docker-compose.yml and replacing api.build with api.image
  const version = process.env.AGENTVIEW_VERSION || 'latest';
  const apiImageRepo = process.env.AGENTVIEW_API_IMAGE || 'rudzienki/agentview-api';

  const apiComposePath = path.join(repoRoot, 'apps', 'api', 'docker-compose.yml');
  try {
    let composeSrc = await readFile(apiComposePath, 'utf8');

    // Replace only the build directive under the api service with image: <repo>:<version>
    // This regex finds the line with two-space indent '  api:' and then replaces the first occurrence of a
    // line matching '    build: .' within that service block.
    composeSrc = composeSrc.replace(/(^\s*api:\s*[\s\S]*?)(^\s*build:\s*\.)/m, (match, prefix, buildLine) => {
      const imageLine = `    image: ${apiImageRepo}:${version}`;
      return match.replace(buildLine, imageLine);
    });

    await writeFile(path.join(templateDest, 'docker-compose.yml'), composeSrc, 'utf8');
  } catch (e) {
    // If reading or transforming fails, skip writing docker-compose.yml
  }

  // Provide default .env pointing studio to the API exposed by docker-compose
  const envContent = `VITE_AGENTVIEW_API_BASE_URL=http://localhost:8080\n`;
  await writeFile(path.join(templateDest, '.env'), envContent, 'utf8');
}

// async function publish() {
//   execSync('npm version prerelease --preid=test', { stdio: 'inherit' });
//   execSync('npm publish --tag test', { stdio: 'inherit' });
// }

(async () => {
  await buildTemplate();
  // await publish();
})();
