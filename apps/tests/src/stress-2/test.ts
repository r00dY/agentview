/**
 * Stress-2: streaming load test measuring end-to-end token latency AND how
 * strained every part of the pipeline was while the test ran.
 *
 *   agent server (spawned child process, tracks its own CPU)
 *     → AgentView streaming server (sampled via GET /api/streaming/utilization)
 *       → this process, the receiver (tracks its own CPU)
 *
 * Each token carries its emission timestamp (`providerMetadata.agentview.time`),
 * so latency = receive time - emit time. Latency numbers are only meaningful
 * if neither endpoint of the measurement was overloaded — that's why both the
 * agent server and the receiver report their own utilization at the end.
 *
 * Uses the `production` AgentView environment: the API server fetches the
 * agent URL directly, no tunnel proxy in the path.
 *
 * Usage:
 *   # local stack (API on localhost, prod env, agent server on localhost)
 *   npx tsx src/stress-2/test.ts [N]
 *
 *   # production (agent server must be publicly reachable!)
 *   STRESS_ENV=prod STRESS2_AGENT_URL=https://my-public-host:3501/agent npx tsx src/stress-2/test.ts [N]
 */
import http from 'node:http';
import https from 'node:https';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { updateEnvironment } from 'agentview/updateEnvironment';

import { setupTestOrg } from '../utils';
import { startCpuTracker, formatCpuSummary, summarize } from './cpuTracker';

// ---- Config ----
const N = Number(process.argv[2]) || 400;
const RAMP_UP_S = Number(process.env.STRESS2_RAMP_UP_S) || 10;
const MEASURE_S = Number(process.env.STRESS2_MEASURE_S) || 25; // only collect samples for this long after first stream starts
const TOKENS_PER_SECOND = Number(process.env.STRESS2_TOKENS_PER_SECOND) || 100;
const STREAM_DURATION_S = Number(process.env.STRESS2_STREAM_DURATION_S) || 30;
const AGENT_PORT = Number(process.env.STRESS2_AGENT_PORT) || 3501;

const STRESS_ENV = process.env.STRESS_ENV ?? 'dev';
if (!['dev', 'prod'].includes(STRESS_ENV)) {
  throw new Error('STRESS_ENV must be either dev or prod');
}

if (STRESS_ENV === 'prod') {
  process.env.AGENTVIEW_API_URL = 'https://api.agentview.app';
}

// In prod the API server must be able to reach the agent server over the
// public internet — the machine running this test has to be exposed.
const AGENT_URL = process.env.STRESS2_AGENT_URL ?? (
  STRESS_ENV === 'dev'
    ? `http://localhost:${AGENT_PORT}/agent`
    : (() => { throw new Error('STRESS_ENV=prod requires STRESS2_AGENT_URL — a publicly reachable URL routing to the spawned agent server (port ' + AGENT_PORT + ')'); })()
);

const API_BASE = process.env.AGENTVIEW_API_URL;
if (!API_BASE) {
  throw new Error('AGENTVIEW_API_URL is not set');
}

console.log('------- stress-2 -------');
console.log('env:           ', STRESS_ENV);
console.log('api url:       ', API_BASE);
console.log('agent url:     ', AGENT_URL);
console.log('streams:       ', N);
console.log('tokens/s:      ', TOKENS_PER_SECOND, `(per stream, for ${STREAM_DURATION_S}s)`);
console.log('ramp up:       ', `${RAMP_UP_S}s`);
console.log('measure window:', `${MEASURE_S}s`);
console.log('');

// ---- Latency collection (pre-allocated typed arrays, zero GC) ----
const MAX_SAMPLES = N * TOKENS_PER_SECOND * MEASURE_S;
const latencies = new Float64Array(MAX_SAMPLES);
const concurrencies = new Uint16Array(MAX_SAMPLES);
let sampleCount = 0;

let activeStreams = 0;
let measureDeadline = Infinity;
let deadlinePrinted = false;

const TIME_KEY_BUF = Buffer.from('"time":"');
const QUOTE = 0x22; // '"'

// ---- percentile helpers ----
function percentile(sorted: number[] | Float64Array, p: number): number {
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

function filterLatencies(lo: number, hi: number): Float64Array {
  const buf: number[] = [];
  for (let i = 0; i < sampleCount; i++) {
    if (concurrencies[i] >= lo && concurrencies[i] <= hi) buf.push(latencies[i]);
  }
  return Float64Array.from(buf);
}

// ---- Agent server (separate process) ----

async function spawnAgentServer(): Promise<ChildProcess> {
  const serverPath = fileURLToPath(new URL('./agentServer.ts', import.meta.url));
  const child = spawn('npx', ['tsx', serverPath], {
    env: {
      ...process.env,
      STRESS2_AGENT_PORT: String(AGENT_PORT),
      STRESS2_TOKENS_PER_SECOND: String(TOKENS_PER_SECOND),
      STRESS2_STREAM_DURATION_S: String(STREAM_DURATION_S),
    },
    detached: true,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  child.unref();

  // Wait until it answers /health
  const deadline = Date.now() + 15_000;
  while (true) {
    try {
      const res = await fetch(`http://localhost:${AGENT_PORT}/health`, { signal: AbortSignal.timeout(1_000) });
      if (res.ok) break;
    } catch { }
    if (Date.now() > deadline) {
      throw new Error('agent server did not become healthy within 15s');
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return child;
}

async function fetchAgentServerStats(): Promise<any | null> {
  try {
    const res = await fetch(`http://localhost:${AGENT_PORT}/stats`, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function killAgentServer(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (!child.pid) return resolve();
    const timeout = setTimeout(() => {
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { }
      resolve();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    // detached:true put the child in its own process group — kill the whole
    // tree (npx → tsx → node), not just the parent.
    try { process.kill(-child.pid, 'SIGTERM'); } catch {
      clearTimeout(timeout);
      resolve();
    }
  });
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

const TEST_INPUT: any = { role: 'user', parts: [{ type: 'text', text: 'stress' }] };

function consumeRunStream(sessionId: string, headers: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/sessions/${sessionId}/runs`, API_BASE);
    const body = JSON.stringify({ input: TEST_INPUT, stream: true });
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
          res.on('end', () => {
            const err = new Error(`Run create failed ${res.statusCode}: ${buf.slice(0, 300)}`);
            console.error(`[test] ${err.message}`);
            reject(err);
          });
          return;
        }

        activeStreams++;

        res.on('data', (chunk: Buffer) => {
          const now = Date.now();
          if (now > measureDeadline) {
            if (!deadlinePrinted) {
              deadlinePrinted = true;
              console.log(`[test] Measurement deadline reached (${MEASURE_S}s). ${sampleCount} samples collected. Draining streams...`);
            }
            return;
          }

          // Scan raw buffer — zero string allocations
          let pos = 0;
          while ((pos = chunk.indexOf(TIME_KEY_BUF, pos)) !== -1) {
            const start = pos + TIME_KEY_BUF.length;
            const end = chunk.indexOf(QUOTE, start);
            if (end === -1) break;
            let emitTime = 0;
            for (let j = start; j < end; j++) emitTime = emitTime * 10 + chunk[j] - 48;
            const idx = sampleCount++;
            latencies[idx] = now - emitTime;
            concurrencies[idx] = activeStreams;
            pos = end;
          }
        });

        res.on('end', () => { activeStreams--; resolve(); });
        res.on('error', (err) => { activeStreams--; reject(err); });
      }
    );

    req.on('error', (err) => {
      console.error(`[test] Run request error: ${err.message}`);
      reject(err);
    });
    req.end(body);
  });
}

// ---- Main ----

async function main() {
  console.log(`Spawning agent server on :${AGENT_PORT}...`);
  const agentServer = await spawnAgentServer();

  try {
    // Setup: fresh org, prod environment (direct agent URL, no tunnel)
    const org = await setupTestOrg();
    const client = org.prodClient;

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

    // Receiver self-utilization + live status line
    const receiverCpu = startCpuTracker();
    const statusInterval = setInterval(() => {
      const samples = receiverCpu.getSamples();
      const last = samples[samples.length - 1];
      const streaming = streamingSamples[streamingSamples.length - 1];
      const fmt = (n: number) => `${(n * 100).toFixed(0)}%`;
      console.log(
        `[test] active=${activeStreams} samples=${sampleCount}` +
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

    async function runStream() {
      const session = await client.sessions.create({ agent: 'stress-agent', userId: user.id });
      return consumeRunStream(session.id, authHeaders);
    }

    await new Promise<void>((resolve) => {
      let i = 0;
      const tick = () => {
        i++;
        streamPromises.push(runStream());
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

    const settled = await Promise.allSettled(streamPromises);
    const failed = settled.filter((s) => s.status === 'rejected');

    clearInterval(statusInterval);
    clearInterval(streamingPollInterval);
    await pollStreamingUtilization(); // final scrape
    receiverCpu.stop();

    const agentStats = await fetchAgentServerStats();

    // ---- Report ----
    console.log(`\n=== Stress-2 Results ===`);
    console.log(`Streams: ${N - failed.length}/${N} succeeded`);
    console.log(`Total latency samples: ${sampleCount}`);

    console.log(`\n--- Token latency (emit → receive) ---`);
    report('Overall', latencies.subarray(0, sampleCount));

    const buckets = [1, 5, 10, 20, 30, 40, 50, 75, 100].filter((b) => b <= N);
    for (const bucket of buckets) {
      const lo = bucket === 1 ? 1 : buckets[buckets.indexOf(bucket) - 1] + 1;
      const filtered = filterLatencies(lo, bucket);
      if (filtered.length > 0) report(`Concurrency ${lo}-${bucket}`, filtered);
    }

    // Fine-grained buckets beyond 100
    const maxBucket = buckets[buckets.length - 1] ?? 0;
    let maxConcurrency = 0;
    for (let i = 0; i < sampleCount; i++) if (concurrencies[i] > maxConcurrency) maxConcurrency = concurrencies[i];
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

    if (agentStats?.cpu?.summary) {
      console.log(formatCpuSummary(`agent server (token source, peak conns=${agentStats.peakConnections})`, agentStats.cpu.summary));
    } else {
      console.log('  agent server: stats unavailable');
    }

    const streamingSummary = summarize(streamingSamples);
    if (streamingSummary) {
      const maxConns = Math.max(...streamingSamples.map((s) => s.conns));
      const maxRss = Math.max(...streamingSamples.map((s) => s.rss));
      console.log(formatCpuSummary(`streaming server (peak conns=${maxConns}, peak rss=${(maxRss / 1024 / 1024).toFixed(0)}MB)`, streamingSummary));
    } else {
      console.log('  streaming server: no utilization samples (endpoint unreachable?)');
    }

    if (failed.length > 0) {
      console.log(`\n${failed.length} streams FAILED. First error:`, (failed[0] as PromiseRejectedResult).reason);
    }

    console.log(`\n=== End ===\n`);
  } finally {
    console.log('Shutting down agent server...');
    await killAgentServer(agentServer);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
