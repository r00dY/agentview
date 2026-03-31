import Redis from 'ioredis';
import { redisPublisher, REDIS_URL } from './redis';
import type { RunTerminationReason } from './runs';

// -- Event types (discriminated union) --

export type PubSubEvent =
  | { type: 'run.created'; runId: string }
  | { type: 'run.terminated'; runId: string; reason: RunTerminationReason };

const CHANNEL = 'agentview-events';

// -- Publishing (uses shared redisPublisher connection) --

export function publishEvent(event: PubSubEvent) {
  return redisPublisher.publish(CHANNEL, JSON.stringify(event));
}

// -- Subscribing (one dedicated connection per process that imports this) --

type ExtractEvent<T extends PubSubEvent['type']> = Extract<PubSubEvent, { type: T }>;

export interface EventReceiver {
  /**
   * Listen for events of a specific type.
   * Optionally filter by runId for per-run listeners (e.g. termination).
   * Returns an unsubscribe function.
   */
  on<T extends PubSubEvent['type']>(
    type: T,
    cb: (event: ExtractEvent<T>) => void,
  ): () => void;
  on<T extends PubSubEvent['type']>(
    type: T,
    runId: string,
    cb: (event: ExtractEvent<T>) => void,
  ): () => void;

  close(): void;
}

let _receiverPromise: Promise<EventReceiver> | null = null;

/**
 * Returns a singleton EventReceiver. The Redis subscriber connection is created
 * on first call and reused for the lifetime of the process.
 * Only call this from worker processes — the HTTP server should not subscribe.
 */
export function getEventReceiver(): Promise<EventReceiver> {
  if (!_receiverPromise) {
    _receiverPromise = _createEventReceiver();
  }
  return _receiverPromise;
}

async function _createEventReceiver(): Promise<EventReceiver> {
  const conn = new Redis(REDIS_URL);
  let closed = false;

  // type -> (runId | '*') -> callbacks
  const listeners = new Map<string, Map<string, Set<(event: any) => void>>>();

  await conn.subscribe(CHANNEL);

  conn.on('message', (_channel: string, message: string) => {
    const event = JSON.parse(message) as PubSubEvent;
    const byKey = listeners.get(event.type);
    if (!byKey) return;

    // fire key-specific listeners
    const runId = 'runId' in event ? event.runId : undefined;
    if (runId) {
      const set = byKey.get(runId);
      if (set) for (const cb of set) cb(event);
    }

    // fire wildcard listeners
    const wildcardSet = byKey.get('*');
    if (wildcardSet) for (const cb of wildcardSet) cb(event);
  });

  function on(type: string, cbOrRunId: any, maybeCb?: any): () => void {
    const runId: string = typeof cbOrRunId === 'string' ? cbOrRunId : '*';
    const cb: (event: any) => void = typeof cbOrRunId === 'function' ? cbOrRunId : maybeCb;

    let byKey = listeners.get(type);
    if (!byKey) {
      byKey = new Map();
      listeners.set(type, byKey);
    }

    let set = byKey.get(runId);
    if (!set) {
      set = new Set();
      byKey.set(runId, set);
    }
    set.add(cb);

    return () => {
      set!.delete(cb);
      if (set!.size === 0) byKey!.delete(runId);
      if (byKey!.size === 0) listeners.delete(type);
    };
  }

  function close() {
    if (closed) return;
    closed = true;
    listeners.clear();
    conn.disconnect();
  }

  return { on, close };
}
