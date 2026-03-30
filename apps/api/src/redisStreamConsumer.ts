import Redis from 'ioredis';
import { REDIS_URL } from './redis';

/**
 * Dedicated Redis connection that consumes a single Redis Stream.
 *
 * Opens its own connection so it can use XREAD BLOCK without monopolising
 * the shared app connection. Closing is handled via close() or AbortSignal.
 *
 * Usage:
 *   const consumer = createRedisStreamConsumer('my-stream:123', signal);
 *   try {
 *     for await (const entry of consumer.entries()) { ... }
 *   } finally {
 *     consumer.close();
 *   }
 */

const BLOCK_TIMEOUT_MS = 1000;

export interface RedisStreamConsumer {
  /** Yields stream entry values. Blocks efficiently until new data arrives. */
  entries(): AsyncGenerator<string>;
  /** Closes the dedicated Redis connection. Safe to call multiple times. */
  close(): void;
}

export function createRedisStreamConsumer(key: string, signal: AbortSignal, options?: { startId?: string }): RedisStreamConsumer {
  const conn = new Redis(REDIS_URL);
  let lastId = options?.startId ?? '0-0';
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    signal.removeEventListener('abort', close);
    conn.disconnect(); // Kills TCP socket, interrupting any in-flight BLOCK.
  }

  // Safety net — clean up if the request is aborted.
  signal.addEventListener('abort', close, { once: true });

  async function* entries(): AsyncGenerator<string> {
    try {
      while (!closed) {
        // BLOCK is safe — this is a dedicated connection.
        // Timeout just lets us re-check `closed` periodically.
        const results = await conn.xread('BLOCK', BLOCK_TIMEOUT_MS, 'STREAMS', key, lastId);
        if (closed) return;
        if (!results) continue;

        for (const [, entries] of results) {
          for (const [id, fields] of entries) {
            lastId = id;
            yield fields[1];
          }
        }
      }
    } catch(error: unknown) {
      // conn.disconnect() interrupts a blocked XREAD with a connection error.
      // That's expected on cleanup — just stop iterating.
      if (closed) return;

      throw error;
    }
  }

  return { entries, close };
}
