/**
 * Stress-2 agent endpoint: a standalone token-emitting server, spawned as a
 * separate process by test.ts so its CPU load never pollutes the receiver's
 * measurements.
 *
 * Each text-delta carries `providerMetadata.agentview.time` (ms epoch stamped
 * at emission) so the receiver can compute end-to-end latency per token.
 *
 * The server tracks its own CPU/ELU every second (see cpuTracker.ts) and:
 *  - exposes `GET /stats` so the test can collect the summary, and
 *  - prints the summary on SIGTERM/SIGINT before exiting,
 * so we can tell whether the token *source* was overloaded — if it was, the
 * latency numbers measure the agent server, not AgentView.
 */
import { createServer } from 'node:http';
import { startCpuTracker, formatCpuSummary } from './cpuTracker';

const PORT = Number(process.env.STRESS2_AGENT_PORT) || 3501;
const TOKENS_PER_SECOND = Number(process.env.STRESS2_TOKENS_PER_SECOND) || 100;
const STREAM_DURATION_S = Number(process.env.STRESS2_STREAM_DURATION_S) || 30;

const TOTAL_TOKENS = TOKENS_PER_SECOND * STREAM_DURATION_S;
const BASE_INTERVAL_MS = 1000 / TOKENS_PER_SECOND;
const JITTER_MS = Math.min(3, BASE_INTERVAL_MS / 3);

let connections = 0;
let peakConnections = 0;
let streamsServed = 0;

const cpuTracker = startCpuTracker();

function handleStats(res: import('node:http').ServerResponse) {
    const payload = JSON.stringify({
        ok: true,
        connections,
        peakConnections,
        streamsServed,
        config: { tokensPerSecond: TOKENS_PER_SECOND, streamDurationS: STREAM_DURATION_S },
        cpu: { samples: cpuTracker.getSamples(), summary: cpuTracker.summary() },
    });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
    res.end(payload);
}

const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url?.startsWith('/stats')) {
        handleStats(res);
        return;
    }
    if (req.method === 'GET' && req.url?.startsWith('/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    // Anything else is treated as an agent run request: drain the body, stream tokens.
    req.resume();
    req.on('end', () => {
        connections++;
        streamsServed++;
        if (connections > peakConnections) peakConnections = connections;
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

            if (i < TOTAL_TOKENS) {
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
                 * ignore it. Timestamp is stamped before write so it captures
                 * intended emission time, not when bytes hit the wire — that's
                 * what we want to measure.
                 */
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                i++;

                const jitter = (Math.random() * JITTER_MS * 2) - JITTER_MS;
                setTimeout(emit, BASE_INTERVAL_MS + jitter);
            } else {
                res.write(`data: ${JSON.stringify({ type: 'text-end', id: 't1' })}\n\n`);
                res.write(`data: ${JSON.stringify({ type: 'finish', finishReason: 'stop' })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
            }
        };

        emit();
    });
});

function shutdown(signal: string) {
    console.log(`\n[agent-server] ${signal} received. Streams served: ${streamsServed}, peak connections: ${peakConnections}`);
    console.log(formatCpuSummary('[agent-server] self utilization', cpuTracker.summary()));
    server.close();
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, () => {
    console.log(
        `[agent-server] listening on :${PORT} — ${TOKENS_PER_SECOND} tok/s, ${STREAM_DURATION_S}s streams, ±${JITTER_MS.toFixed(1)}ms jitter`
    );
});
