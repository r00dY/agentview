export interface PeriodicWorkerConfig {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
}

export interface WorkerHandle {
  start(): void;
  stop(): void;
}

export function createPeriodicWorker(config: PeriodicWorkerConfig): WorkerHandle {
  const { name, intervalMs, run } = config;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function execute() {
    try {
      await run();
    } catch (error) {
      console.error(`[${name}] Error:`, error);
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
