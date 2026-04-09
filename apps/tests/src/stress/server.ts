import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';

const elu = performance.eventLoopUtilization();

const PORT = Number(process.argv[2]) || 3500;
const TOKENS_PER_SECOND = 100;
const STREAM_DURATION_S = 30;
const TOTAL_TOKENS = TOKENS_PER_SECOND * STREAM_DURATION_S;
const BASE_INTERVAL_MS = 1000 / TOKENS_PER_SECOND; // 10ms
const JITTER_MS = 3;

let connections = 0;

setInterval(() => {
  if (connections > 0) {
    const { utilization } = performance.eventLoopUtilization(elu);
    console.log(`[server ELU] ${(utilization * 100).toFixed(1)}%`);
  }
}, 1000);

const server = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    connections++;
    console.log(`[server] connections: ${connections}`);
    res.on('close', () => {
      connections--;
      console.log(`[server] connections: ${connections}`);
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
          providerMetadata: { time: `${Date.now()}` },
        };
        /**
         * IMPORTANT: *NO* BACKPRESSURE
         * 
         * res.write() may return false (backpressure) but we intentionally ignore it.
         * Timestamp is stamped before write so it captures intended emission time,
         * not when bytes hit the wire — that's what we want to measure.
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

server.listen(PORT, () => {
  console.log(`Stress server on :${PORT} — ${TOKENS_PER_SECOND}t/s, ${STREAM_DURATION_S}s streams, ±${JITTER_MS}ms jitter`);
});
