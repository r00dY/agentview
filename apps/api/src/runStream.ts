import { redisPublisher } from './redis';
import { createRedisStreamConsumer } from './redisStreamConsumer';
import type { RunTerminationReason } from './runs';
import Redis from 'ioredis';
import { REDIS_URL } from './redis';


const streamKey = (runId: string) => `run-stream:agentview:${runId}`;

// --- Publishing (shared connection) ---

export async function publishRunStreamEvent(runId: string, createdAt: string | null, data: string) {
  const key = streamKey(runId);
  const ms = createdAt ? new Date(createdAt).getTime() : Date.now();
  await redisPublisher.xadd(key, `${ms}-*`, 'data', data);

  if (data === '[DONE]') {
    await redisPublisher.expire(key, 60);
  }
}

// --- Consuming (dedicated connection per consumer) ---

export function createRunStreamConsumer(runId: string, signal: AbortSignal) {
  const consumer = createRedisStreamConsumer(streamKey(runId), signal);

  async function* entries() {
    for await (const data of consumer.entries()) {
      if (data === '[DONE]') return;
      yield data;
    }
  }

  return { entries, close: consumer.close };
}

// Terminations

const runTerminationsChannel = `run-terminations`;

export async function publishRunTerminationEvent(runId: string, reason: RunTerminationReason) {
  redisPublisher.publish(runTerminationsChannel, JSON.stringify({
    runId,
    reason
  }));
}

export async function createRunTerminationReceiver() {
  const conn = new Redis(REDIS_URL);
  let closed = false;
  const listeners = new Map<string, Set<(reason: RunTerminationReason) => void>>();

  await conn.subscribe(runTerminationsChannel);

  conn.on('message', (_channel: string, message: string) => {
    const { runId, reason } = JSON.parse(message) as { runId: string; reason: RunTerminationReason };
    const set = listeners.get(runId);
    if (set) {
      for (const cb of set) cb(reason);
    }
  });

  function listen(runId: string, cb: (reason: RunTerminationReason) => void) {
    let set = listeners.get(runId);
    if (!set) {
      set = new Set();
      listeners.set(runId, set);
    }
    set.add(cb);

    return () => {
      set!.delete(cb);
      if (set!.size === 0) listeners.delete(runId);
    };
  }

  function close() {
    if (closed) return;
    closed = true;
    listeners.clear();
    conn.disconnect();
  }

  return { listen, close };
}



// /**
//  * Calls `onFinished` when [DONE] appears on the run stream.
//  * Returns an AbortController — call .abort() to stop listening.
//  */
// export function onRunFinished(runId: string, onFinished: (body: AgentViewError) => void) {
//   const abortController = new AbortController();
//   const consumer = createRedisStreamConsumer(streamKey(runId), abortController.signal);

//   (async () => {
//     try {
//       for await (const data of consumer.entries()) {
//         if (data.startsWith('[DONE]')) {
//           const body : AgentViewRunFinishedErrorBody = JSON.parse(data.slice('[DONE]'.length));
//           const error = new AgentViewError("Run finished.", 400, {
//             code: "run.finished",
//             ...body
//           });
//           onFinished(error);
//           return;
//         }
//       }
//     } catch {
//       // Expected on cleanup
//     } finally {
//       consumer.close();
//     }
//   })();

//   return abortController;
// }
