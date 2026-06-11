/**
 * Stress-2 agent endpoint. Run it SEPARATELY from the test:
 *
 *   pnpm stress2:agent
 *
 * Deliberately dumb: it streams tokens according to a spec embedded in the
 * incoming run input — the last user message's text part must be JSON:
 *
 *   { "tokens": 3000, "intervalMs": 10, "jitterMs": 3 }
 *
 * Every text-delta carries `providerMetadata.agentview.time` (ms epoch,
 * stamped at emission) so the receiver can measure end-to-end latency.
 *
 * It prints its own utilization (ELU + process CPU) once per second, but
 * ONLY while connections are active — if it stays quiet, it wasn't loaded.
 */
import { createServer, type IncomingMessage } from 'node:http';
import { performance } from 'node:perf_hooks';

if (!process.env.STRESS2_AGENT_PORT) {
  throw new Error('STRESS2_AGENT_PORT is not set');
}

const PORT = Number(process.env.STRESS2_AGENT_PORT);

let connections = 0;
let streamsServed = 0;

// --- Utilization reporting (only under load) ---

let prevElu = performance.eventLoopUtilization();
let prevCpu = process.cpuUsage();
let prevTime = performance.now();
let wasUnderLoad = false;

setInterval(() => {
  const nowElu = performance.eventLoopUtilization();
  const elu = performance.eventLoopUtilization(nowElu, prevElu).utilization;
  prevElu = nowElu;

  const cpuDelta = process.cpuUsage(prevCpu);
  prevCpu = process.cpuUsage();

  const now = performance.now();
  const cpu = (cpuDelta.user + cpuDelta.system) / 1000 / (now - prevTime);
  prevTime = now;

  if (connections > 0) {
    wasUnderLoad = true;
    console.log(`[stress-agent] conns=${connections} elu=${(elu * 100).toFixed(1)}% cpu=${(cpu * 100).toFixed(1)}%`);
  } else if (wasUnderLoad) {
    wasUnderLoad = false;
    console.log(`[stress-agent] idle — ${streamsServed} streams served since start`);
  }
}, 1000).unref();

// --- Spec parsing ---

interface StreamSpec {
  tokens: number;
  intervalMs: number;
  jitterMs: number;
}

function parseSpec(body: any): { spec: StreamSpec } | { error: string } {
  const messages: any[] = body?.messages ?? [];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const part = lastUser?.parts?.find((p: any) => p.type === 'text');
  if (!part?.text) return { error: 'no text part in last user message' };

  let raw: any;
  try {
    raw = JSON.parse(part.text);
  } catch {
    return { error: `last user message text is not JSON: ${String(part.text).slice(0, 100)}` };
  }

  const tokens = Number(raw.tokens);
  const intervalMs = Number(raw.intervalMs);
  const jitterMs = Number(raw.jitterMs ?? 0);
  if (!Number.isFinite(tokens) || tokens < 1) return { error: '`tokens` must be a positive number' };
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return { error: '`intervalMs` must be a positive number' };
  if (!Number.isFinite(jitterMs) || jitterMs < 0) return { error: '`jitterMs` must be a non-negative number' };

  return { spec: { tokens, intervalMs, jitterMs } };
}

// --- Server ---

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url?.startsWith('/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, connections, streamsServed }));
    return;
  }

  // Anything else is treated as an agent run request.
  let body: any = {};
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : {};
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'invalid JSON body' }));
    return;
  }

  const parsed = parseSpec(body);
  if ('error' in parsed) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: `invalid stream spec: ${parsed.error}` }));
    return;
  }
  const { spec } = parsed;

  connections++;
  streamsServed++;
  res.on('close', () => {
    connections--;
  });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  res.write(`data: ${JSON.stringify({ type: 'start', messageId: 'msg_stress' })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'text-start', id: 't1' })}\n\n`);

  let i = 0;

  const emit = () => {
    if (res.destroyed) return;

    if (i < spec.tokens) {
      const chunk = {
        type: 'text-delta',
        id: 't1',
        delta: `tok${i} `,
        providerMetadata: { agentview: { time: `${Date.now()}` } },
      };
      /**
       * IMPORTANT: *NO* BACKPRESSURE
       *
       * res.write() may return false (backpressure) but we intentionally
       * ignore it. Timestamp is stamped before write so it captures intended
       * emission time, not when bytes hit the wire — that's what we want to
       * measure.
       */
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      i++;

      const jitter = (Math.random() * spec.jitterMs * 2) - spec.jitterMs;
      setTimeout(emit, spec.intervalMs + jitter);
    } else {
      res.write(`data: ${JSON.stringify({ type: 'text-end', id: 't1' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'finish', finishReason: 'stop' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  };

  emit();
});

process.on('SIGTERM', () => {
  console.log(`[stress-agent] SIGTERM — ${streamsServed} streams served, exiting`);
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log(`[stress-agent] SIGINT — ${streamsServed} streams served, exiting`);
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`[stress-agent] listening on :${PORT} — stream spec comes from run input`);
});
