import { log, runWithContext } from '../logger';

export interface WorkerHandle {
  start(): void;
  stop(): void;
}

// -- Concurrency-controlled poll loop --

export interface WorkerConfig<T> {
  name: string;
  pollIntervalMs: number;
  maxConcurrency: number;
  claim: (limit: number) => Promise<T[]>;
  process: (item: T) => Promise<void>;
}

export function createWorker<T>(config: WorkerConfig<T>): WorkerHandle {
  const { name, pollIntervalMs, maxConcurrency, claim, process } = config;

  let inFlight = 0;
  let isPolling = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function poll() {
    if (isPolling) return;
    const available = maxConcurrency - inFlight;
    if (available <= 0) return;

    isPolling = true;
    try {
      const items = await claim(available);
      for (const item of items) {
        inFlight++;
        runWithContext({ workerName: name }, () =>
          process(item)
            .catch((error) => {
              log.error({ err: error, workerName: name }, 'unhandled error');
            })
            .finally(() => {
              inFlight--;
            })
        );
      }
    } catch (error) {
      log.error({ err: error, workerName: name }, 'claim error');
    } finally {
      isPolling = false;
    }
  }

  return {
    start() {
      poll();
      timer = setInterval(poll, pollIntervalMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

// -- Simple periodic runner --

export interface PeriodicWorkerConfig {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
}

export function createPeriodicWorker(config: PeriodicWorkerConfig): WorkerHandle {
  const { name, intervalMs, run } = config;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function execute() {
    try {
      await run();
    } catch (error) {
      log.error({ err: error, workerName: name }, 'periodic worker error');
    }
  }

  return {
    start() {
      execute();
      timer = setInterval(execute, intervalMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
