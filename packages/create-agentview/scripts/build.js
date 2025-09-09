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

  // Generate docker-compose.yml into the template to run backend easily
  const version = process.env.AGENTVIEW_VERSION || 'latest';
  const apiImageRepo = process.env.AGENTVIEW_API_IMAGE || '';

  if (apiImageRepo) {
    const compose = `services:\n  postgres-db:\n    image: postgres:15\n    environment:\n      POSTGRES_DB: postgres\n      POSTGRES_USER: postgres\n      POSTGRES_PASSWORD: postgres\n    ports:\n      - \"5432:5432\"\n    volumes:\n      - pgdata:/var/lib/postgresql/data\n\n  api:\n    image: ${apiImageRepo}:${version}\n    environment:\n      POSTGRES_DB: postgres\n      POSTGRES_USER: postgres\n      POSTGRES_PASSWORD: postgres\n      STUDIO_URL: http://localhost:1989\n    ports:\n      - \"8080:8080\"\n    depends_on:\n      - postgres-db\n    extra_hosts:\n      - \"host.docker.internal:host-gateway\"\n\n    restart: unless-stopped\n\nvolumes:\n  pgdata:\n`;

    await writeFile(path.join(templateDest, 'docker-compose.yml'), compose, 'utf8');
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
