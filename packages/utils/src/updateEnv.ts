import { writeFileSync, existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from "node:path";
import { getMonorepoRootPath } from "./getMonorepoRootPath";

export function updateEnvFile(envFilePath: string, key: string, value: string) {
  let envContents = '';
  if (existsSync(envFilePath)) {
    envContents = readFileSync(envFilePath, 'utf8');
    // Remove existing key line if present
    // Escape special regex characters in the key
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keyPattern = new RegExp(`^${escapedKey}\\s*=`);
    envContents = envContents
      .split('\n')
      .filter(line => !keyPattern.test(line))
      .join('\n');
    if (envContents.length > 0 && !envContents.endsWith('\n')) {
      envContents += '\n';
    }
  } else {
    console.error(`Env file ${envFilePath} does not exist`);
    process.exit(1);
  }

  envContents += `${key}=${value}\n`;
  writeFileSync(envFilePath, envContents, 'utf8');
}

export function updateEnv(relativePath: string, key: string, value: string) {
  const envFilePath = path.join(getMonorepoRootPath(), relativePath);
  updateEnvFile(envFilePath, key, value);
}

export function updateEnvAcrossExamples(key: string, value: string, options?: { includeExamples?: boolean, includeRoot?: boolean }) {
  const includeExamples = options?.includeExamples ?? true;
  const includeRoot = options?.includeRoot ?? true;

  const monorepoRoot = getMonorepoRootPath();

  // Update root .env (required - exit if doesn't exist)
  if (includeRoot) {
    const rootEnvFilePath = path.join(monorepoRoot, ".env");
    updateEnvFile(rootEnvFilePath, key, value);
  }
  
  // Update .env files in all example projects
  if (includeExamples) {
    const examplesDir = path.join(monorepoRoot, "apps", "examples");
    if (existsSync(examplesDir)) {
      const entries = readdirSync(examplesDir);
      for (const entry of entries) {
        const entryPath = path.join(examplesDir, entry);
        const stats = statSync(entryPath);
        if (stats.isDirectory()) {
          const exampleEnvPath = path.join(entryPath, ".env");
          updateEnvFile(exampleEnvPath, key, value);
        }
      }
    }
  }
}
