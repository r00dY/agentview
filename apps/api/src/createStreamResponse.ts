import { type Context } from 'hono';

/**
 * Returns a normal response with X-Run-Stream-Id header.
 * The Go proxy intercepts this header and connects to the streaming server
 * to pipe the SSE stream to the client.
 */
export function createStreamResponse(c: Context, runId: string, _options?: any) {
  return c.body(null, 200, {
    'X-Run-Stream-Id': runId,
  });
}
