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
        process(item)
          .catch((error) => {
            console.error(`[${name}] Unhandled error:`, error);
          })
          .finally(() => {
            inFlight--;
          });
      }
    } catch (error) {
      console.error(`[${name}] Claim error:`, error);
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

// -- Event-driven worker with fallback poll --

export interface EventDrivenWorkerConfig<T> {
  name: string;
  fallbackPollIntervalMs: number;
  maxConcurrency: number;
  claim: (limit: number) => Promise<T[]>;
  process: (item: T) => Promise<void>;
  /** Called once on start. Should invoke `onEvent` whenever new work may be available. */
  subscribe: (onEvent: () => void) => { close: () => void };
}

export function createEventDrivenWorker<T>(config: EventDrivenWorkerConfig<T>): WorkerHandle {
  const { name, fallbackPollIntervalMs, maxConcurrency, claim, process, subscribe } = config;

  let inFlight = 0;
  let isPolling = false;
  let pendingWakeup = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let subscription: { close: () => void } | null = null;

  async function poll() {
    if (isPolling) {
      pendingWakeup = true;
      return;
    }
    const available = maxConcurrency - inFlight;
    if (available <= 0) {
      pendingWakeup = true;
      return;
    }

    isPolling = true;
    try {
      const items = await claim(available);
      for (const item of items) {
        inFlight++;
        process(item)
          .catch((error) => {
            console.error(`[${name}] Unhandled error:`, error);
          })
          .finally(() => {
            inFlight--;
          });
      }
    } catch (error) {
      console.error(`[${name}] Claim error:`, error);
    } finally {
      isPolling = false;
      if (pendingWakeup) {
        pendingWakeup = false;
        poll();
      }
    }
  }

  return {
    start() {
      subscription = subscribe(() => poll());
      poll(); // immediate first poll to pick up anything pending
      timer = setInterval(poll, fallbackPollIntervalMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      subscription?.close();
      subscription = null;
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
