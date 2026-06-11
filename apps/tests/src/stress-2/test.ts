/**
 * Stress-2: streaming load test measuring end-to-end token latency AND how
 * strained every part of the pipeline was while the test ran.
 *
 *   agent server (run SEPARATELY — see agentServer.ts; prints its own usage under load)
 *     → AgentView streaming server (sampled via GET /api/streaming/utilization)
 *       → this process, the receiver (tracks its own CPU)
 *
 * Each token carries its emission timestamp (`providerMetadata.agentview.time`),
 * so latency = receive time - emit time. The stream spec (token count,
 * interval, jitter) is embedded in the run input, so the agent endpoint
 * needs no out-of-band configuration.
 *
 * Every stream is validated: the number of timestamped chunks received must
 * match the spec, and the run's final status must be 'completed'. Failed
 * streams are logged with their reason and EXCLUDED from latency results.
 *
 * Uses the `production` AgentView environment: the API server fetches the
 * agent URL directly, no tunnel proxy in the path.
 *
 * Usage:
 *   # 1. start the agent endpoint (separate terminal / machine):
 *   pnpm stress2:agent
 *
 *   # 2. run the test against the local stack:
 *   pnpm stress2 [N]
 *
 *   # against production (agent endpoint must be reachable by the prod API):
 *   STRESS_ENV=prod STRESS2_AGENT_URL=https://my-agent-host/agent pnpm stress2 [N]
 */
import http from 'node:http';
import https from 'node:https';
import { z } from 'zod';

import { updateEnvironment } from 'agentview/updateEnvironment';

import { setupTestOrg } from '../utils';
import { startCpuTracker, formatCpuSummary, summarize } from './cpuTracker';

// ---- Config ----
const N = Number(process.argv[2]) || 250;
const RAMP_UP_S = N / 20 // 50ms per stream creation
const MEASURE_S = RAMP_UP_S + 15 // measurement time is: last stream start + 15s; (15s under full load)

const STREAM_DURATION_S = MEASURE_S + 5 // stream duration: 5s longer than full measurement time. It makes sure first stream keeps going until measurement is finished.
const TOKENS_PER_SECOND = 100;
const JITTER_MS = 3;

// The spec each run carries in its input — the agent endpoint streams exactly this.
const STREAM_SPEC = {
  tokens: Math.round(TOKENS_PER_SECOND * STREAM_DURATION_S),
  intervalMs: 1000 / TOKENS_PER_SECOND,
  jitterMs: JITTER_MS,
};

const STRESS_ENV = process.env.STRESS_ENV ?? 'dev';
if (!['dev', 'prod'].includes(STRESS_ENV)) {
  throw new Error('STRESS_ENV must be either dev or prod');
}

if (STRESS_ENV === 'prod') {
  process.env.AGENTVIEW_API_URL = 'https://api.agentview.app';
}

if (!process.env.STRESS2_AGENT_URL) {
  throw new Error('STRESS2_AGENT_URL is not set');
}

// In prod the API server must be able to reach the agent server over the
// public internet.
const AGENT_URL = process.env.STRESS2_AGENT_URL;

const API_BASE = process.env.AGENTVIEW_API_URL;
if (!API_BASE) {
  throw new Error('AGENTVIEW_API_URL is not set');
}

console.log('------- stress-2 -------');
console.log('env:           ', STRESS_ENV);
console.log('api url:       ', API_BASE);
console.log('agent url:     ', AGENT_URL);
console.log('streams:       ', N);
console.log('tokens/s:      ', TOKENS_PER_SECOND, `(per stream, for ${STREAM_DURATION_S}s → ${STREAM_SPEC.tokens} tokens)`);
console.log('ramp up:       ', `${RAMP_UP_S}s`);
console.log('measure window:', `${MEASURE_S}s`);
console.log('');

// ---- Per-stream results ----

interface StreamResult {
  index: number;
  ok: boolean;
  reason?: string;
  sessionId?: string;
  /** timestamped chunks received (counted for the WHOLE stream, not just the measure window) */
  received: number;
  /** latency samples collected within the measure window */
  latencies: Float64Array;
  concurrencies: Uint16Array;
  sampleCount: number;
}

let activeStreams = 0;
let measureDeadline = Infinity;
let deadlinePrinted = false;

const TIME_KEY_BUF = Buffer.from('"time":"');
const QUOTE = 0x22; // '"'
// A full timestamped record is `"time":"<13 digits>"` ≈ 22 bytes. Keep enough
// tail from the previous chunk to catch records split across chunk boundaries.
const TAIL_LEN = 32;

// ---- percentile helpers ----
function percentile(sorted: Float64Array, p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function report(label: string, values: Float64Array) {
  if (values.length === 0) return;
  const sorted = values.slice().sort();
  console.log(
    `  ${label}: n=${sorted.length} p50=${percentile(sorted, 50).toFixed(1)}ms p90=${percentile(sorted, 90).toFixed(1)}ms p95=${percentile(sorted, 95).toFixed(1)}ms p99=${percentile(sorted, 99).toFixed(1)}ms max=${sorted[sorted.length - 1].toFixed(1)}ms`
  );
}

// ---- Streaming server utilization polling ----

interface StreamingSample { t: number; elu: number; cpu: number; conns: number; rss: number; heapUsed: number }

const streamingSamples: StreamingSample[] = [];
let streamingSince = 0;
let streamingPollFailed = false;

async function pollStreamingUtilization() {
  try {
    const res = await fetch(`${API_BASE}/api/streaming/utilization?since=${streamingSince}`, {
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.json();
    for (const s of body.samples as StreamingSample[]) {
      streamingSamples.push(s);
      if (s.t > streamingSince) streamingSince = s.t;
    }
    streamingPollFailed = false;
  } catch (err) {
    if (!streamingPollFailed) {
      streamingPollFailed = true;
      console.warn(`[streaming-server] utilization poll failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

// ---- Raw HTTP stream consumer ----
// Raw sockets + buffer scanning (no string allocs, no JSON.parse) so the
// receiver itself adds as little overhead as possible.

function recordToken(result: StreamResult, emitTime: number, now: number) {
  result.received++;
  if (now > measureDeadline) {
    if (!deadlinePrinted) {
      deadlinePrinted = true;
      console.log(`[test] Measurement deadline reached (${MEASURE_S}s). Draining streams...`);
    }
    return;
  }
  if (result.sampleCount < result.latencies.length) {
    const idx = result.sampleCount++;
    result.latencies[idx] = now - emitTime;
    result.concurrencies[idx] = activeStreams;
  }
}

/** Parse the digits of a `"time":"<ms>"` record found at `start` (first digit). Returns -1 if the closing quote isn't in `buf`. */
function parseTimeValue(buf: Buffer, start: number): { emitTime: number; end: number } | null {
  const end = buf.indexOf(QUOTE, start);
  if (end === -1) return null;
  let emitTime = 0;
  for (let j = start; j < end; j++) emitTime = emitTime * 10 + buf[j] - 48;
  return { emitTime, end };
}

function consumeRunStream(sessionId: string, headers: Record<string, string>, result: StreamResult): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/sessions/${sessionId}/runs`, API_BASE);
    const body = JSON.stringify({
      input: { role: 'user', parts: [{ type: 'text', text: JSON.stringify(STREAM_SPEC) }] },
      stream: true,
    });
    const requester = url.protocol === 'https:' ? https : http;

    const req = requester.request(
      {
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: url.pathname,
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        if (res.statusCode !== 200) {
          let buf = '';
          res.on('data', (c: Buffer) => (buf += c.toString()));
          res.on('end', () => reject(new Error(`Run create failed ${res.statusCode}: ${buf.slice(0, 300)}`)));
          return;
        }

        activeStreams++;
        let tail: Buffer | null = null;

        res.on('data', (chunk: Buffer) => {
          const now = Date.now();

          // A record can be split across two data events. Scan the previous
          // chunk's tail joined with this chunk's head, counting only records
          // that START in the tail and COMPLETE in this chunk — records fully
          // inside either chunk are handled by the main scans.
          if (tail) {
            const joint = Buffer.concat([tail, chunk.subarray(0, Math.min(chunk.length, TAIL_LEN))]);
            let pos = 0;
            while ((pos = joint.indexOf(TIME_KEY_BUF, pos)) !== -1) {
              if (pos >= tail.length) break; // starts in the new chunk — main scan's job
              const parsed = parseTimeValue(joint, pos + TIME_KEY_BUF.length);
              if (!parsed) break;
              if (parsed.end >= tail.length) recordToken(result, parsed.emitTime, now); // spans the boundary
              pos = parsed.end;
            }
          }

          // Main scan — zero string allocations
          let pos = 0;
          while ((pos = chunk.indexOf(TIME_KEY_BUF, pos)) !== -1) {
            const parsed = parseTimeValue(chunk, pos + TIME_KEY_BUF.length);
            if (!parsed) break; // record cut off — next event's boundary scan picks it up
            recordToken(result, parsed.emitTime, now);
            pos = parsed.end;
          }

          tail = chunk.length > TAIL_LEN ? chunk.subarray(chunk.length - TAIL_LEN) : chunk;
        });

        res.on('end', () => { activeStreams--; resolve(); });
        res.on('error', (err) => { activeStreams--; reject(err); });
      }
    );

    req.on('error', reject);
    req.end(body);
  });
}

// ---- Main ----

async function main() {
  // Preflight: agent server must already be running (it's a separate process/machine).
  const agentHealthUrl = new URL('/health', AGENT_URL);
  try {
    const res = await fetch(agentHealthUrl, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (err) {
    throw new Error(
      `Agent server is not reachable at ${agentHealthUrl} (${err instanceof Error ? err.message : err}).\n` +
      `Start it first: pnpm stress2:agent`
    );
  }

  // Setup: fresh org, prod environment (direct agent URL, no tunnel)
  const org = await setupTestOrg();
  const client = org.prodClient;
  const standardClient = org.prodStandardClient;

  await updateEnvironment(client, {
    config: {
      agents: [{
        name: 'stress-agent',
        version: '1.0.0',
        url: AGENT_URL,
        adapter: 'ai-sdk',
        runs: [{
          input: { schema: z.looseObject({ role: z.literal('user'), parts: z.array(z.any()) }) },
          output: [],
          validateOutput: false,
        }],
      }],
      channels: [{ type: 'api', name: 'stress-channel', agent: 'stress-agent' }],
    },
  });

  const { user } = await client.users.create();

  const authHeaders = {
    Authorization: `Bearer ${org.apiKeySecret.key}`,
    'X-Env': 'production',
  };

  const results: StreamResult[] = [];
  let settledCount = 0;

  async function runStream(index: number): Promise<void> {
    const result: StreamResult = {
      index,
      ok: false,
      received: 0,
      latencies: new Float64Array(STREAM_SPEC.tokens),
      concurrencies: new Uint16Array(STREAM_SPEC.tokens),
      sampleCount: 0,
    };
    results.push(result);

    try {
      const session = await client.sessions.create({ agent: 'stress-agent', userId: user.id });
      result.sessionId = session.id;

      await consumeRunStream(session.id, authHeaders, result);

      // Validation 1: every timestamped chunk arrived — the only quick way to
      // know the stream wasn't cut short.
      if (result.received !== STREAM_SPEC.tokens) {
        throw new Error(`received ${result.received}/${STREAM_SPEC.tokens} timestamped chunks`);
      }

      // Validation 2: the run must have been persisted as completed.
      const finalSession = await standardClient.getSession({ id: session.id });
      const runs = finalSession.runs ?? [];
      if (runs.length !== 1) {
        throw new Error(`expected 1 run in session, got ${runs.length}`);
      }
      const run: any = runs[0];
      if (run.status !== 'completed') {
        throw new Error(`run status is "${run.status}"${run.reason ? ` (reason: ${JSON.stringify(run.reason)})` : ''}`);
      }

      result.ok = true;
    } catch (err) {
      result.reason = err instanceof Error ? err.message : String(err);
      console.error(`[stream ${index}] FAILED${result.sessionId ? ` (session ${result.sessionId})` : ''}: ${result.reason}`);
    } finally {
      settledCount++;
    }
  }

  // Receiver self-utilization + live status line
  const receiverCpu = startCpuTracker();
  const statusInterval = setInterval(() => {
    const samples = receiverCpu.getSamples();
    const last = samples[samples.length - 1];
    const streaming = streamingSamples[streamingSamples.length - 1];
    const failed = results.filter((r) => !r.ok && r.reason).length;
    const fmt = (n: number) => `${(n * 100).toFixed(0)}%`;
    console.log(
      `[test] active=${activeStreams} done=${settledCount}/${N}${failed > 0 ? ` FAILED=${failed}` : ''}` +
      (last ? ` | receiver elu=${fmt(last.elu)} cpu=${fmt(last.cpu)}` : '') +
      (streaming ? ` | streaming elu=${fmt(streaming.elu)} cpu=${fmt(streaming.cpu)} conns=${streaming.conns}` : '')
    );
  }, 1000);

  // Streaming server utilization poller — only collect samples from test start
  streamingSince = Date.now();
  await pollStreamingUtilization(); // verify endpoint reachable before ramping up
  if (streamingPollFailed) {
    console.warn('[streaming-server] utilization endpoint unreachable — continuing without streaming server metrics');
  }
  const streamingPollInterval = setInterval(pollStreamingUtilization, 2000);

  // Ramp up
  const rampIntervalMs = (RAMP_UP_S * 1000) / N;
  const streamPromises: Promise<void>[] = [];

  measureDeadline = Date.now() + MEASURE_S * 1000;
  console.log(`Ramping up: 1 new stream every ${rampIntervalMs.toFixed(0)}ms over ${RAMP_UP_S}s (measuring for ${MEASURE_S}s)`);

  await new Promise<void>((resolve) => {
    let i = 0;
    const tick = () => {
      streamPromises.push(runStream(i));
      i++;
      if (i < N) {
        // Add ±50% jitter to the ramp interval
        const jitter = 1 + (Math.random() - 0.5); // range: 0.5 to 1.5
        setTimeout(tick, rampIntervalMs * jitter);
      } else {
        resolve();
      }
    };
    tick();
  });

  console.log(`All ${N} streams started. Waiting for completion...`);

  await Promise.all(streamPromises); // runStream never rejects — failures land in results

  clearInterval(statusInterval);
  clearInterval(streamingPollInterval);
  await pollStreamingUtilization(); // final scrape
  receiverCpu.stop();

  // ---- Merge successful streams' samples ----
  const succeeded = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  const totalSamples = succeeded.reduce((acc, r) => acc + r.sampleCount, 0);
  const latencies = new Float64Array(totalSamples);
  const concurrencies = new Uint16Array(totalSamples);
  let offset = 0;
  for (const r of succeeded) {
    latencies.set(r.latencies.subarray(0, r.sampleCount), offset);
    concurrencies.set(r.concurrencies.subarray(0, r.sampleCount), offset);
    offset += r.sampleCount;
  }

  function filterLatencies(lo: number, hi: number): Float64Array {
    const buf: number[] = [];
    for (let i = 0; i < totalSamples; i++) {
      if (concurrencies[i] >= lo && concurrencies[i] <= hi) buf.push(latencies[i]);
    }
    return Float64Array.from(buf);
  }

  // ---- Report ----
  console.log(`\n=== Stress-2 Results ===`);
  console.log(`Streams: ${succeeded.length}/${N} succeeded${failed.length > 0 ? ` — ${failed.length} FAILED (excluded from results)` : ''}`);
  console.log(`Latency samples (successful streams, measure window): ${totalSamples}`);

  console.log(`\n--- Token latency (emit → receive) ---`);
  report('Overall', latencies);

  const buckets = [1, 5, 10, 20, 30, 40, 50, 75, 100].filter((b) => b <= N);
  for (const bucket of buckets) {
    const lo = bucket === 1 ? 1 : buckets[buckets.indexOf(bucket) - 1] + 1;
    const filtered = filterLatencies(lo, bucket);
    if (filtered.length > 0) report(`Concurrency ${lo}-${bucket}`, filtered);
  }

  // Fine-grained buckets beyond 100
  const maxBucket = buckets[buckets.length - 1] ?? 0;
  let maxConcurrency = 0;
  for (let i = 0; i < totalSamples; i++) if (concurrencies[i] > maxConcurrency) maxConcurrency = concurrencies[i];
  if (maxConcurrency > maxBucket) {
    const step = Math.max(1, Math.ceil((maxConcurrency - maxBucket) / 25));
    for (let lo = maxBucket + 1; lo <= maxConcurrency; lo += step) {
      const hi = Math.min(lo + step - 1, maxConcurrency);
      const filtered = filterLatencies(lo, hi);
      if (filtered.length > 0) report(`Concurrency ${lo}-${hi}`, filtered);
    }
  }

  console.log(`\n--- Utilization ---`);
  console.log(formatCpuSummary('receiver (this process)', receiverCpu.summary()));

  const streamingSummary = summarize(streamingSamples);
  if (streamingSummary) {
    const maxConns = Math.max(...streamingSamples.map((s) => s.conns));
    const maxRss = Math.max(...streamingSamples.map((s) => s.rss));
    console.log(formatCpuSummary(`streaming server (peak conns=${maxConns}, peak rss=${(maxRss / 1024 / 1024).toFixed(0)}MB)`, streamingSummary));
  } else {
    console.log('  streaming server: no utilization samples (endpoint unreachable?)');
  }
  console.log('  agent server: prints its own utilization while under load — check its output');

  if (failed.length > 0) {
    console.log(`\n--- Failed streams (${failed.length}) ---`);
    for (const r of failed.slice(0, 20)) {
      console.log(`  [stream ${r.index}]${r.sessionId ? ` session=${r.sessionId}` : ''}: ${r.reason}`);
    }
    if (failed.length > 20) console.log(`  ... and ${failed.length - 20} more`);
  }

  console.log(`\n=== End ===\n`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
