#!/usr/bin/env node

import { cp, mkdir, readdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function directoryIsEmpty(directoryPath) {
  try {
    const entries = await readdir(directoryPath);
    return entries.length === 0;
  } catch {
    return true;
  }
}

async function ensureEmptyDirectory(targetPath) {
  try {
    const info = await stat(targetPath);
    if (!info.isDirectory()) {
      throw new Error(`Target path exists and is not a directory: ${targetPath}`);
    }
    const empty = await directoryIsEmpty(targetPath);
    if (!empty) {
      throw new Error(`Target directory is not empty: ${targetPath}`);
    }
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      await mkdir(targetPath, { recursive: true });
      return;
    }
    throw err;
  }
}

async function main() {
  const targetArg = process.argv[2] ?? 'agentview-app';

  const cwd = process.cwd();
  const targetDir = path.resolve(cwd, targetArg);

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const packageDir = path.resolve(__dirname, '..');
  const templateDir = path.join(packageDir, 'dist/template');

  await ensureEmptyDirectory(targetDir);

  await cp(templateDir, targetDir, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(templateDir, src);
      if (!rel || rel === '.') return true;
      // Extra safety filters (template should already be clean)
      if (rel.includes(`node_modules${path.sep}`) || rel === 'node_modules') return false;
      if (rel.includes(`.react-router${path.sep}`) || rel === '.react-router') return false;
      if (rel.startsWith('build' + path.sep) || rel === 'build') return false;
      return true;
    },
  });

  // npm strips `.gitignore` from published tarballs, so the template ships it as
  // `gitignore`; restore the dotfile name in the scaffolded project.
  await rename(path.join(targetDir, 'gitignore'), path.join(targetDir, '.gitignore')).catch(
    (err) => {
      if (err && err.code !== 'ENOENT') throw err;
    },
  );

  console.log(`\nSuccess! Created project at: ${targetDir}`);
  console.log('Next steps:');
  console.log(`  cd ${path.relative(cwd, targetDir) || '.'}`);
  console.log('  npm install');
  console.log('  cp .env.example .env.local   # then add your OPENAI_API_KEY');
  console.log('  npm run dev:agentview        # connects your project to AgentView');
  console.log('  npm run dev                  # starts the app');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
