import { Redis } from 'ioredis';
import { REDIS_URL } from './redis';
import { type Context } from 'hono';
import { ServerResponse } from 'http';


/**
 * Raw implementation: pooled Redis XREAD → outgoing.write(). No WebStreams, no consumer helpers.
 * The [RESPONSE] meta-event determines whether we stream SSE or return an error body.
 */
export function createStreamResponse(c: Context, runId: string, _options?: { headers?: Headers, status?: number }) {
    const outgoing = (c.env as any).outgoing as ServerResponse;
    const signal: AbortSignal = c.req.raw.signal;
    const streamKey = `run-stream:ai-sdk:${runId}`;
  
    let unsubscribe: (() => void) | null = null;
    let closed = false;
  
    function cleanup() {
      if (closed) return;
      closed = true;
      signal.removeEventListener('abort', cleanup);
      unsubscribe?.();
    }
  
    signal.addEventListener('abort', cleanup, { once: true });
  
    // IMPORTANT TODO: translate headers from Response!!!
    outgoing.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
  
    unsubscribe = subscribeToStream(
      streamKey,
      (data) => {
        if (closed) return false;
  
        if (data === '[DONE]') {
          outgoing.end();
          cleanup();
          return false;
        }
  
        outgoing.write(`data: ${data}\n\n`);
        return true;
      },
      () => {
        if (!closed) {
          outgoing.end();
          cleanup();
        }
      },
    );
  
    return new Response(null, { headers: { 'x-hono-already-sent': '1' } });
  }
  






const MAX_STREAMS_PER_CONN = 200;
const POOL_BLOCK_MS = 1000;

/** Callback receives each stream entry's data. Return false to unsubscribe. */
type StreamDataCallback = (data: string) => boolean;

interface StreamSub {
  streamKey: string;
  lastId: string;
  callback: StreamDataCallback;
  onError: () => void;
}

class PooledRedisConnection {
  private conn: Redis;
  private subs = new Map<string, StreamSub>();
  private polling = false;
  private closed = false;

  constructor() {
    this.conn = new Redis(REDIS_URL);
  }

  get size() { return this.subs.size; }
  get isClosed() { return this.closed; }

  add(sub: StreamSub) {
    this.subs.set(sub.streamKey, sub);
    if (!this.polling) this.poll();
  }

  remove(streamKey: string) {
    this.subs.delete(streamKey);
  }

  private poll() {
    if (this.closed || this.subs.size === 0) {
      this.polling = false;
      if (this.subs.size === 0) this.destroy();
      return;
    }
    this.polling = true;

    const keys: string[] = [];
    const ids: string[] = [];
    for (const sub of this.subs.values()) {
      keys.push(sub.streamKey);
      ids.push(sub.lastId);
    }

    this.conn.xread('BLOCK', POOL_BLOCK_MS, 'STREAMS', ...keys, ...ids)
      .then((results) => {
        if (this.closed) return;
        if (results) {
          for (const [streamKey, entries] of results) {
            const sub = this.subs.get(streamKey);
            if (!sub) continue;
            for (const [id, fields] of entries) {
              sub.lastId = id;
              const data = fields[1];
              if (!sub.callback(data)) {
                this.subs.delete(streamKey);
                break;
              }
            }
          }
        }
        this.poll();
      })
      .catch(() => {
        for (const sub of this.subs.values()) sub.onError();
        this.destroy();
      });
  }

  private destroy() {
    if (this.closed) return;
    this.closed = true;
    this.subs.clear();
    this.conn.disconnect();
    const idx = streamPool.indexOf(this);
    if (idx !== -1) streamPool.splice(idx, 1);
  }
}

const streamPool: PooledRedisConnection[] = [];

function subscribeToStream(
  streamKey: string,
  callback: StreamDataCallback,
  onError: () => void,
): () => void {
  let poolConn = streamPool.find(c => c.size < MAX_STREAMS_PER_CONN);
  if (!poolConn) {
    poolConn = new PooledRedisConnection();
    streamPool.push(poolConn);
  }

  poolConn.add({ streamKey, lastId: '0-0', callback, onError });

  const conn = poolConn;
  return () => {
    conn.remove(streamKey);
    if (conn.size === 0 && !conn.isClosed) {
      // destroy is handled by the next poll() cycle seeing 0 subs
    }
  };
}
