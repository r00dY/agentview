import { request as httpRequest } from 'node:http';
import { performance } from 'node:perf_hooks';
import { createClient } from 'agentview';
import { configDefaults, createStandardClient } from 'agentview/clientStandard';
import { seedUsers } from '../seedUsers';
import { z } from 'zod';

// ---- Config ----
const N = 300;
const RAMP_UP_S = 10;
const MEASURE_S = 25; // only collect samples for this long after first stream starts
const AGENT_PORT = 3500;
const AGENT_URL = `http://localhost:${AGENT_PORT}/agent`;
const API_BASE = process.env.VITE_AGENTVIEW_API_URL ?? 'http://localhost:1990';

configDefaults.__internal = { disableSummaries: true };

// ---- Latency collection (pre-allocated typed arrays, zero GC) ----
const MAX_SAMPLES = N * 100 * MEASURE_S;
const latencies = new Float64Array(MAX_SAMPLES);
const concurrencies = new Uint16Array(MAX_SAMPLES);
let sampleCount = 0;

let activeStreams = 0;
let measureDeadline = Infinity;
let deadlinePrinted = false;

const TIME_KEY_BUF = Buffer.from('"time":"');
const QUOTE = 0x22; // '"'

// ---- percentile helper ----
function percentile(sorted: number[], p: number): number {
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

// ---- Raw HTTP stream consumer ----

function consumeRunStream(
  sessionId: string,
  headers: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/sessions/${sessionId}/runs`, API_BASE);
    const body = JSON.stringify({
      input: { role: 'user', parts: [{ type: 'text', text: 'stress' }] },
      stream: true,
    });

    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        if (res.statusCode !== 200) {
          let buf = '';
          res.on('data', (c: Buffer) => (buf += c.toString()));
          res.on('end', () => reject(new Error(`Run failed ${res.statusCode}: ${buf.slice(0, 300)}`)));
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

    req.on('error', reject);
    req.end(body);
  });
}

// ---- Main ----

async function main() {
  const elu = performance.eventLoopUtilization();

  // Setup
  const orgSlug = 'stress-' + Math.random().toString(36).slice(2);
  console.log(`Seeding org: ${orgSlug}`);
  const seed = await seedUsers(orgSlug);
  const apiKey = seed.apiKeySecret.key;
  const adminEmail = seed.adminUser.email;

  const authHeaders = {
    Authorization: `Bearer ${apiKey}`,
    'X-Env': `dev:${adminEmail}`,
  };

  const av = createStandardClient({ apiKey, env: `dev:${adminEmail}` });

  await av.updateEnvironment({
    config: {
      agents: [
        {
          name: 'stress-agent',
          version: '1.0.0',
          url: AGENT_URL,
          adapter: 'ai-sdk',
          runs: [
            {
              input: { schema: z.looseObject({ role: z.literal('user'), parts: z.array(z.any()) }) },
              steps: [],
              output: { schema: z.looseObject({ type: z.literal('text'), text: z.string() }) },
            },
          ],
        },
      ],
      channels: [{ type: 'api', name: 'stress-agent', agent: 'stress-agent' }],
      __internal: { disableSummaries: true },
    },
  });

  const avAISDK = createClient({ apiKey, env: `dev:${adminEmail}` });
  const sessionIds: string[] = [];

  console.log(`Creating ${N} sessions...`);
  for (let i = 0; i < N; i++) {
    const session = await avAISDK.createSession({ agent: 'stress-agent' });
    sessionIds.push(session.id);
  }
  console.log(`${N} sessions created.\n`);

  // ELU monitor
  const eluInterval = setInterval(() => {
    const { utilization } = performance.eventLoopUtilization(elu);
    console.log(`[test ELU] ${(utilization * 100).toFixed(1)}%  active=${activeStreams}`);
  }, 1000);

  // Ramp up
  const rampIntervalMs = (RAMP_UP_S * 1000) / N;
  const streamPromises: Promise<void>[] = [];

  measureDeadline = Date.now() + MEASURE_S * 1000;
  console.log(`Ramping up: 1 new stream every ${rampIntervalMs.toFixed(0)}ms over ${RAMP_UP_S}s (measuring for ${MEASURE_S}s)`);

  let launched = 0;
  await new Promise<void>((resolve) => {
    const tick = () => {
      const i = launched++;
      console.log(`[test] Starting run ${i + 1}/${N}`);
      streamPromises.push(consumeRunStream(sessionIds[i], authHeaders));
      if (launched < N) {
        setTimeout(tick, rampIntervalMs);
      } else {
        resolve();
      }
    };
    tick();
  });

  console.log(`All ${N} streams started. Waiting for completion...`);

  const results = await Promise.allSettled(streamPromises);
  clearInterval(eluInterval);

  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length > 0) {
    console.log(`${failed.length}/${N} streams failed:`);
    for (const f of failed.slice(0, 5)) {
      console.log(`  ${(f as PromiseRejectedResult).reason}`);
    }
  }

  // Report
  console.log(`\n=== Stress Test Results ===`);
  console.log(`Total samples: ${sampleCount}`);
  console.log(`Streams: ${N - failed.length}/${N} succeeded\n`);

  report('Overall', latencies.subarray(0, sampleCount));

  const buckets = [1, 5, 10, 20, 30, 40, 50, 75, 100].filter((b) => b <= N);
  for (const bucket of buckets) {
    const lo = bucket === 1 ? 1 : buckets[buckets.indexOf(bucket) - 1] + 1;
    const hi = bucket;
    const filtered = filterLatencies(lo, hi);
    if (filtered.length > 0) {
      report(`Concurrency ${lo}-${hi}`, filtered);
    }
  }

  // Fine-grained buckets beyond 100
  const maxBucket = buckets[buckets.length - 1];
  let maxConcurrency = 0;
  for (let i = 0; i < sampleCount; i++) if (concurrencies[i] > maxConcurrency) maxConcurrency = concurrencies[i];
  if (maxConcurrency > maxBucket) {
    const step = Math.max(1, Math.ceil((maxConcurrency - maxBucket) / 25));
    for (let lo = maxBucket + 1; lo <= maxConcurrency; lo += step) {
      const hi = Math.min(lo + step - 1, maxConcurrency);
      const filtered = filterLatencies(lo, hi);
      if (filtered.length > 0) {
        report(`Concurrency ${lo}-${hi}`, filtered);
      }
    }
  }

  console.log(`\n=== End ===\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
