import { Session } from 'node:inspector/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { log } from '../logger';

let session: Session | null = null;

export async function startCpuProfiling(): Promise<void> {
  if (session) {
    log.warn('[profiler] already running');
    return;
  }
  session = new Session();
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.setSamplingInterval', { interval: 200 });
  await session.post('Profiler.start');
  log.info('[profiler] CPU profiler started');
}

export async function stopCpuProfiling(): Promise<string | null> {
  if (!session) {
    log.warn('[profiler] not running');
    return null;
  }
  const { profile } = await session.post('Profiler.stop') as { profile: unknown };
  await session.post('Profiler.disable');
  session.disconnect();
  session = null;

  const dir = resolvePath(process.cwd(), 'logs', 'cpu-profiles');
  mkdirSync(dir, { recursive: true });
  const filepath = resolvePath(dir, `streaming-${Date.now()}.cpuprofile`);
  writeFileSync(filepath, JSON.stringify(profile));
  log.info({ filepath }, '[profiler] CPU profile written');
  return filepath;
}
